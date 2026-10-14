// Per-candidate features for ranking the action taken in each decision (v2 feature set).
// Candidates = randbats movepool of my species (+ chosen move if missing) + 'switch'.
// Usage: node features.js decisions.json candidates.json
const fs = require('fs');
const calc = require('@smogon/calc');
const { Dex, toID } = require('@pkmn/sim');
const SETS = require('./data/gen9-randbats.json');
const gen = calc.Generations.get(9);
const dex = Dex.forGen(9);

const HAZARDS = ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'];
const SCREENS = ['reflect', 'lightscreen', 'auroraveil'];
const spread = { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 };
const iv = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

const ILLUSION = new Set(['zoroark', 'zoroarkhisui']);
function mon(sp, lvl, ability) {
  const id = toID(sp);
  if (ILLUSION.has(id) && SETS[id] && SETS[id].level) lvl = SETS[id].level;  // Illusion Level Mod
  const s = dex.species.get(sp);
  const name = s.exists ? s.name : sp;
  const build = (n) => new calc.Pokemon(gen, n, { level: lvl || 80, nature: 'Serious', evs: spread, ivs: iv, ability });
  try { return build(name); } catch { return build(s.baseSpecies); }
}
function setsFor(sp) { const s = SETS[toID(sp)]; return s ? s.sets : []; }
// Tera pool = union of teraTypes over the species' randbats sets
function teraPool(sp) {
  const set = new Set();
  for (const s of setsFor(sp)) for (const t of (s.teraTypes || [])) set.add(t);
  return [...set];
}
function teraMon(sp, lvl, ability, teraType) {
  const m = mon(sp, lvl, ability);
  m.teraType = teraType; m.isTerastallized = true;
  return m;
}
function pool(sp) {
  const set = new Set();
  for (const s of setsFor(sp)) for (const m of s.movepool) set.add(m);
  return [...set];
}
function abilityFor(sp) {
  const s = setsFor(sp);
  return s.length && s[0].abilities ? s[0].abilities[0] : undefined;
}
// Damage fraction with the attacker terastallized into teraType (built as a real Pokemon, not a copy)
function fracT(att, def, mv, teraType) {
  const attT = new calc.Pokemon(gen, att.species.name, {
    level: att.level, nature: 'Serious', evs: spread, ivs: iv,
    ability: att.ability, teraType, isTerastallized: true,
  });
  const r = calc.calculate(gen, attT, def, new calc.Move(gen, mv));
  const [lo, hi] = r.range();
  return ((lo + hi) / 2) / def.maxHP();
}
function frac(att, def, mv) {
  try {
    const r = calc.calculate(gen, att, def, new calc.Move(gen, mv));
    const [lo, hi] = r.range();
    return ((lo + hi) / 2) / def.maxHP();
  } catch { return 0; }
}
const isDamage = (d) => d.exists && d.basePower > 0 && d.category !== 'Status';
// type-chart relation of a move type vs a list of defending types: 2 = immune, -1 resist, 0 neutral, >0 SE
function relation(moveType, defTypes) {
  if (!moveType || !defTypes.length) return { immune: 0, eff: 0 };
  const immune = defTypes.some(t => dex.getImmunity(moveType, t) === false) ? 1 : 0;
  const eff = dex.getEffectiveness(moveType, defTypes);
  return { immune, eff };
}
function speciesTypes(sp) {
  const s = dex.species.get(sp);
  return s.exists ? s.types : [];
}

// Sleep Clause Mod: only one foe may be asleep at once
const sleepBlocked = (data) => (data.exists && data.status === 'slp' ? 1 : 0);


