# Lessons from Metamon (UT-Austin-RPL) and how they apply here

Source: https://github.com/UT-Austin-RPL/metamon (README, May 2026 snapshot). Paper: arXiv 2504.04395.

1. Spectator replays are not player observations. The replay shows what a spectator saw; the server
   sent players extra info. Build the player's view explicitly and mark what is hidden.
   -> Applied: obs/build_obs.py, player-POV records with own team from |request| and only revealed opponent info.
2. Self-play data is the main driver of strength. Diverse agent-vs-agent data matters most, human replays
   are the warm start. -> Applied in plan: self-play rounds with a fixed anchor, keep all data.
3. Version the observation pipeline. A fix to an observation feature degrades models trained on the old one.
   -> Applied: obs_version field on every record ("OBS_V1"); the sim build is pinned per replay.
4. Fixed action space. Metamon uses 13 actions: 4 moves, 5 switches, 4 tera-moves. Ours is move/switch
   with an explicit tera flag. Keep the action space fixed across models.
5. Reward shaping helps RL but +/-100 win/loss is the anchor. Keep the outcome label as ground truth.
6. Evaluate against fixed opponents and fixed team sets. Their GXE numbers are relative to fixed models.
   -> Applied: selfplay.js reports Elo with CI against a named anchor.
7. Their team sets are open-ended, so hidden sets must be inferred from usage stats. Random battles are
   the opposite: a fixed, known pool per species. We measured 99.3% of revealed opponent moves are inside
   the randbats pool, so hidden-set inference is much easier here. Use the pools as the prior.
8. Offline RL and transformer policies need GPUs and days of training. This project runs on one CPU core,
   3 GB RAM, no PyTorch. Plan for gradient-boosted trees and search until GPU access exists.
9. Keep baselines to beat. Metamon's heuristic baselines (Grunt, GymLeader) are the cheapest sanity check.
10. Their version pinning matters: Showdown changes break observations. Each replay here already carries
    its exact commit, so replays are reproducible.
