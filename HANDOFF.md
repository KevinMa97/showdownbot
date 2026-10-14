# HANDOFF (for the assistant). Dense. Read fully before acting.

## GOAL
Gen9 Random Battle bot (Showdown), target ~2000+ Elo. Path: prior agent (ok) -> replay-validated engine -> depth-3 search -> features from RB guide.
User: prefers concise output; wants no overrides for "true" accuracy claims; dislikes time-wasting. Sandbox: 1 core, no GPU. User PC: RTX 3070, 8 cores assumed.

## ENV / PATHS
- Project: /home/claude/showdown-bot/ (copy of curated bundle in outputs/handoff/)
- Sim builds: /home/claude/ps_builds/<commit>/ ; shared deps /home/claude/shared_nm/node_modules (NODE_PATH)
- Commits used: 51ad80fa..., 7332b60e..., 5e6884075e... (see SIM_BUILDS.json)
- Raw logs: /home/claude/userlogs/logs/raw, /home/claude/raw2/raw2, /home/claude/raw3/raw3 (json + .log per game)
- Network allowlist: github, npm, pypi only (no smogon.com)

## BENCH / AGENTS
- selfplay.js <n> <A> <B>  (agents: heuristic, random, search, prior, depth3). Prints JSON summary incl guardCorrections.
- guard(agent) in selfplay.js: legality guard. Corrects illegal switch (ranked: agent.bestSwitchForced or hpSwitch; trapped/maybeTrapped -> bestLegalMove), illegal move -> bestLegalMove, 'default' on real decision -> hpSwitch(force) or bestLegalMove. Counts in GUARD, reported.
- prior = PriorAgent (agent_prior.js): stage1/stage2 gradient boosted trees + Tera bonus. Promoted earlier: 206-94 vs search (68.7%, +136 Elo, 300 games).
- depth3 = search/depth3.js (+ agent_depth3.js). 3-turn minimax, top-2 own options by basePower+40*prio, opp top-1 at deeper plies; leaves = material (HP frac + 0.5*alive). Offers no switches if active trapped|maybeTrapped; bench must be non-active, non-fnt, hp>0, in request-allowed set. Deterministic. ~1.1 s/decision on sandbox core, ~272 nodes.
- Results: depth3 vs prior: 5-15 (20g, Elo -191, CI -477..-42); 2-8 (10g, Elo -241). depth3 beats random 2-0. DEPTH3 IS WEAKER THAN PRIOR. Cause: material-only eval, no damage calc, crude pruning.

## REPLAY ENGINE (shadow/fullreplay2.js)
Replays public logs through the real sim; per-turn dice restore from prng truth; oracle sets (true sets) from replay start.
Runner: shadow/run_set.sh <own_commit.json> <oracle> <prng> <out.jsonl>   (NOOVR=1 disables overrides)
Result line per game: exact / match-through-forfeit ('|win|' real or sim) / firstDiffAt.
Overrides: shadow/overrides50*.json; produced by shadow/search_choices.js (HINDSIGHT: picks choices by matching real log). Not valid for online accuracy.
Debug env: TRACE=1 (choices), TRACE2=1 (sim errors), CHOOSE_LOG=1 CHOOSE_FROM/TO, DUMP=1, DRAWLOG=1 (per-draw), SIMRAW=<file>, GREP=<regex>, RESULT line (decisions, divTurn).

Latest verified (NO overrides):
- orig 43 set (own_commit.json): 43/43
- set B (own_commit50b.json): 50/50  (regression run reg4B)
- set C (own_commit50c.json): 48/50 open: 2695879643 (CLOSED later: Electric filler when charged, exact), 2695574943 OPEN
- set D (own_commit50d.json): 50/50
Replay conclusion so far: engine validated on ~193 replays; residual = blocked/charge/tera/priority ordering edge cases.

## KEY MECHANICS FIXES (for reference)
- Log lines: '-singleturn move:' = chosen charge move; '-activate confusion' w/o move = unlogged action (confused self-hit); '-terastallize' before cant/move = same action; Encore: logged move after Encore is forced (uncertain, use non-priority); switch clears Encore; Revival Blessing: revive target from -heal line; Illusion: switch line shows disguise -> use next logged move to pick Zoroark.
- Priority model (effPrio/effMovePrio): Prankster(status +1), Triage(heal/drain +3, ability id lowercase!), Grassy Glide +1 in grassyterrain. Audit: missing Custap Berry (8 log lines), Mycelium Might (2), Gale Wings/Stall/Quick Draw/Quick Claw/Lagging Tail/Full Incense (0 in logs).
- Blocked (cant) fillers: par/frz -> any move (effective prio ordering); slp -> any move only if sim status slp; Charged + blocked -> prefer Electric; charge moves never fallbacks/repeats; sleep-usable (Sleep Talk/Snore) excluded.
- Ability ids in sim JSON are lowercase (baseAbility 'triage').
- Open: 2695574943 (par-block ordering, turn 99 RNG roll diff; flipping order worsens), 2695879643 closed.

