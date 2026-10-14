"""Switch-target model: given a switch decision, which bench Pokemon did the player choose?
Candidates = the decider's own alive bench (full team is known to the decider). Grouped 3-fold CV.
Baselines: random, highest HP, best offensive matchup."""
import gzip, json, re, sys, numpy as np
sys.path.insert(0, 'opp2')
from pools import consistent_pool
SETS = json.load(open('data/gen9-randbats.json'))
from sklearn.ensemble import HistGradientBoostingClassifier
DEX = json.load(open('dex_export.json'))
AT = json.load(open('ability_table.json'))['fields']
def toid(s): return re.sub(r'[^a-z0-9]', '', str(s).lower())
def types(sp):
    s = DEX['SPECIES'].get(toid(sp)) or DEX['SPECIES'].get(toid(sp.split('-')[0]))
    return s['types'] if s else []
def bspe(sp):
    s = DEX['SPECIES'].get(toid(sp)) or DEX['SPECIES'].get(toid(sp.split('-')[0]))
    return s['bs']['spe'] if s and 'bs' in s else 80
def eff(att, dts):
    e = 1.0
    for t in dts: e *= DEX['CHART'].get(att, {}).get(t, 1)
    return e
def pool_moves(sp):
    s = SETS.get(toid(sp))
    if not s: return []
    out = set()
    for st in s['sets']:
        for m in st['movepool']: out.add(m)
    return list(out)
def mv_info(name):
    m = DEX['MOVES'].get(toid(name))
    return (m.get('type'), m.get('bp') or 0) if m else (None, 0)
def proxy_dmg(attacker_types_or_move_list, target_types, moves):
    # damage proxy: max over moves of base power x type effectiveness (STAB if the move type is an attacker type)
    best = 0.0
    for name in moves:
        t, bp = mv_info(name)
        if not t or bp <= 0: continue
        stab = 1.5 if t in attacker_types_or_move_list else 1.0
        best = max(best, bp * eff(t, target_types) * stab)
    return best
def move_types(names):
    out = []
    for n in names:
        m = DEX['MOVES'].get(toid(n))
        if m and (m.get('bp') or 0) > 0 and m.get('type'): out.append(m['type'])
    return out
ABIL_BY_ID = {toid(k): v for k, v in AT.items()}
def immune_types(ability_id):
    ab = ABIL_BY_ID.get(toid(ability_id), {})
    return ab.get('type_immune', [])
recs = [json.loads(l) for l in gzip.open('pipeline/out/obs_full.jsonl.gz', 'rt')]
X, y, grp, dec_id, hp_c, off_c, rnd_c = [], [], [], [], [], [], []
cnt = 0
for r in recs:
    if r['action_kind'] != 'switch' or not r.get('my_team'): continue
    op = r['opp']; opp_types = types(op['active'] or '')
    threat_types = move_types(op.get('revealed_moves', []))
    haz = set(r.get('my_hazards', []))
    cands = [p for p in r['my_team'] if not p['active'] and not p['fainted']]
    if len(cands) < 1: continue
    chosen = toid(r['action'])
    if not any(toid(p['species']) == chosen for p in cands): continue
    for p in cands:
        ts = types(p['species'])
        threat = max([eff(t, ts) for t in threat_types], default=1.0)
        imm = int(any(t in threat_types for t in immune_types(p.get('ability') or '')))
        offense = max([eff(t, opp_types) for t in ts], default=1.0)
        rock = eff('Rock', ts) / 8 if 'stealthrock' in haz else 0.0
        spikes = (1 / 8) if ('spikes' in haz and 'Flying' not in ts) else 0.0
        opp_pool = consistent_pool(op['active'] or '', op.get('revealed_moves', []), op.get('revealed_ability'))
        pool_threat = proxy_dmg(opp_types, ts, opp_pool)          # worst case over the opponent's possible moves
        revealed_threat = proxy_dmg(opp_types, ts, op.get('revealed_moves', []))
        my_offense = proxy_dmg(ts, opp_types, p.get('moves', []))  # candidate's own moves are known to the decider
        hits_to_ko_pool = (p['hp'] * 100) / max(pool_threat / 100, 1e-6)  # proxy: survivable hits vs worst-case move
        faster = int(bspe(p['species']) > bspe(op['active'] or ''))
        kill_after_switch = int(faster and my_offense >= 100 * 100 and p['hp'] > 0)  # fast and strong: proxy for "attacks first"
        X.append([p['hp'], threat, imm, offense, bspe(p['species']), bspe(op['active'] or ''),
                  rock + spikes, int('Flying' in ts), len(cands), r['turn'], r['my']['hp'],
                  pool_threat, revealed_threat, my_offense, hits_to_ko_pool, faster, kill_after_switch])
        y.append(int(toid(p['species']) == chosen)); dec_id.append(cnt)
        hp_c.append(p['hp']); off_c.append(offense)
    cnt += 1
X = np.array(X, float); y = np.array(y); dec_id = np.array(dec_id)
games = []
gi = {}
for r in recs[:0]: pass
# group ids per decision: derive game from record order
game_of = []
for r in recs:
    if r['action_kind'] != 'switch' or not r.get('my_team'): continue
    cands = [p for p in r['my_team'] if not p['active'] and not p['fainted']]
    if len(cands) < 1 or not any(toid(p['species']) == toid(r['action']) for p in cands): continue
    game_of.append(r['game'])
game_of = np.array(game_of)
ug = sorted(set(game_of)); perm = np.random.RandomState(0).permutation(len(ug))
fold_of = {ug[k]: k % 3 for k in range(len(ug))}
ff = np.array([fold_of[g] for g in game_of])
row_fold = ff[dec_id]
def top1(sc, yy, dd):
    h = n = 0
    for d in np.unique(dd):
        idx = np.where(dd == d)[0]; n += 1; h += yy[idx[np.argmax(sc[idx])]] == 1
    return h / n
print('switch decisions', cnt, 'candidate rows', len(y), flush=True)
base_cols = list(range(11))
full_cols = list(range(X.shape[1]))
def cv_cols(cols):
    accs = []
    for k in range(3):
        tr, te = row_fold != k, row_fold == k
        clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, random_state=0).fit(X[tr][:, cols], y[tr])
        accs.append(top1(clf.predict_proba(X[te][:, cols])[:, 1], y[te], dec_id[te]))
    return float(np.mean(accs)), [round(a, 4) for a in accs]
print('current features       ', cv_cols(base_cols), flush=True)
print('+ pool threat, offense, speed, survivability', cv_cols(full_cols), flush=True)
res = {'model': [], 'random': [], 'max_hp': [], 'best_offense': []}
for k in range(3):
    tr, te = row_fold != k, row_fold == k
    clf = HistGradientBoostingClassifier(max_iter=200, learning_rate=0.05, random_state=0).fit(X[tr], y[tr])
    res['model'].append(top1(clf.predict_proba(X[te])[:, 1], y[te], dec_id[te]))
    rs = np.random.RandomState(k).rand(te.sum())
    res['random'].append(top1(rs, y[te], dec_id[te]))
    res['max_hp'].append(top1(X[te][:, 0] + 1e-9 * rs, y[te], dec_id[te]))
    res['best_offense'].append(top1(X[te][:, 3] + 1e-9 * rs, y[te], dec_id[te]))
for k, v in res.items(): print('  %-14s top-1 %.4f' % (k, np.mean(v)), flush=True)
