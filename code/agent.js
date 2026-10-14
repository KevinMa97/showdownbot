// Heuristic agent v1: belief-based one-ply evaluation.
// Opponent info comes only from public protocol lines (no omniscience).
const { BattleStreams, Dex, toID } = require('@pkmn/sim');
const calc = require('@smogon/calc');
const SETS = require('./data/gen9-randbats.json');

const { BattlePlayer } = BattleStreams;
const gen = calc.Generations.get(9);
const dex = Dex.forGen(9);

const nameOf = (id) => { const s = dex.species.get(id); return s.exists ? s.name : id; };
const parseHP = (s) => {
  const [cur, max] = s.split(' ')[0].split('/').map(Number);
  if (!max) return 0;               // "0 fnt" or malformed
  return cur / max;                 // fraction
};
const isDamaging = (name) => {
  const m = dex.moves.get(name);
  return m.exists && m.basePower > 0 && m.category !== 'Status';
};

function makeMon(speciesName, level, opts = {}) {
  const build = (name) => new calc.Pokemon(gen, name, {
    level: level || 80,
    evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    nature: 'Serious',
    ability: opts.ability,
    item: opts.item,
  });
  try { return build(speciesName); }
  catch {  // cosmetic formes (Vivillon-Polar, etc.) are absent from calc; use base species
    return build(dex.species.get(speciesName).baseSpecies);
  }
}

const dmgCache = new Map();
function dmgFrac(attacker, defender, moveName) {
  const key = `${attacker.species.name}|${attacker.level}|${attacker.ability}|${attacker.item}|${defender.species.name}|${defender.level}|${defender.ability}|${defender.item}|${moveName}`;
  if (dmgCache.has(key)) return dmgCache.get(key);
  let v = 0;
  try {
    const r = calc.calculate(gen, attacker, defender, new calc.Move(gen, moveName));
    const [lo, hi] = r.range();
    v = ((lo + hi) / 2) / defender.maxHP();
  } catch {}
  if (dmgCache.size > 200000) dmgCache.clear();
  dmgCache.set(key, v);
  return v;
}

class HeuristicAgent extends BattlePlayer {
  constructor(stream, opts = {}) {
    super(stream, opts.debug || false);
    this.stats = { fallback: 0, decisions: 0 };
    this.opp = { species: null, level: 80, hp: 1, status: null, revealedMoves: new Set(), ability: null, team: new Set() };
    this.oppHazards = new Set();   // sideCondition ids set on opponent side
    this.oppFainted = 0;
    this.oppSide = null;
  }

  receiveError(error) {
    // Sim rejected our choice. Log it and retry with the first legal move so the game can't stall.
    this.stats.errors = (this.stats.errors || 0) + 1;
    if (this.stats.errors <= 3) console.error('[agent choice error]', error.message.slice(0, 160));
    if (this.lastRequest) this.choose(this.firstLegalMove(this.lastRequest));
  }

  // ---- protocol tracking -------------------------------------------------
  receiveLine(line) {
    if (line.startsWith('|error|')) return this.receiveError(new Error(line.slice(7)));  // sim rejected a choice
    if (line.startsWith('|request|')) return super.receiveLine(line);
    if (!line.startsWith('|')) return;
    const parts = line.split('|');
    const kind = parts[1];
    const ident = parts[2] || '';
    const isOpp = ident.startsWith(this.oppSide || 'p2');
    if (!isOpp && !['switch', 'drag', 'move', '-damage', '-heal', 'faint', '-sidestart', '-sideend'].includes(kind)) return;
    if (kind === 'switch' || kind === 'drag') {
      if (!isOpp) return;
      const det = parts[3].split(', ');
      const species = det[0];
      const lvl = det.find(x => /^L\d+$/.test(x));
      const st = (parts[4] || '').split(' ')[1] || null;
      this.opp = { species, level: lvl ? +lvl.slice(1) : 80, hp: parseHP(parts[4] || '100/100'), status: st,
                   revealedMoves: new Set(), ability: null, team: this.opp.team };
      this.opp.team.add(species);
    } else if (kind === 'move' && isOpp) {
      this.opp.revealedMoves.add(parts[3]);
    } else if (kind === '-damage' || kind === '-heal') {
      if (isOpp) this.opp.hp = parseHP(parts[3]);
    } else if (kind === 'faint' && isOpp) {
      this.opp.hp = 0; this.opp.status = null; this.oppFainted++;
    } else if (kind === '-status' && isOpp) {
      this.opp.status = parts[3];
    } else if (kind === '-curestatus' && isOpp) {
      this.opp.status = null;
    } else if (kind === '-sidestart' && isOpp) {
      const cond = (parts[3] || '').replace(/^move: /, '').toLowerCase().replace(/[^a-z]/g, '');
      this.oppHazards.add(cond);
    } else if (kind === '-sideend' && isOpp) {
      const cond = (parts[3] || '').replace(/^move: /, '').toLowerCase().replace(/[^a-z]/g, '');
      this.oppHazards.delete(cond);
    } else if (kind === '-ability' && isOpp) {
      this.opp.ability = parts[3];
    }
  }

