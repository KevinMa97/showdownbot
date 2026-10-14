"""Pivot replacement dataset (both sides): the pivoting player chooses who comes in after the move resolves.
Candidates = the pivoting side's living bench. Features are answer-check features vs the opponent's active
(survive hits from the opponent's randbats pool consistent with its revealed moves; KO next turn if faster)."""
import json, os, sys, re, collections
import own_team as O
sys.path.insert(0, 'opp2'); from pools import consistent_pool
rows = []
for d in ['/home/claude/exact', '/home/claude/exact2', '/home/claude/exact3']:
    st = json.load(open(os.path.join(d, 'state.json')))
    for rid, c in st['matches'].items():
        log = open(os.path.join(d, f'{rid}.{c[:8]}.log'), encoding='utf-8', errors='replace').read()
        rows += [r for r in O.rows_with_own_team(log, rid, both_sides=True) if r['label'] == 'pivot_replacement']
queries = []; meta = []
for r in rows:
    pool = consistent_pool(r['opp_sp'], r.get('opp_revealed', []), r.get('opp_ability'))
    cands = [m for m in r['my_team'] if not m['active'] and not m['fainted']]
    qids = []
    if not any(m['species'] == r.get('switch_in') for m in cands): continue  # chosen mon must be a living bench mon
    for m in cands:
        qids.append(len(queries))
        queries.append({'my_sp': m['species'], 'my_lvl': m['level'], 'my_hp': m['hp'], 'my_moves': m['moves'],
                        'opp_sp': r['opp_sp'], 'opp_lvl': r['opp_lvl'], 'opp_hp': r['opp_hp'], 'opp_moves': pool})
    meta.append({'game': r['game'], 'turn': r['turn'], 'chosen': r.get('switch_in'), 'cands': [m['species'] for m in cands],
                 'qids': qids, 'won': r.get('won', 0), 'opp_sp': r['opp_sp']})
json.dump(queries, open('replacement2/queries.json', 'w'))
json.dump(meta, open('replacement2/meta.json', 'w'))
print('pivot replacement decisions', len(meta), 'candidate queries', len(queries))
