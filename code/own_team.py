"""Own-team features: what the decider knew about its own team at each decision.
Uses the exact-replay logs (|request| lines carry the full team of each side).
Only the winning side's decisions are labeled, same as extract_decisions."""
import glob, json, os, re, re as _re, sys
import extract_decisions as E
import parse_logs as P

PIVOT_MOVES = {'U-turn','Flip Turn','Volt Switch','Parting Shot','Teleport','Baton Pass','Shed Tail','Chilly Reception'}
def hp_frac_(c):
    h = c.split(' ')[0]
    try:
        a, b = h.split('/')[:2]; return float(a) / float(b)
    except Exception: return 0.0
def level_of_(d):
    import re as _re
    m = _re.search(r'\bL(\d+)\b', d); return int(m.group(1)) if m else 80

DEX = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dex_export.json')))
SPECIES, MOVES, CHART = DEX['SPECIES'], DEX['MOVES'], DEX['CHART']
IMMUNE_ABILITY, SWITCH_ABILITY = DEX['IMMUNE_ABILITY'], DEX['SWITCH_ABILITY']
_AT = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ability_table.json')))['fields']
_ID2NAME = {re.sub(r'[^a-z0-9]', '', n.lower()): n for n in _AT}
def ability_fields(ability_id):
    name = _ID2NAME.get(ability_id, ability_id)
    return _AT.get(name, {})
STATUS_OF_MOVE = {'tox': 'psn', 'psn': 'psn', 'par': 'par', 'brn': 'brn', 'slp': 'slp', 'frz': 'frz'}

