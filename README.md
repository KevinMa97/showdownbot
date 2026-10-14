# showdown-bot

Offline gen9 random battle harness (@pkmn/sim, @pkmn/randoms, @smogon/calc).

Run: `node selfplay.js <games> [agentA=heuristic] [agentB=random]`
Agents: `random`, `heuristic` (v2, agent.js), `heuristic_v1` (frozen baseline, agent_v1.js).
Sides swap each game. Output includes Elo diff of A vs B with 95% CI.

## Agents
- v1: one-ply. Opponent tracked from public protocol. Threat = expected dmg/turn averaged over randbats sets. Move = dealt - taken. Switch = -threat + small attack value - tax.
- v2: v1 plus status/hazard/setup/recovery values, opponent status and hazard tracking, priority-aware speed, endgame risk weighting.

## Results (gen9 randbats)
- v1 vs random, 500 games: 360-137 (~72%), 3 timeouts.
- v2 vs v1, 600 games total (side-swapped): 290-301 (49%), Elo ~ -5, CI roughly -30 to +20. No measurable gain.
- Choice errors and timeouts: ~1-2% of games. Cause not yet found.

## Not yet
- Lookahead: all agents are one-ply. v2 features added value terms but not search.
- Opponent switch prediction, wall detection, item inference, unrevealed team modeling.
- Search-derived signals (determinized visit counts/values), as suggested in the PsyMew thread.

## v3 search (agent_search.js)
- Determinized 2-ply matrix search: up to 12 randbats sets of opponent, per-set maximin over its moves/switches, averaged.
- search vs v2, 400 side-swapped games (4 chunks): 220-150 decided, 30 errored/excluded. Score 59.5%, Elo ~ +67 (95% CI ~ +31 to +104).
- Caveat: 7.5% of games errored (likely 20s timeouts on slow turns). Excluded games may bias the result. Investigate before trusting.