// Build candidate rows for one decision row d. Returns array; di is set by caller.
function candidateRows(d, di) {
  const out = [];
  if (!d.my_sp || !d.opp_sp) return out;


  const me = mon(d.my_sp, d.my_lvl, abilityFor(d.my_sp));
  const op = mon(d.opp_sp, d.opp_lvl, abilityFor(d.opp_sp));
  const oppTypes = op.species.types;
  const myHP = d.my_hp, oppHP = d.opp_hp;
  const oppRevealedAtk = (d.opp_revealed || []).filter(m => isDamage(dex.moves.get(m)));
  let threat;
  if (oppRevealedAtk.length) threat = Math.max(...oppRevealedAtk.map(m => frac(op, me, m)));
  else {
    const p = pool(d.opp_sp).filter(m => isDamage(dex.moves.get(m)));
    threat = p.length ? Math.max(...p.map(m => frac(op, me, m))) : 0;
  }
  const benchTypes = (d.opp_seen || []).map(speciesTypes).filter(t => t.length);
  const mySpe = me.stats.spe, oppSpe = op.stats.spe;
  const benchAlive = Math.max(0, 6 - d.my_fainted - 1);
  const oppAsleep = d.opp_asleep_n || 0;
  const myTeraAvail = d.my_tera_avail ? 1 : 0, oppTeraAvail = d.opp_tera_avail ? 1 : 0;
  const myTeraPool = teraPool(d.my_sp);
  // Species Clause: opponent has at most 6 distinct species; seen = already on field/bench
  const oppSeenN = 1 + (d.opp_seen || []).length;
  const oppUnseen = Math.max(0, 6 - oppSeenN);
  const myPool = pool(d.my_sp).map(m => dex.moves.get(m));
  const myCanSetup = myPool.some(m => m.exists && m.boosts && m.target === 'self') ? 1 : 0;
  const myCanScreen = myPool.some(m => m.exists && SCREENS.includes(m.sideCondition)) ? 1 : 0;

  let cands = pool(d.my_sp);
  const isSwitchLabel = d.label === 'switch' || d.label === 'pivot_replacement';
  if (!isSwitchLabel && !cands.includes(d.label)) cands.push(d.label);
  for (const mv of cands) {
    const data = dex.moves.get(mv);
    const exists = data.exists;
    const isAtk = isDamage(data);
    const dmg = isAtk ? frac(me, op, data.name) : 0;
    const kills = dmg >= oppHP - 0.01;  // HP Percentage Mod: HP shown in whole %
    // Tera: best damage over my remaining tera pool (only if I can still tera)
    let dmgTera = 0;
    if (isAtk && myTeraAvail) {
      for (const t of myTeraPool) {
        try { dmgTera = Math.max(dmgTera, fracT(me, op, data.name, t)); } catch {}
      }
    }
    const killTera = myTeraAvail && dmgTera >= oppHP - 0.01 ? 1 : 0;
    const acc = exists && typeof data.accuracy === 'number' ? data.accuracy / 100 : 1;
    const rel = exists && data.type ? relation(data.type, oppTypes) : { immune: 0, eff: 0 };
    // switch read: fraction of the opponent's known bench this move hits badly (immune/resist) or well (SE)
    let benchRes = 0, benchSE = 0;
    if (exists && data.type && benchTypes.length) {
      for (const t of benchTypes) {
        const r = relation(data.type, t);
        if (r.immune || r.eff < 0) benchRes++;
        if (r.eff > 0) benchSE++;
      }
      benchRes /= benchTypes.length; benchSE /= benchTypes.length;
    }
    const isHazard = exists && HAZARDS.includes(data.sideCondition) ? 1 : 0;
    const isScreen = exists && SCREENS.includes(data.sideCondition) ? 1 : 0;
    const isSetup = exists && data.boosts && data.target === 'self' ? 1 : 0;
    const isHeal = exists && data.heal ? 1 : 0;
    const isStatus = exists && data.status ? 1 : 0;
    const isProtect = exists && data.stallingMove ? 1 : 0;
    out.push({
      di, cand: exists ? data.name : mv, is_switch: 0, label: mv === d.label ? 1 : 0,
      dmg_on_opp: dmg, kills_opp: kills ? 1 : 0,
      ev_dmg: dmg * acc, ev_kill: (kills ? 1 : 0) * acc, acc,
      sleep_blocked: sleepBlocked(data), opp_asleep_n: oppAsleep, opp_seen_n: oppSeenN, opp_unseen_n: oppUnseen,
      my_tera_avail: myTeraAvail, opp_tera_avail: oppTeraAvail, dmg_tera: dmgTera,
      tera_boost: dmgTera - dmg, kill_tera: killTera, my_fodder: d.my_hp < 0.25 && benchAlive > 0 ? 1 : 0,
      opp_threat: threat, my_hp: myHP, opp_hp: oppHP,
      power: exists ? (data.basePower || 0) : 0,
      priority: exists ? (data.priority || 0) : 0,
      is_status: isAtk ? 0 : 1, is_phys: exists && data.category === 'Physical' ? 1 : 0,
      eff: rel.eff, immune_cur: rel.immune, bench_res_frac: benchRes, bench_se_frac: benchSE,
      is_hazard: isHazard, is_screen: isScreen, is_setup: isSetup, is_heal: isHeal,
      is_status_inflict: isStatus, is_protect: isProtect,
      my_faster: mySpe > oppSpe ? 1 : 0, my_stat_spe: mySpe, opp_stat_spe: oppSpe,
      bench_alive: benchAlive, my_can_setup: myCanSetup, my_can_screen: myCanScreen,
    });
  }
  // switch candidate
  out.push({
    di, cand: 'switch', is_switch: 1, label: d.label === 'switch' ? 1 : 0,
    sleep_blocked: 0, opp_asleep_n: oppAsleep, opp_seen_n: oppSeenN, opp_unseen_n: oppUnseen,
    my_tera_avail: myTeraAvail, opp_tera_avail: oppTeraAvail, dmg_tera: 0, tera_boost: 0, kill_tera: 0,
    my_fodder: d.my_hp < 0.25 && benchAlive > 0 ? 1 : 0,
    dmg_on_opp: 0, kills_opp: 0, ev_dmg: 0, ev_kill: 0, acc: 1,
    opp_threat: threat, my_hp: myHP, opp_hp: oppHP, power: 0, priority: 0,
    is_status: 0, is_phys: 0, eff: 0, immune_cur: 0, bench_res_frac: 0, bench_se_frac: 0,
    is_hazard: 0, is_screen: 0, is_setup: 0, is_heal: 0, is_status_inflict: 0, is_protect: 0,
    my_faster: mySpe > oppSpe ? 1 : 0, my_stat_spe: mySpe, opp_stat_spe: oppSpe,
    bench_alive: benchAlive, my_can_setup: myCanSetup, my_can_screen: myCanScreen,
  });

  return out;
}
module.exports = { candidateRows, mon, pool, teraPool, frac };
if (require.main === module) {
  const decisions = JSON.parse(fs.readFileSync(process.argv[2]));
  const out = [];
  // NDJSON output: one candidate row per line (large inputs exceed a single JSON string)
  const fd = fs.openSync(process.argv[3], 'w');
  let n = 0;
  decisions.forEach((d, di) => {
    const rows = candidateRows(d, di);
    n += rows.length;
    if (rows.length) fs.writeSync(fd, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  });
  fs.closeSync(fd);
  console.log('candidate rows', n, 'decisions', decisions.length);
}