  // ---- decisions ---------------------------------------------------------
  receiveRequest(request) {
    try { return this._decide(request); }
    catch (e) { console.error('[agent error]', e.stack.split('\n').slice(0,4).join(' | ')); this.choose(this.firstLegalMove(request)); }
  }

  _decide(request) {
    this.lastRequest = request;
    if (!this.oppSide) this.oppSide = request.side.id === 'p1' ? 'p2' : 'p1';
    if (request.wait) return;
    this.stats.decisions++;
    if (request.teamPreview) return this.choose('default');
    if (request.forceSwitch) return this.choose(this.bestSwitchForced(request));
    if (!request.active) return this.choose('default');
    if (!this.opp.species) {  // no public info yet: fallback
      this.stats.fallback++;
      return this.choose(this.firstLegalMove(request));
    }
    this.choose(this.bestMove(request));
  }

  ownMon(p) {
    const [cur, max] = p.condition.split(' ')[0].split('/').map(Number);
    const details = p.details.split(', ');
    const lvl = (details.find(x => /^L\d+$/.test(x)) || 'L80').slice(1);
    const mon = makeMon(nameOf(toID(details[0])), +lvl, {
      ability: p.baseAbility || p.ability,
      item: p.item || undefined,
    });
    return { mon, hp: p.condition.endsWith(' fnt') ? 0 : cur / max, raw: p };
  }

  oppMonForCalc() {
    const setInfo = SETS[toID(this.opp.species)];
    const species = nameOf(toID(this.opp.species));
    const mon = makeMon(species, this.opp.level, { ability: this.opp.ability || undefined });
    return { mon, hp: this.opp.hp, setInfo };
  }

  // Candidate damaging moves for opponent: revealed, plus its random-battle movepool.
  oppCandidateMoves(setInfo) {
    const pool = new Set(this.opp.revealedMoves);
    if (setInfo) for (const s of setInfo.sets) for (const m of s.movepool) pool.add(m);
    return [...pool].filter(isDamaging);
  }

  // Expected damage fraction (of ownMon's max HP) the opponent deals per turn.
  // Average over randbats sets of each set's strongest move; revealed moves always count.
  threatOn(ownMon) {
    const { mon: opp, setInfo } = this.oppMonForCalc();
    const revealed = [...this.opp.revealedMoves].filter(isDamaging);
    const revMax = Math.max(0, ...revealed.map(mv => dmgFrac(opp, ownMon, mv)));
    if (!setInfo || !setInfo.sets.length) return revMax;
    let total = 0;
    for (const set of setInfo.sets) {
      const moves = [...revealed, ...set.movepool.filter(isDamaging)];
      total += Math.max(0, ...moves.map(mv => dmgFrac(opp, ownMon, mv)));
    }
    return total / setInfo.sets.length;
  }

  // Best damage fraction of ownMon onto the opponent (of its max HP), and whether it is a KO.
  attackOn(ownMon, moveName) {
    const { mon: opp } = this.oppMonForCalc();
    return dmgFrac(ownMon, opp, moveName);
  }

