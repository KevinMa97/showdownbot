"""Step 1 of the recommended approach: reconstruct per-turn, player-POV observations from exact replay logs.

Each record = what ONE player knew at the start of a turn:
  - own team (from |request| lines: full species, HP, moves, item, ability)  [known to the player]
  - opponent: only what has been revealed (species, HP %, status, moves used, abilities/items shown)
  - field: weather, hazards on each side, screens, tera used by each side
  - action: the move/switch that player took this turn (label), and the game outcome
Hidden info (opponent sets, EVs, unrevealed team members) is NOT included.
Schema version: OBS_V1.
"""
import json, os, re, sys
OBS_VERSION = 'OBS_V1'

def base(details): return details.split(',')[0].strip()
def level_of(details):
    m = re.search(r'\bL(\d+)\b', details); return int(m.group(1)) if m else 80
def hp_frac(cond):
    head = cond.split(' ')[0]
    if '/' not in head: return 0.0
    try:
        c, m = head.split('/')[:2]; return float(c) / float(m)
    except (ValueError, ZeroDivisionError): return 0.0
def status_of(cond):
    p = cond.split(' ')
    return p[1] if len(p) > 1 else None

class Side:
    def __init__(self):
        self.active = None; self.hp = 1.0; self.status = None; self.level = 80
        self.revealed_moves = {}      # species -> set(moves used)
        self.revealed_ability = {}    # species -> ability
        self.revealed_item = {}       # species -> item
        self.seen = {}                # species -> {'hp': , 'status': , 'fainted': bool}
        self.tera_used = False; self.tera_type = None
        self.fainted = 0
        self.hazards = set(); self.screens = set()
        self.request = None           # latest request for this side (own team, only for the player's own POV)

class Battle:
    def __init__(self):
        self.side = {'p1': Side(), 'p2': Side()}
        self.weather = None; self.terrain = None; self.turn = 0
        self.actions = {'p1': None, 'p2': None}
        self.records = []             # (turn, snapshot) pending action assignment
        self.pending = {}

def snapshot(bt, pov, request=None):
    me = bt.side[pov]; ot = bt.side['p2' if pov == 'p1' else 'p1']
    rec = {
        'obs_version': OBS_VERSION, 'turn': bt.turn, 'pov': pov,
        'weather': bt.weather, 'terrain': bt.terrain,
        'my_hazards': sorted(me.hazards), 'my_screens': sorted(me.screens),
        'opp_hazards': sorted(ot.hazards), 'opp_screens': sorted(ot.screens),
        'my_tera_used': me.tera_used, 'opp_tera_used': ot.tera_used,
        'my': {'active': me.active, 'hp': me.hp, 'status': me.status, 'level': me.level, 'fainted_count': me.fainted},
        'opp': {'active': ot.active, 'hp': ot.hp, 'status': ot.status, 'level': ot.level,
                'revealed_moves': sorted(ot.revealed_moves.get(ot.active, set())) if ot.active else [],
                'revealed_ability': ot.revealed_ability.get(ot.active) if ot.active else None,
                'revealed_item': ot.revealed_item.get(ot.active) if ot.active else None,
                'fainted_count': ot.fainted,
                'seen': [{'species': s, **v} for s, v in ot.seen.items()]},
    }
    req = request if request is not None else me.request
    if req:   # own team exactly as the player sees it, from the request in force at the action
        team = req['side']['pokemon']
        rec['my_team'] = [{'species': base(p['details']), 'hp': hp_frac(p['condition']), 'status': status_of(p['condition']),
                           'active': bool(p.get('active')), 'fainted': p['condition'].endswith(' fnt'),
                           'moves': p.get('moves', []), 'item': p.get('item'), 'ability': p.get('baseAbility') or p.get('ability'),
                           'tera_type': p.get('teraType'), 'stats': p.get('stats')} for p in team]
        act = req.get('active', [None])[0]
        rec['my_legal'] = None if not act else {'moves': [m['id'] for m in act.get('moves', []) if not m.get('disabled')],
                                                 'can_tera': bool(act.get('canTerastallize'))}
    return rec