def toid(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

def sp_types(name):
    s = SPECIES.get(toid(name)) or SPECIES.get(toid(name.split('-')[0]))
    return s['types'] if s else []

def mv(name):
    return MOVES.get(toid(name), {})

def eff(att_type, def_types):
    if not att_type or not def_types: return 1.0
    e = 1.0
    for t in def_types:
        v = CHART.get(att_type, {}).get(t, 1)
        e *= v
    return e

def own_features(req, opp_row):
    """req = latest |request| JSON for the decider; opp_row = decision row (opp state)."""
    team = req['side']['pokemon']
    active = [p for p in team if p.get('active')]
    alive = [p for p in team if not p['condition'].endswith(' fnt')]
    bench = [p for p in alive if not p.get('active')]
    opp_types = sp_types(opp_row['opp_sp'] or '') if opp_row.get('opp_sp') else []
    opp_atk_types = [mv(m).get('type') for m in opp_row.get('opp_revealed', []) if mv(m).get('bp', 0) > 0]
    opp_atk_types = [t for t in opp_atk_types if t]
    opp_spe = opp_row.get('opp_stat_spe', 0)
    def spe(p): return (p.get('stats') or {}).get('spe', 0)
    move_ids = lambda p: p.get('moves', [])
    def has(p, key): return any(mv(m).get(key) for m in move_ids(p))
    def has_hazard(p): return any(mv(m).get('hazard') for m in move_ids(p))
    def has_screen(p): return any(mv(m).get('screen') for m in move_ids(p))
    def has_pivot(p): return any(mv(m).get('pivot') for m in move_ids(p))
    def has_setup(p): return any(mv(m).get('setup') for m in move_ids(p))
    def checks(p):
        # bench mon resists or is immune to every revealed opponent attacking type
        ts = sp_types(p['details'].split(',')[0])
        if not opp_atk_types: return 0
        return int(all(eff(t, ts) < 1 for t in opp_atk_types))
    def immune_from_ability(p):
        ab = ability_fields(p.get('baseAbility') or p.get('ability') or '')
        return int(any(t in opp_atk_types for t in ab.get('type_immune', [])))
    opp_status_kinds = {STATUS_OF_MOVE.get(mv(m).get('status') or '') for m in opp_row.get('opp_revealed', []) if mv(m).get('status')}
    opp_status_kinds.discard(None)
    def status_block(p):
        ab = ability_fields(p.get('baseAbility') or p.get('ability') or '')
        return int(bool(opp_status_kinds) and any(k in opp_status_kinds for k in ab.get('status_immune', [])))
    def switch_ab(p, key):
        ab = ability_fields(p.get('baseAbility') or p.get('ability') or '')
        return int(ab.get(key) is not None) if key == 'heal_on_switch' else int(ab.get('switch_in') == key)
    def mon_ok(p):  # alive, not active
        return not p.get('active') and not p['condition'].endswith(' fnt')
    feats = {
        'own_alive': len(alive),
        'own_bench_alive': len(bench),
        'own_hazard_setter': int(any(has_hazard(p) for p in alive)),
        'own_screen_user': int(any(has_screen(p) for p in alive)),
        'own_pivot_alive': int(any(has_pivot(p) for p in bench)),
        'own_setup_fast': int(any(has_setup(p) and spe(p) >= opp_spe for p in alive)),
        'own_setup_any': int(any(has_setup(p) for p in alive)),
        'own_intimidate_bench': sum(switch_ab(p, 'intimidate') for p in bench),
        'own_checks': sum(checks(p) for p in bench if mon_ok(p)),
        'own_ability_immune': sum(immune_from_ability(p) for p in bench if mon_ok(p)),
        'own_status_block_bench': sum(status_block(p) for p in bench if mon_ok(p)),
        'own_regen_bench': sum(ability_fields(p.get('baseAbility') or '').get('heal_on_switch', False) for p in bench),
        'own_contact_punish_bench': sum(ability_fields(p.get('baseAbility') or '').get('contact_punish', False) for p in bench),
        'own_active_hp': active[0]['condition'].split(' ')[0] if active else '',
    }
    try:
        feats['own_active_hp'] = int(feats['own_active_hp'].split('/')[0]) / int(feats['own_active_hp'].split('/')[1])
    except Exception:
        feats['own_active_hp'] = 0.0
    return feats

def rows_with_own_team(log, gid, both_sides=False):
    """Walk the exact log, tracking the latest request per side; emit decision rows with own-team features."""
    winner = None
    m = re.search(r'^\|win\|(.*)$', log, re.M)
    if not m: return []
    wname = m.group(1).strip()
    winner_side = 'p1' if P.winner_name(log, 'p1') == wname else ('p2' if P.winner_name(log, 'p2') == wname else None)
    if winner_side is None: return []
    lines = log.split('\n')
    ratings = {}
    for side in ('p1', 'p2'):
        m2 = re.search(r'^\|player\|%s\|[^|\n]*\|[^|\n]*\|(\d*)' % side, log, re.M)
        ratings[side] = int(m2.group(1)) if m2 and m2.group(1) else None
    latest = {}
    st = {s: {'sp': None, 'lvl': 80, 'hp': 1.0, 'st': None, 'revealed': set(), 'fainted': 0, 'seen': set(),
              'asleep': set(), 'tera_used': False, 'tera_pending': False} for s in ('p1', 'p2')}
    turn = 0; recent = []; out = []
    turn_moves = {'p1': set(), 'p2': set()}
    side_hint = None
    for i, raw in enumerate(lines):
        # omniscient split format: |split|pX is followed by the private (exact-HP) copy of the
        # next line, then the public copy. Keep only the public copy.
        if i > 0 and lines[i - 1].startswith('|split|'):
            continue
        if raw == 'sideupdate' and i + 1 < len(lines):
            side_hint = lines[i + 1].strip()
            continue
        if raw.startswith('|request|') and side_hint in ('p1', 'p2'):
            try:
                latest[side_hint] = json.loads(raw[len('|request|'):])
            except Exception:
                pass
            side_hint = None
            continue
        if not raw.startswith('|'):
            continue
        parts = raw.split('|'); kind = parts[1] if len(parts) > 1 else ''
        if kind == 'turn' and len(parts) > 2:
            turn = int(parts[2]); turn_moves = {'p1': set(), 'p2': set()}
        elif kind in ('switch', 'drag') and len(parts) > 3:
            side = parts[2][:2]
            if side in st:
                prev_faint = any(r.startswith('|faint|') for r in recent[-3:])
                if kind == 'switch' and turn > 0 and not prev_faint and (both_sides or side == winner_side) and side in latest:
                    label = 'pivot_replacement' if (turn_moves[side] & PIVOT_MOVES) else 'switch'
                    row = E.make_row(st, side, turn, gid, label, False)
                    row['switch_in'] = parts[3].split(',')[0].strip()
                    row['my_team'] = [{'species': q['details'].split(',')[0].strip(), 'hp': hp_frac_(q['condition']), 'fainted': q['condition'].endswith(' fnt'), 'active': bool(q.get('active')), 'moves': q.get('moves', []), 'item': q.get('item') or '', 'ability': q.get('baseAbility') or q.get('ability') or '', 'level': level_of_(q['details'])} for q in latest[side]['side']['pokemon']]
                    row['won'] = int(side == winner_side)
                    row.update(own_features(latest[side], row))
                    row['my_rating'] = ratings.get(side); row['opp_rating'] = ratings.get('p2' if side == 'p1' else 'p1')
                    out.append(row)
                s = st[side]
                s['sp'] = E.base(parts[3]); s['lvl'] = E.level_of(parts[3]); s['seen'].add(s['sp'])
                s['hp'] = P.parse_hp(parts[4]) if len(parts) > 4 else 1.0
                s['st'] = (parts[4].split(' ')[1] if len(parts) > 4 and ' ' in parts[4] else None)
                s['revealed'] = set()
        elif kind == 'move' and len(parts) > 3:
            side = parts[2][:2]
            if side in turn_moves: turn_moves[side].add(parts[3])
            if side in st and st[side]['sp'] and (both_sides or side == winner_side) and side in latest:
                tera_now = st[side]['tera_pending']
                row = E.make_row(st, side, turn, gid, parts[3], tera_now)
                row['won'] = int(side == winner_side)
                row.update(own_features(latest[side], row))
                row['my_rating'] = ratings.get(side); row['opp_rating'] = ratings.get('p2' if side == 'p1' else 'p1')
                out.append(row)
            if side in st:
                st[side]['tera_pending'] = False
                if st[side]['sp']: st[side]['revealed'].add(parts[3])
        elif kind == '-terastallize' and len(parts) > 2:
            side = parts[2][:2]
            if side in st: st[side]['tera_pending'] = True; st[side]['tera_used'] = True
        elif kind in ('-damage', '-heal') and len(parts) > 3:
            side = parts[2][:2]
            if side in st: st[side]['hp'] = P.parse_hp(parts[3])
        elif kind == '-status' and len(parts) > 3:
            side = parts[2][:2]
            if side in st:
                st[side]['st'] = parts[3]
                if parts[3] == 'slp' and st[side]['sp']: st[side]['asleep'].add(st[side]['sp'])
        elif kind == '-curestatus':
            side = parts[2][:2]
            if side in st: st[side]['st'] = None; st[side]['asleep'].discard(st[side]['sp'])
        elif kind == 'faint':
            side = parts[2][:2]
            if side in st:
                st[side]['hp'] = 0.0; st[side]['fainted'] += 1; st[side]['asleep'].discard(st[side]['sp'])
        recent.append(raw)
    return out

if __name__ == '__main__':
    import shutil
    src_dir, out_json = sys.argv[1], sys.argv[2]
    state = json.load(open(os.path.join(src_dir, 'state.json')))
    rows = []
    for rid, commit in state['matches'].items():
        path = os.path.join(src_dir, f'{rid}.{commit[:8]}.log')
        log = open(path, encoding='utf-8', errors='replace').read()
        rows += rows_with_own_team(log, rid)
    json.dump(rows, open(out_json, 'w'))
    print('rows', len(rows), 'games', len(set(r['game'] for r in rows)))
    print('sample own feats', {k: rows[0][k] for k in rows[0] if k.startswith('own_')})
