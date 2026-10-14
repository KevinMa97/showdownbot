// Oracle: the true opponent sets for each original game, read from the replay's own commit by starting the
// recorded battle (same >start and >player seeds). Used ONLY for the oracle run, never by the bot.
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('/home/claude/exact/state.json', 'utf8'));
const own = JSON.parse(fs.readFileSync(process.env.OWN || 'shadow/own_commit.json', 'utf8'));
const dirs = ['/home/claude/userlogs/logs/raw', '/home/claude/raw2/raw2', '/home/claude/raw3/raw3'];
const out = {};
(async () => {
  for (const rid of Object.keys(own)) {
    const root = '/home/claude/ps_builds/' + own[rid];
    const { BattleStream } = require(root + '/dist/sim/battle-stream.js');
    const dir = dirs.find(d => fs.existsSync(`${d}/${rid}.json`));
    const data = JSON.parse(fs.readFileSync(`${dir}/${rid}.json`, 'utf8'));
    const starts = data.inputlog.split('\n').filter(l => l.startsWith('>start') || l.startsWith('>player'));
    const stream = new BattleStream();
    (async () => { for await (const _ of stream) {} })();
    for (const l of starts) stream.write(l);
    await new Promise(r => setTimeout(r, 200));
    const b = stream.battle;
    if (!b) { out[rid] = null; continue; }
    out[rid + '_p1'] = b.sides[0].pokemon.map(p => ({ species: p.species.name, level: p.level, set: p.set, gender: p.gender }));
    out[rid] = b.sides[1].pokemon.map(p => ({ species: p.species.name, level: p.level, item: p.item, ability: p.baseAbility,
      gender: p.gender, moves: p.moveSlots.map(m => m.move), teraType: p.teraType || p.set?.teraType, set: p.set }));
  }
  fs.writeFileSync(process.env.OUT || 'shadow/rebuild/oracle_teams.json', JSON.stringify(out));
  console.log('oracle teams for', Object.keys(out).length, 'games');
  process.exit(0);
})();
