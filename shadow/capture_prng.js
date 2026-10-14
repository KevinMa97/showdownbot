// ORACLE ONLY: the replay's true random-number state at the start of each turn, from its own commit.
// The bot never has this; it is used only to separate reconstruction error from dice.
const fs = require('fs');
const own = JSON.parse(fs.readFileSync(process.env.OWN || 'shadow/own_commit.json', 'utf8'));
const dirs = ['/home/claude/userlogs/logs/raw', '/home/claude/raw2/raw2', '/home/claude/raw3/raw3'];
const out = {};
(async () => {
  for (const rid of Object.keys(own)) {
    const { BattleStream } = require('/home/claude/ps_builds/' + own[rid] + '/dist/sim/battle-stream.js');
    const dir = dirs.find(d => fs.existsSync(`${d}/${rid}.json`));
    const data = JSON.parse(fs.readFileSync(`${dir}/${rid}.json`, 'utf8'));
    const stream = new BattleStream(); const turns = {};
    (async () => { for await (const _ of stream) {} })();
    const inputs = data.inputlog.split('\n').filter(l => l.startsWith('>') && !l.startsWith('>version'));
    let last = 0;
    for (const l of inputs) {
      stream.write(l);
      const b = stream.battle;
      if (b && b.turn !== last) { last = b.turn; if (!turns[last]) turns[last] = b.toJSON().prng; }   // the CURRENT generator state at turn start (differs from the starting seed)
    }
    out[rid] = turns;
    await new Promise(r => setTimeout(r, 50));
  }
  fs.writeFileSync(process.env.OUT || 'shadow/rebuild/prng_truth.json', JSON.stringify(out));
  console.log('prng captured for', Object.keys(out).length, 'games');
  process.exit(0);
})();
