"""Replacement choice with sweep potential and flexibility. Grouped 3-fold CV.
Sweep potential: candidate knows a self-boosting move (setup), and is at least as fast as the opponent.
Flexibility: distinct damaging move types among its known moves, and not locked into a Choice item."""
import json, re, numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
Q = json.load(open('replacement2/queries.json')); R = json.load(open('replacement2/results.json'))
M = json.load(open('replacement2/meta.json'))
DEX = json.load(open('dex_export.json'))
STATUS = {m for m, v in DEX['MOVES'].items() if v.get('status')}
CHOICE = {'choiceband', 'choicescarf', 'choicespecs'}
ITEMS = {}
for di, m in enumerate(M): pass
rows = []
R2 = json.load(open('replacement2/queries.json'))
X, y, dec, grp = [], [], [], []
for di, m in enumerate(M):
    if not m['qids']: continue
    for sp, qid in zip(m['cands'], m['qids']):
        q, res = Q[qid], R[qid]
        mv_ids = [re.sub(r'[^a-z0-9]', '', x.lower()) for x in q['my_moves']]
        setup = any(DEX['MOVES'].get(i, {}).get('setup') for i in mv_ids)
        dmg_types = {DEX['MOVES'][i]['type'] for i in mv_ids if i in DEX['MOVES'] and (DEX['MOVES'][i].get('bp') or 0) > 0}
        flex = len(dmg_types)
        surv = int(q['my_hp'] / res['threat']) if res['threat'] > 0 else 99
        ko = res['offense'] >= q['opp_hp'] - 0.01
        stall = any(i in STATUS for i in mv_ids) and surv >= 1
        ans = int((surv >= 1 and res['faster'] and ko) or (surv >= 2 and ko) or surv >= 3 or stall)
        X.append([ans, int(setup), int(setup and res['faster']), flex, res['offense'], res['threat'], q['my_hp'], surv, int(ko), res['faster']])
        y.append(int(sp == m['chosen'])); dec.append(di); grp.append(m['game'])
X = np.array(X, float); y = np.array(y); dec = np.array(dec); grp = np.array(grp)
games = sorted(set(grp)); perm = np.random.RandomState(0).permutation(len(games))
fold = {games[g]: k % 3 for k, g in enumerate(perm)}; f = np.array([fold[g] for g in grp])
def top1(sc, yy, dd):
    h = n = 0
    for d in np.unique(dd):
        idx = np.where(dd == d)[0]
        if yy[idx].sum() == 0: continue
        n += 1; h += yy[idx[np.argmax(sc[idx])]] == 1
    return h / n
names = ['answer','setup','setup_fast','flexibility','offense','threat','hp','survival','ko','faster']
def ev(fn):
    accs = []
    for k in range(3):
        te = f == k; rs = np.random.RandomState(k).rand(te.sum()) * 1e-6
        accs.append(top1(fn(X[te]) + rs, y[te], dec[te]))
    return float(np.mean(accs))
print('decisions', len(np.unique(dec[y == 1])), flush=True)
print('answer, then offense           %.4f' % ev(lambda x: x[:, 0] * 10 + x[:, 4]), flush=True)
print('answer, then setup, then offense %.4f' % ev(lambda x: x[:, 0] * 100 + x[:, 1] * 10 + x[:, 4]), flush=True)
print('answer, setup_fast, flex, offense %.4f' % ev(lambda x: x[:, 0] * 1000 + x[:, 2] * 100 + x[:, 3] * 10 + x[:, 4]), flush=True)
accs = []
for k in range(3):
    tr, te = f != k, f == k
    clf = HistGradientBoostingClassifier(max_iter=150, learning_rate=0.05, random_state=0).fit(X[tr], y[tr])
    accs.append(top1(clf.predict_proba(X[te])[:, 1], y[te], dec[te]))
print('learned model, all features    %.4f' % np.mean(accs), flush=True)
