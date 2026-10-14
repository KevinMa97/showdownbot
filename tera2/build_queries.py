import sys
sys.path.insert(0, 'opp2')
from pools import consistent_pool
"""Tera timing dataset. One row per decision where the POV still has Tera (not yet used at turn start).
For each of the POV's living Pokemon: survive-hit count and KO check vs the opponent's randbats move pool
(calc, in tera2/calc.js), speed, offense. Label: POV used Tera this turn (next turn's flag flips)."""
import gzip, json, glob, os, re, collections
SETS = json.load(open('data/gen9-randbats.json'))
DEX = json.load(open('dex_export.json'))
def toid(s): return re.sub(r'[^a-z0-9]', '', str(s).lower())
recs = [json.loads(l) for l in gzip.open('pipeline/out/obs_full.jsonl.gz', 'rt')]
ratings = {}
for d in ['/home/claude/userlogs/logs/raw', '/home/claude/raw2/raw2', '/home/claude/raw3/raw3']:
    for f in glob.glob(os.path.join(d, '*.meta.json')):
        gid = os.path.basename(f).split('.')[0]; m = json.load(open(f))
        ratings[gid] = {s: (v.get('rating') or 0) for s, v in m.get('players', {}).items()}
by = collections.defaultdict(dict)
for r in recs: by[(r['game'], r['pov'])][r['turn']] = r
def pool(sp):
    s = SETS.get(toid(sp))
    if not s: return []
    out = set()
    for st in s['sets']:
        for m in st['movepool']: out.add(m)
    return sorted(out)
def tera_types(sp):
    s = SETS.get(toid(sp)); out = set()
    if s:
        for st in s['sets']:
            for t in st.get('teraTypes', []): out.add(t)
    return sorted(out)
def lvl(det):
    m = re.search(r'\bL(\d+)\b', det); return int(m.group(1)) if m else 80
queries = []; rows = []
for (g, pov), turns in by.items():
    for t, r in turns.items():
        if r['my_tera_used'] or not r.get('my_team') or not r['opp']['active']: continue
        if r['action_kind'] is None: continue
        nxt = turns.get(t + 1)
        label = int(nxt is not None and nxt['my_tera_used'] and not r['my_tera_used'])
        opp = r['opp']; op_pool = consistent_pool(opp['active'], opp.get('revealed_moves', []), opp.get('revealed_ability'))
        mons = []
        for p in r['my_team']:
            if p['fainted']: continue
            mons.append({'sp': p['species'], 'lvl': lvl(p.get('details', '')) if p.get('details') else 80, 'hp': p['hp'],
                         'moves': p.get('moves', []), 'active': p['active'], 'tera_types': tera_types(p['species'])})
        if not mons: continue
        qids = []
        for m in mons:
            q = {'my_sp': m['sp'], 'my_lvl': m['lvl'], 'my_hp': m['hp'], 'my_moves': m['moves'],
                 'opp_sp': opp['active'], 'opp_lvl': opp['level'], 'opp_hp': opp['hp'], 'opp_moves': op_pool}
            qids.append(len(queries)); queries.append(q)
        rows.append({'game': g, 'turn': t, 'pov': pov, 'label': label, 'rating': ratings.get(g, {}).get(pov, 0),
                     'mons': mons, 'qids': qids, 'opp_sp': opp['active'], 'opp_hp': opp['hp'],
                     'opp_seen_alive': sum(1 for s in opp.get('seen', []) if not s.get('fainted')),
                     'my_active': next((m['sp'] for m in mons if m['active']), None),
                     'my_team_alive': len(mons), 'opp_revealed': opp.get('revealed_moves', []), 'opp_ability': opp.get('revealed_ability')})
json.dump(queries, open('tera2/queries.json', 'w'))
with open('tera2/rows.jsonl', 'w') as f:
    for r in rows: f.write(json.dumps(r) + '\n')
print('decisions', len(rows), 'positives', sum(r['label'] for r in rows), 'queries', len(queries))
