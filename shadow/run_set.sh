#!/bin/bash
# Full-game engine replay over one game set. Usage: run_set.sh <own_commit.json> <oracle.json> <prng.json> <out.jsonl>
# Each game runs on its own commit with its own oracle sets and dice. One line per game in <out.jsonl>.
cd /home/claude/showdown-bot
OWN=$1; ORC=$2; PRNG=$3; OUT=$4
: > $OUT
for rid in $(python3 -c "import json,sys;print(' '.join(json.load(open('$OWN')).keys()))"); do
  c=$(python3 -c "import json;print(json.load(open('$OWN'))['$rid'])")
  log=""
  for d in /home/claude/userlogs/logs/raw /home/claude/raw2/raw2 /home/claude/raw3/raw3; do [ -f "$d/$rid.log" ] && log="$d/$rid.log" && break; done
  OVR=$(python3 shadow/get_overrides.py $rid)
  ORACLE=$ORC PRNG=$PRNG ORACLE_PRNG=1 ORACLE_PRNG_EVERY=1 OVERRIDES="$OVR" NODE_PATH=/home/claude/shared_nm/node_modules timeout 150 node shadow/fullreplay2.js $rid /home/claude/ps_builds/$c "$log" 2>/dev/null | grep '"game"' | tail -1 >> $OUT
done
echo SET_DONE >> $OUT