## FEATURE SOURCE (RB guide, user-provided, r/stunfisk style)
Mechanics: all 84 EVs each (TR Pokemon 0 Spe), 31 IVs, neutral nature. Levels: Ubers73 OU75 BL76 UU77 BL2 78 RU79 BL3 80 NU81 BL4 82 PU83 (speed tiers warped). Movesets random (any 4 of pool). No team preview (reveal on send-out).
Strategy features to implement (none implemented yet):
1. Win-condition identification (threat/ability to KO many; setup; bulk+toxic), reassess each turn; sack non-win-condition first.
2. Hide win conditions; reveal opponent team via phazing/hazards (Toxic Spikes forces poison, SR forces hazard-remover).
3. Backup plans (don't over-commit to one WC).
4. Hazards priority (not every turn; when no recovery/damage is better).
5. Status spam when opponent likely to switch (Toxic on switch-in).
6. Double-down/switch choice: pick mon with weakness coverage vs likely hits; immunity advantage (e.g., Xurkitree vs Landorus-T).
7. Track opponent moves used (infer sets: which move NOT used when able -> not present).
8. Track opponent switches (refusing to switch into type advantage -> threat).
9. Top threat list (tiered): Xerneas, Primal Groudon, Kartana, Chansey/Blissey, Durant, Kommo-o, Barbaracle, Porygon2, Sigilyph, Minior, Huntail/Gorebyss, Slaking, Facade users (Swellow, Zangoose, Ursaring).
Plan: implement state-only features first (hazards, WC id, info tracking, threat list, speed tiers with RB levels), then damage calc.

## OPEN ISSUES (priority)
1. Depth3 loses to prior: improve eval (add status/hazard/setup/threat features, damage calc via calc.js/@smogon/calc) and move ranking; re-benchmark with >=200 games.
2. 'default' corrections (8 in 10 games, byAgent unknown): find source (likely prior receiveRequest path !request.active or wait-like requests). Log source.
3. Prior: forced-switch fainted-choice bug still exists in agent.js (guard masks it). Fix at source.
4. Replay: 2695574943 open; regression after last changes only partly rerun (set B/C/D after step-3: D 50/50, B 50/50, C 48/50 at last verified).
5. Online accuracy gate: per-turn rebuild from observed info reproduced 1.8% (sampled) / 9.9% (true sets) of turns — NOT ready for depth-3 with hidden info.
6. Custap Berry / Mycelium Might priority gaps.

## DECISIONS MADE
- Replay validation is a gate; overrides are hindsight, must not be reported as online accuracy.
- Depth-3 has no hidden-info sampling yet (omniscient in benchmarks) -> benchmark numbers are optimistic for depth3; compare to prior fairly only with same information.
- Don't build depth3 further until eval improves (currently loses even omniscient).
- User rejected "first legal" fallbacks; corrections must be ranked.

## HOW TO RESUME (first commands)
cd /home/claude/showdown-bot && node -e "require('./selfplay.js')"
node selfplay.js 20 prior random           # sanity
node selfplay.js 10 depth3 prior           # depth3 check (~10 min)
NOOVR=1 bash shadow/run_set.sh shadow/own_commit50d.json shadow/rebuild/oracle50d.json shadow/rebuild/prng50d.json shadow/out.jsonl
If /home/claude paths are gone: re-clone from outputs/handoff/ (code/, search/, shadow/, models/), rebuild sim at the commits in SIM_BUILDS.json, regenerate oracle/prng with shadow/rebuild/oracle_teams.js & capture_prng.js (OWN=, OUT= env).

## FILE MAP (handoff/)
code/: selfplay.js agent.js agent_prior.js agent_search.js agent_v1.js candidates.js features.js own_features.js dex_export.json build_obs.py own_team.py package*.json
models/: stage1_switch.json stage2_move.json value_full.json value_model.json policy_v0.pkl ranker_human.pkl priors.json (opp)
search/: depth3.js agent_depth3.js test_depth3.js
shadow/: fullreplay2.js run_set.sh get_overrides.py search_choices.js split_all.sh own_commit*.json overrides50*.json oracle*.json prng*.json oracle_teams.js capture_prng.js
results/: final*.jsonl reg4B/C reg3D split.jsonl bench_d3_vs_prior_20b.out trap_check10.out
opp2_src/ replacement2/ tera2/ (model folders), FROZEN.md COMMITS.md LESSONS.md PLAN.md README.md
Not included (regenerate): raw logs, obs_*.jsonl.gz, inputs_v2.jsonl, own_candidates.json (8.6MB), exact_logs.zip.
