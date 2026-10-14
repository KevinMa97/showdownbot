"""Set-consistent opponent move pools.
A randbats set can only supply moves from its own movepool. Once the opponent has revealed moves (and an
ability, if shown), only the sets that contain all of them are possible. Their movepools form the pool.
Falls back to the union of all sets if nothing is consistent (should not happen for real replays)."""
import json, re
SETS = json.load(open('data/gen9-randbats.json'))
def toid(s): return re.sub(r'[^a-z0-9]', '', str(s or '').lower())
def consistent_sets(species, revealed_moves, ability=None):
    s = SETS.get(toid(species))
    if not s: return []
    rev = {toid(m) for m in (revealed_moves or [])}
    out = []
    for st in s['sets']:
        mp = {toid(m) for m in st['movepool']}
        if not rev <= mp: continue
        if ability and toid(ability) not in {toid(a) for a in st.get('abilities', [])}: continue
        out.append(st)
    return out
def consistent_pool(species, revealed_moves, ability=None):
    sets = consistent_sets(species, revealed_moves, ability)
    if not sets: sets = SETS.get(toid(species), {}).get('sets', [])
    pool = set()
    for st in sets:
        for m in st['movepool']: pool.add(m)
    return sorted(pool)
