# Plan (restructured)

Target: ~2000 Elo on the random-battle ladder (about the top 500 band per the Smogon/Reddit guides; verify
on a calibrated test before claiming it). 2500 is a stretch goal, not a near-term target.

## Layout
- obs/        Step 1. Replay -> player-POV observation records (OBS_V1). build_obs.py
- features/   Step 2. Damage calcs and features as inputs, not labels: candidates.js, own_features.js, own_team.py,
              dex_export.json, ability_table.json, data/gen9-randbats.json
- models/     Step 3. Behavior cloning baselines: export_models.py (switch, move, value, tera models)
- agents/     Search and prior agents: agent_search.js, agent_prior.js, agent.js (heuristic v1/v2)
- rl/         Step 4. Offline RL. Not started: needs GPU. Interface = the OBS_V1 records + won label.
- selfplay/   Step 5. Local self-play rounds: selfplay_gen.js, loop_round.py, benchmarks via selfplay.js
- data_pipeline/  replay export (export_replays.py), exact replay (exact_driver.py, replay_exact.js)

## Steps
1. Observations (done for 624 games: 28,740 player-POV records, 99.9% legal-move consistency).
2. Damage calc features (done: candidate rows with calc damage, Tera damage, accuracy-weighted kills).
3. Behavior cloning (done as stage models: switch 83%, move 36%; value AUC 0.70 on human replays).
4. Offline RL (not started; GPU needed). Input: OBS_V1 records. Reward: win/loss.
5. Self-play fine-tune against the local server or the in-process sim (done as rounds 1-2 data generation;
   no improvement round measured yet).

## Known gaps
- Sim2sim gap: the own-team view is exact (from requests), opponent hidden info is inferred from randbats pools.
- Timeouts (~8% of games) in the search agent need fixing before long self-play runs.
- No rated test against humans or ladder; the 2000 target cannot be confirmed until one exists.