def parse(log):
    bt = Battle()
    lines = log.split('\n')
    turn_snaps = []           # list of (turn, {pov: snapshot}, {pov: action})
    current = None
    side_hint = None
    recent = []
    for i, raw in enumerate(lines):
        if i > 0 and lines[i - 1].startswith('|split|'):
            continue                                   # omniscient private copy
        if raw == 'sideupdate' and i + 1 < len(lines):
            side_hint = lines[i + 1].strip(); continue
        if raw.startswith('|request|') and side_hint in ('p1', 'p2'):
            try:
                bt.side[side_hint].request = json.loads(raw[len('|request|'):])
                if current is not None: current.setdefault('reqlist', {}).setdefault(side_hint, []).append(bt.side[side_hint].request)
            except Exception: pass
            side_hint = None; continue
        if not raw.startswith('|'):
            continue
        parts = raw.split('|'); kind = parts[1] if len(parts) > 1 else ''
        if kind == 'turn' and len(parts) > 2:
            if current is not None: turn_snaps.append(current)
            bt.turn = int(parts[2])
            current = {'turn': bt.turn, 'snaps': {p: snapshot(bt, p) for p in ('p1', 'p2')}, 'acts': {}}
        elif kind in ('switch', 'drag') and len(parts) > 3:
            s = parts[2][:2]
            if s in bt.side:
                me = bt.side[s]
                sp = base(parts[3]); lvl = level_of(parts[3])
                me.active = sp; me.level = lvl
                me.hp = hp_frac(parts[4]) if len(parts) > 4 else 1.0
                me.status = status_of(parts[4]) if len(parts) > 4 else None
                me.seen.setdefault(sp, {'hp': me.hp, 'status': me.status, 'fainted': False})
                me.seen[sp].update({'hp': me.hp, 'status': me.status})
                if current is not None and kind == 'switch' and s not in current['acts']:
                    prev = [r for r in recent[-3:] if r.startswith('|faint|')]
                    if not prev:
                        current['acts'][s] = ('switch', sp)
                        current.setdefault('reqs', {})[s] = me.request
        elif kind == 'move' and len(parts) > 3:
            s = parts[2][:2]
            if s in bt.side:
                me = bt.side[s]
                if me.active:
                    me.revealed_moves.setdefault(me.active, set()).add(parts[3])
                if current is not None and s not in current['acts']:
                    current['acts'][s] = ('move', parts[3])
                    current.setdefault('reqs', {})[s] = me.request
        elif kind in ('-damage', '-heal') and len(parts) > 3:
            s = parts[2][:2]
            if s in bt.side:
                bt.side[s].hp = hp_frac(parts[3])
                if bt.side[s].active: bt.side[s].seen.setdefault(bt.side[s].active, {})['hp'] = bt.side[s].hp
        elif kind == '-status' and len(parts) > 3:
            s = parts[2][:2]
            if s in bt.side:
                bt.side[s].status = parts[3]
                if bt.side[s].active: bt.side[s].seen.setdefault(bt.side[s].active, {})['status'] = parts[3]
        elif kind == '-curestatus' and len(parts) > 2:
            s = parts[2][:2]
            if s in bt.side:
                bt.side[s].status = None
                if bt.side[s].active: bt.side[s].seen.setdefault(bt.side[s].active, {})['status'] = None
        elif kind == 'faint' and len(parts) > 2:
            s = parts[2][:2]
            if s in bt.side:
                bt.side[s].hp = 0.0; bt.side[s].status = None; bt.side[s].fainted += 1
                if bt.side[s].active: bt.side[s].seen.setdefault(bt.side[s].active, {})['fainted'] = True
        elif kind == '-ability' and len(parts) > 3:
            s = parts[2][:2]
            if s in bt.side and bt.side[s].active: bt.side[s].revealed_ability[bt.side[s].active] = parts[3]
        elif kind == '-item' and len(parts) > 3:
            s = parts[2][:2]
            if s in bt.side and bt.side[s].active: bt.side[s].revealed_item[bt.side[s].active] = parts[3]
        elif kind == '-terastallize' and len(parts) > 3:
            s = parts[2][:2]
            if s in bt.side: bt.side[s].tera_used = True; bt.side[s].tera_type = parts[3]
        elif kind == '-sidestart' and len(parts) > 3:
            s = parts[2][:2]
            cond = parts[3].replace('move: ', '').lower().replace(' ', '')
            if s in bt.side:
                (bt.side[s].screens if cond in ('reflect', 'lightscreen', 'auroraveil') else bt.side[s].hazards).add(cond)
        elif kind == '-sideend' and len(parts) > 3:
            s = parts[2][:2]
            cond = parts[3].replace('move: ', '').lower().replace(' ', '')
            if s in bt.side:
                bt.side[s].hazards.discard(cond); bt.side[s].screens.discard(cond)
        elif kind == '-weather' and len(parts) > 2:
            bt.weather = None if parts[2] == 'none' else parts[2]
        elif kind == '-fieldstart' and len(parts) > 2:
            bt.terrain = parts[2].replace('move: ', '')
        elif kind == '-fieldend' and len(parts) > 2:
            bt.terrain = None
        recent.append(raw)
    if current is not None: turn_snaps.append(current)
    return bt, turn_snaps

