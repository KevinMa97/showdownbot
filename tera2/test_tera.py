"""Tera timing model: does the POV Tera this turn? Features from the answer check, Tera-type exposure,
aggression, and rating. Grouped 3-fold CV by game. A feature group is kept only if AUC improves on every fold."""
import json, re, sys, numpy as np
sys.path.insert(0, 'opp2')
from pools import consistent_pool
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import roc_auc_score
SETS = json.load(open('data/gen9-randbats.json')); DEX = json.load(open('dex_export.json'))
def toid(s): return re.sub(r'[^a-z0-9]', '', str(s).lower())
STATUS = {m for m, v in DEX['MOVES'].items() if v.get('status')}
def pool(sp):
    s = SETS.get(toid(sp))
    if not s: return []
    out = set()
    for st in s['sets']:
        for m in st['movepool']: out.add(m)
    return sorted(out)
rows = [json.loads(l) for l in open('tera2/rows.jsonl')]
res = json.load(open('tera2/results.json'))
def exposed(opp_pool_ids, tera_type):
    for mid in opp_pool_ids:
        m = DEX['MOVES'].get(toid(mid), {})
        if m.get('type') and (m.get('bp') or 0) > 0 and DEX['CHART'].get(m['type'], {}).get(tera_type, 1) >= 2:
            return 1
    return 0
F = []; y = []; grp = []
for r in rows:
    opp_pool = [toid(m) for m in consistent_pool(r['opp_sp'], r.get('opp_revealed', []), r.get('opp_ability'))]
    n_ans = 0; active = None; ans_any = 0; ex_frac = 0.0
    for mon, qid in zip(r['mons'], r['qids']):
        q = res[qid]
        surv = int(mon['hp'] / q['threat']) if q['threat'] > 0 else 99
        ko = q['offense'] >= r['opp_hp'] - 0.01
        stall = any(m in STATUS for m in mon['moves']) and surv >= 1
        ans = int((surv >= 1 and q['faster'] and ko) or (surv >= 2 and ko) or surv >= 3 or stall)
        n_ans += ans
        if mon['active']: active = (q, mon)
    ans_any = int(n_ans > 0)
    if active:
        q, mon = active
        tt = mon['tera_types']
        if tt: ex_frac = float(np.mean([exposed(opp_pool, t) for t in tt]))
        act_threat, act_off = q['threat'], q['offense']
    else:
        act_threat = act_off = 0.0
    F.append([r['rating'] or 0, ans_any, n_ans, ex_frac, act_off - act_threat, act_off, act_threat,
              r['my_team_alive'], r.get('opp_seen_alive', 0), r['opp_hp'], r['turn']])
    y.append(r['label']); grp.append(r['game'])
F = np.array(F, float); y = np.array(y)
games = sorted(set(grp)); perm = np.random.RandomState(0).permutation(len(games))
fold = {games[g]: k % 3 for k, g in enumerate(perm)}
f = np.array([fold[g] for g in grp])
print('decisions', len(y), 'tera events', int(y.sum()), flush=True)
def cv(cols):
    aucs = []
    for k in range(3):
        tr, te = f != k, f == k
        p = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.05, random_state=0).fit(F[tr][:, cols], y[tr]).predict_proba(F[te][:, cols])[:, 1]
        aucs.append(roc_auc_score(y[te], p))
    return float(np.mean(aucs)), [round(a, 4) for a in aucs]
base = cv([0])
prev_folds = base[1]
print('rating only                     AUC %.4f folds %s' % base, flush=True)
for name, cols in [('+ answer check', [0,1,2]), ('+ answer + tera-type exposure', [0,1,2,3]),
                   ('+ answer + exposure + aggression', [0,1,2,3,4,5,6]), ('all features', list(range(F.shape[1])))]:
    a, folds = cv(cols)
    keep = all(x > b for x, b in zip(folds, prev_folds))
    prev_folds = folds
    print('%-32s AUC %.4f (%+.4f) folds %s keep=%s' % (name, a, a - base[0], folds, keep), flush=True)
