// Structural fix for unlogged and blocked actions: a search over the uncertain decisions of one game.
// The driver replays the game; each uncertain decision (no logged action, a blocked action, or a Tera-only
// action) can be overridden. Greedy search: at the latest uncertain decision at or before the first divergence,
// try its legal alternatives and keep any override that moves the first divergence later.
// Usage: node search_choices.js <game> <commit> <reallog> <oracle.json> <prng.json> [maxRuns]
const { spawnSync } = require('child_process');
const [game, commit, reallog, oracle, prng, maxRunsArg] = process.argv.slice(2);
const maxRuns = +(maxRunsArg || 40);
let runs = 0;
function run(ovr) {
  runs++;
  const r = spawnSync('node', ['shadow/fullreplay2.js', game, '/home/claude/ps_builds/' + commit, reallog], {
    env: { ...process.env, ORACLE: oracle, PRNG: prng, ORACLE_PRNG: '1', ORACLE_PRNG_EVERY: '1', OVERRIDES: JSON.stringify(ovr), NODE_PATH: '/home/claude/shared_nm/node_modules' },
    encoding: 'utf8', timeout: 170000, maxBuffer: 512 * 1024 * 1024 });
  const out = r.stdout || '';
  const lines = out.split('\n'); const resLine = lines.find(x => x.startsWith('RESULT ')); const finLine = lines.find(x => x.startsWith('{"game"'));
  const res = resLine ? [null, resLine.slice(7)] : null, fin = finLine ? [null, finLine] : null;
  if (!res) return null;
  const R = JSON.parse(res[1]); const F = fin ? JSON.parse(fin[1]) : {};
  R.matched = !!(F.exact || (F.real || '').startsWith('|win|') || (F.sim || '').startsWith('|win|'));
  return R;
}
let ovr = {};
let cur = run(ovr);
if (!cur) { console.log(JSON.stringify({ game, error: 'no result' })); process.exit(0); }
const start = cur.first;
let improved = true;
while (!cur.matched && improved && runs < maxRuns) {
  improved = false;
  const limit = cur.divTurn > 0 ? cur.divTurn : 1e9; const cands = cur.decisions.filter(d => d.turn <= limit && !(d.key in ovr)).sort((a, b) => b.turn - a.turn);
  search: for (const d of cands) {
    for (const alt of d.cands) {
      if (alt === d.choice.replace(/^move /, '') || runs >= maxRuns) continue;
      const trial = { ...ovr, [d.key]: 'move ' + alt + (d.choice.includes('terastallize') ? ' terastallize' : '') };
      const r = run(trial);
      if (r && (r.first > cur.first || r.matched)) { ovr = trial; cur = r; improved = true; break search; }
    }
  }
}
console.log(JSON.stringify({ game, matched: cur.matched, startFirst: start, finalFirst: cur.first, divTurn: cur.divTurn, overrides: ovr, runs }));