def snapshot_for_action(t, pov):
    # board state from turn start; own team/legal moves from the request in force at the action
    base_rec = dict(t['snaps'][pov])
    req = t.get('reqs', {}).get(pov)
    cands = t.get('reqlist', {}).get(pov, [])
    obs_hp = t['snaps'][pov]['my']['hp']
    def act_hp(rq):
        a = (rq.get('side', {}).get('pokemon') or [{}])
        act = next((p for p in a if p.get('active')), None)
        return hp_frac(act['condition']) if act else None
    match = [rq for rq in cands if act_hp(rq) is not None and abs(act_hp(rq) - obs_hp) < 0.02]
    if match: req = match[-1]
    if req is not None:
        full = snapshot_request_fields(base_rec, req)
        base_rec.update(full)
    return base_rec

def snapshot_request_fields(rec, req):
    team = req['side']['pokemon']
    out = {'my_team': [{'species': base(p['details']), 'hp': hp_frac(p['condition']), 'status': status_of(p['condition']),
                        'active': bool(p.get('active')), 'fainted': p['condition'].endswith(' fnt'),
                        'moves': p.get('moves', []), 'item': p.get('item'), 'ability': p.get('baseAbility') or p.get('ability'),
                        'tera_type': p.get('teraType'), 'stats': p.get('stats')} for p in team]}
    act = req.get('active', [None])[0]
    out['my_legal'] = None if not act else {'moves': [m['id'] for m in act.get('moves', []) if not m.get('disabled')],
                                             'can_tera': bool(act.get('canTerastallize'))}
    return out

def records_from_log(log, game_id):
    m = re.search(r'^\|win\|(.*)$', log, re.M)
    if not m: return []
    win_name = m.group(1).strip()
    names = {p: (re.search(r'^\|player\|%s\|([^|\n]*)' % p, log, re.M) or [None, None])[1] for p in ('p1', 'p2')}
    winner = 'p1' if names['p1'] and names['p1'].strip() == win_name else ('p2' if names['p2'] and names['p2'].strip() == win_name else None)
    if winner is None: return []
    bt, snaps = parse(log)
    out = []
    for t in snaps:
        for pov in ('p1', 'p2'):
            act = t['acts'].get(pov)
            if act is None: continue           # no decision (e.g. forced switch-in at end) -> skip
            rec = snapshot_for_action(t, pov)
            rec.update({'game': game_id, 'action_kind': act[0], 'action': act[1], 'won': int(pov == winner)})
            out.append(rec)
    return out

if __name__ == '__main__':
    src_dir, out_path = sys.argv[1], sys.argv[2]
    state = json.load(open(os.path.join(src_dir, 'state.json')))
    n = 0
    with open(out_path, 'w') as f:
        for rid, commit in state['matches'].items():
            log = open(os.path.join(src_dir, f'{rid}.{commit[:8]}.log'), encoding='utf-8', errors='replace').read()
            for r in records_from_log(log, rid):
                f.write(json.dumps(r) + '\n'); n += 1
    print('records', n, 'written', out_path)
