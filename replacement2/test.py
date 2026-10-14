"""Replacement choice: does the pivoting player pick the candidate that answers the opponent's active?
Answer check (per candidate): survive >=1 hit and KO next turn if faster; survive >=2 and KO if slower;
survive >=3; or a status move with survival >=1. Grouped 3-fold CV. Baselines: random, max HP, max offense."""
import json, numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
Q = json.load(open('replacement2/queries.json')); R = json.load(open('replacement2/results.json'))
M = json.load(open('replacement2/meta.json'))
DEX = json.load(open('dex_export.json'))
STATUS = {m for m, v in DEX['MOVES'].items() if v.get('status')}
X, y, dec, grp, rnd = [], [], [], [], []
for di, m in enumerate(M):
    if not m['qids']: continue
    for sp, qid in zip(m['cands'], m['qids']):
        q, res = Q[qid], R[qid]
        hp = q['my_hp']
        surv = int(hp / res['threat']) if res['threat'] > 0 else 99
        ko = res['offense'] >= q['opp_hp'] - 0.01
        stall = any(mv in STATUS for mv in q['my_moves']) and surv >= 1
        ans = int((surv >= 1 and res['faster'] and ko) or (surv >= 2 and ko) or surv >= 3 or stall)
        X.append([ans, surv, int(ko), res['faster'], res['offense'], res['threat'], hp])
        y.append(int(sp == m['chosen'])); dec.append(di); grp.append(m['game'])
X = np.array(X, float); y = np.array(y); dec = np.array(dec); grp = np.array(grp)
games = sorted(set(grp)); perm = np.random.RandomState(0).permutation(len(games))
fold = {games[g]: k % 3 for k, g in enumerate(perm)}
f = np.array([fold[g] for g in grp])
def top1(sc, yy, dd):
    h = n = 0
    for d in np.unique(dd):
        idx = np.where(dd == d)[0]
        if yy[idx].sum() == 0: continue
        n += 1; h += yy[idx[np.argmax(sc[idx])]] == 1
    return h / n
print('replacement decisions with a chosen living candidate:', len(np.unique(dec[y == 1])), flush=True)
res = {'model': [], 'answer_only': [], 'max_hp': [], 'max_offense': [], 'random': []}
for k in range(3):
    tr, te = f != k, f == k
    clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.05, random_state=0).fit(X[tr], y[tr])
    res['model'].append(top1(clf.predict_proba(X[te])[:, 1], y[te], dec[te]))
    rs = np.random.RandomState(k).rand(te.sum())
    res['answer_only'].append(top1(X[te][:, 0] + 1e-6 * rs, y[te], dec[te]))
    res['max_hp'].append(top1(X[te][:, 6] + 1e-6 * rs, y[te], dec[te]))
    res['max_offense'].append(top1(X[te][:, 4] + 1e-6 * rs, y[te], dec[te]))
    res['random'].append(top1(rs, y[te], dec[te]))
for k, v in res.items(): print('  %-12s top-1 %.4f' % (k, np.mean(v)), flush=True)
# answer first, offense as tie-break (what the decider does: find an answer, then the best one)
for name, sc in [('answer then offense', X[:, 0] * 10 + X[:, 4]), ('answer then survival then offense', X[:, 0] * 100 + X[:, 1] * 10 + X[:, 4])]:
    accs = []
    for k in range(3):
        te = f == k
        accs.append(top1(sc[te] + 1e-6 * np.random.RandomState(k).rand(te.sum()), y[te], dec[te]))
    print('  %-34s top-1 %.4f' % (name, np.mean(accs)), flush=True)