  bestMove(request) {
    const active = request.active[0];
    const side = request.side.pokemon;
    const me = this.ownMon(side.find(p => p.active));
    const oppInfo = this.oppMonForCalc();
    const oppSpe = oppInfo.mon.stats.spe;
    const mySpe = me.mon.stats.spe;
    const oppPriority = [...this.opp.revealedMoves].some(mv => (dex.moves.get(mv).priority || 0) > 0);
    const oppHPMax = 1;
    // endgame: when I'm down to 2 or fewer, every HP point is worth more
    const myAlive = side.filter(p => !p.condition.endsWith(' fnt')).length;
    const oppAlive = 6 - this.oppFainted;
    const riskMult = myAlive <= 2 && oppAlive >= myAlive ? 1.3 : 1.0;
    let iAmFaster = mySpe > oppSpe;
    const threat = this.threatOn(me.mon);            // of my max HP
    const myHPLeft = me.hp;                           // fraction
    const oppHPLeft = this.opp.hp;                    // fraction

    const options = [];
    const TAX = 0.03;
    active.moves.forEach((m, i) => {
      if (m.disabled) return;
      const data = dex.moves.get(m.id);
      if (!data.exists || data.category === 'Status' || data.basePower === 0) {
        options.push({ choice: `move ${i + 1}`, score: this.statusValue(data, me, threat, oppHPLeft, myHPLeft) });
        return;
      }
      const frac = this.attackOnFrac(me.mon, data.name);
      const dealt = Math.min(frac, oppHPLeft);
      const kills = frac >= oppHPLeft;
      // priority moves go first unless the opponent also has priority
      const myFirst = (data.priority || 0) > (oppPriority ? 1 : 0) ? true
                    : (data.priority || 0) < 0 ? false : iAmFaster;
      let taken = threat * riskMult;
      let score;
      if (kills && myFirst) score = dealt + 0.5;                      // KO before it moves
      else if (kills) score = dealt + 0.3 - taken;                    // trade: it still hits first
      else score = dealt - taken;
      if (taken >= myHPLeft && !(kills && myFirst)) score -= 0.5;     // I faint before I finish
      options.push({ choice: `move ${i + 1}`, score });
    });

    if (!active.trapped) {
      side.forEach((p, i) => {
        if (p.active || p.condition.endsWith(' fnt')) return;
        const b = this.ownMon(p);
        const benchThreat = this.threatOn(b.mon);
        const benchAttack = Math.max(0, ...p.moves.map(id => {
          const d = dex.moves.get(id);
          return d.exists && d.basePower > 0 && d.category !== 'Status' ? this.attackOnFrac(b.mon, d.name) : 0;
        }));
        // switch: take the hit on the incoming mon; value its attack next turn
        const score = -benchThreat + 0.3 * Math.min(benchAttack, 1) - TAX;
        options.push({ choice: `switch ${i + 1}`, score });
      });
    }
    options.sort((a, b) => b.score - a.score);
    return options[0] ? options[0].choice : this.firstLegalMove(request);
  }

  // Value of a non-damaging move, in the same units as damage fractions.
  statusValue(data, me, threat, oppHPLeft, myHPLeft) {
    const safe = threat < 0.25;
    const { mon: opp } = this.oppMonForCalc();
    const oppTypes = opp.species.types;
    const immune = data.type && oppTypes.some(t => dex.getImmunity(data.type, t) === false);
    // hazards: set once, don't stack the same one
    if (data.sideCondition && ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'].includes(data.sideCondition)) {
      if (this.oppHazards.has(data.sideCondition)) return -0.5;
      const w = { stealthrock: 0.15, spikes: 0.1, toxicspikes: 0.08, stickyweb: 0.1 }[data.sideCondition];
      return oppHPLeft > 0.3 ? w : w * 0.3;   // hazards matter less once opp is nearly dead
    }
    // inflicting status
    if (data.status && !immune) {
      if (this.opp.status) return -0.3;
      return oppHPLeft > 0.3 ? 0.12 : 0.03;
    }
    // self-boost
    if (data.boosts && data.target === 'self') {
      return safe && myHPLeft > 0.7 ? 0.2 : -0.15;
    }
    // recovery
    if (data.heal) {
      return safe ? 0.6 * (1 - myHPLeft) : -0.1;
    }
    // protect and other utility: neutral
    return -0.1;
  }

  attackOnFrac(attacker, moveName) {
    const { mon: opp } = this.oppMonForCalc();
    return dmgFrac(attacker, opp, moveName);
  }

  bestSwitchForced(request) {
    const side = request.side.pokemon;
    let best = null;
    side.forEach((p, i) => {
      if (p.active || p.condition.endsWith(' fnt')) return;
      const b = this.ownMon(p);
      const score = -this.threatOn(b.mon) * 100 + b.hp * 20;
      if (!best || score > best.score) best = { i, score };
    });
    return best ? `switch ${best.i + 1}` : 'default';
  }

  firstLegalMove(request) {
    const active = request.active && request.active[0];
    if (!active) return 'default';
    const idx = active.moves.findIndex(m => !m.disabled);
    return idx >= 0 ? `move ${idx + 1}` : 'default';
  }
}

module.exports = { HeuristicAgent };
