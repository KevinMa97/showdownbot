// For each query: opponent's strongest pool move on my mon (threat), my strongest move on the opponent,
// and speed comparison. Output: tera2/results.json, same order as queries.json.
const fs = require('fs');
const calc = require('@smogon/calc');
const { Dex, toID } = require('@pkmn/sim');
const gen = calc.Generations.get(9); const dex = Dex.forGen(9);
const spread = { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 }, iv = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };
const mk = (sp, lvl) => { const s = dex.species.get(sp); const n = s.exists ? s.name : sp;
  const o = { level: lvl || 80, nature: 'Serious', evs: spread, ivs: iv };
  try { return new calc.Pokemon(gen, n, o); } catch { return new calc.Pokemon(gen, s.baseSpecies, o); } };
const frac = (a, d, mvName) => { try { const r = calc.calculate(gen, a, d, new calc.Move(gen, mvName)); const [lo, hi] = r.range(); return ((lo + hi) / 2) / d.maxHP(); } catch { return 0; } };
const isDmg = (name) => { const m = dex.moves.get(name); return m.exists && m.basePower > 0 && m.category !== 'Status'; };
const qs = JSON.parse(fs.readFileSync('tera2/queries.json', 'utf8'));
const out = qs.map(q => {
  const me = mk(q.my_sp, q.my_lvl), op = mk(q.opp_sp, q.opp_lvl);
  const oppMoves = q.opp_moves.filter(isDmg);
  const myMoves = q.my_moves.map(id => dex.moves.get(id)).filter(m => m.exists && m.basePower > 0 && m.category !== 'Status').map(m => m.name);
  const threat = Math.max(0, ...oppMoves.map(m => frac(op, me, m)));
  const offense = Math.max(0, ...myMoves.map(m => frac(me, op, m)));
  return { threat, offense, faster: me.stats.spe > op.stats.spe ? 1 : 0 };
});
fs.writeFileSync('tera2/results.json', JSON.stringify(out));
console.log('results', out.length);
