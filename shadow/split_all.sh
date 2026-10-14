#!/bin/bash
# Split decisions per game: log-determined vs uncertain (needs an override). No overrides applied.
cd /home/claude/showdown-bot
OUT=shadow/split.jsonl; : > $OUT
for set in "own_commit.json oracle_teams.json prng_truth.json A" "own_commit50b.json oracle50b.json prng50b.json B" "own_commit50c.json oracle50c.json prng50c.json C"; do
  set -- $set
  for rid in $(python3 -c "import json;print(' '.join(json.load(open('shadow/$1')).keys()))"); do
    c=$(python3 -c "import json;print(json.load(open('shadow/$1'))['$rid'])")
    L=""; for d in /home/claude/userlogs/logs/raw /home/claude/raw2/raw2 /home/claude/raw3/raw3; do [ -f $d/$rid.log ] && L=$d/$rid.log && break; done
    R=$(OVERRIDES='{}' ORACLE=shadow/rebuild/$2 PRNG=shadow/rebuild/$3 ORACLE_PRNG=1 ORACLE_PRNG_EVERY=1 NODE_PATH=/home/claude/shared_nm/node_modules timeout 150 node shadow/fullreplay2.js $rid /home/claude/ps_builds/$c "$L" 2>/dev/null | grep '^RESULT' | sed 's/^RESULT //')
    echo "{\"set\":\"$4\",\"game\":\"$rid\",\"res\":$R}" >> $OUT
  done
done
echo SPLIT_DONE >> $OUT
