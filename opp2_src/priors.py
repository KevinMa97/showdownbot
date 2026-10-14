"""Item and ability priors per species, learned from full teams in the replays (each player's own team
is visible in the request lines). Randbats data has no item list, so frequencies come from the games."""
import gzip, json, collections, re
recs = [json.loads(l) for l in gzip.open('pipeline/out/obs_full.jsonl.gz', 'rt')]
seen = set(); item = collections.defaultdict(collections.Counter); ability = collections.defaultdict(collections.Counter)
def base(s): return s.split(',')[0].strip()
for r in recs:
    key = (r['game'], r['pov'])
    if key in seen or not r.get('my_team'): continue
    seen.add(key)
    for p in r['my_team']:
        sp = p['species']
        if p.get('item'): item[sp][p['item']] += 1
        if p.get('ability'): ability[sp][p['ability']] += 1
out = {'item': {sp: dict(c) for sp, c in item.items()}, 'ability': {sp: dict(c) for sp, c in ability.items()}}
json.dump(out, open('opp2/priors.json', 'w'))
n_items = sum(sum(c.values()) for c in item.values())
print('species with item data', len(item), 'team slots counted', n_items, 'teams', len(seen))
