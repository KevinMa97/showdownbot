// Determinized 2-ply matrix search (v3).
// For each randbats set of the opponent (determinization), build a payoff matrix:
//   rows = my options (moves + switches), cols = opponent options (its moves + switch).
// Value of my option = mean over sets of (min over opponent options) => maximin per set, averaged.
// Uses public info only: opp species/HP/status/revealed moves from protocol; sets from randbats.
const { BattleStreams, Dex } = require('@pkmn/sim');
const calc = require('@smogon/calc');
const { HeuristicAgent } = require('./agent');
const SETS = require('./data/gen9-randbats.json');
const { toID } = require('@pkmn/sim');

const dex = Dex.forGen(9);
const gen = calc.Generations.get(9);
const TAX = 0.03;
const isDmg = (name) => { const m = dex.moves.get(name); return m.exists && m.basePower > 0 && m.category !== 'Status'; };

// Build an opponent Pokemon for a given randbats set (ability from that set, no item).
function oppFromSet(species, level, ability) {
  const s = dex.species.get(species);
  const name = s.exists ? s.name : species;
  const build = (n) => new calc.Pokemon(gen, n, {
    level, ability, nature: 'Serious',
    evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  });
  try { return build(name); } catch { return build(s.baseSpecies); }
}

function frac(attacker, defender, moveName) {
  try {
    const r = calc.calculate(gen, attacker, defender, new calc.Move(gen, moveName));
    const [lo, hi] = r.range();
    return ((lo + hi) / 2) / defender.maxHP();
  } catch { return 0; }
}

class SearchAgent extends HeuristicAgent {
  constructor(stream, opts = {}) {
    super(stream, opts);
    this.maxSets = opts.maxSets || 12;
    // budgetMs: wall-clock budget per decision (non-deterministic). Default Infinity = deterministic.
    this.budgetMs = opts.budgetMs !== undefined ? opts.budgetMs : Infinity;
  }

  bestMove(request) {
    const active = request.active[0];
    const side = request.side.pokemon;
    const me = this.ownMon(side.find(p => p.active));
    const myMon = me.mon, myHP = me.hp;
    const oppHP = this.opp.hp;
    const oppSpecies = toID(this.opp.species);
    const setInfo = SETS[oppSpecies];
    const sets = setInfo && setInfo.sets.length ? setInfo.sets : [{ movepool: [], abilities: [] }];
    // subsample sets evenly for speed
    const step = Math.max(1, Math.floor(sets.length / this.maxSets));
    const chosen = sets.filter((_, i) => i % step === 0).slice(0, this.maxSets);

    const revealed = [...this.opp.revealedMoves].filter(isDmg);
    const myMoves = active.moves.map((m, i) => ({ i, m, data: dex.moves.get(m.id) }))
      .filter(x => !x.m.disabled && x.data.exists);
    const bench = side.map((p, i) => ({ p, i: i + 1 })).filter(x => !x.p.active && !x.p.condition.endsWith(' fnt'));
    const benchMons = bench.map(x => ({ slot: x.i, ...this.ownMon(x.p), raw: x.p }));
    const iFastMe = myMon.stats.spe;

    const perSetValue = new Map(); // my option -> array of per-set values
    const addVal = (key, v) => { if (!perSetValue.has(key)) perSetValue.set(key, []); perSetValue.get(key).push(v); };

    // Per-decision time budget: stop adding determinization sets once the budget is spent
    // (after a minimum of 3 sets), so no single turn can run away.
    const deadline = Date.now() + this.budgetMs;
    let done = 0;
    for (const set of chosen) {
      if (done >= 3 && Date.now() > deadline) break;
      done++;
      const ability = (set.abilities && set.abilities[0]) || undefined;
      const oppMon = oppFromSet(this.opp.species, this.opp.level, ability);
      const oppSpe = oppMon.stats.spe;
      const oppMoves = [...new Set([...revealed, ...set.movepool.filter(isDmg)])];
      const oppFirstByDefault = oppSpe > myMon.stats.spe;
      const oppPriority = oppMoves.some(mv => (dex.moves.get(mv).priority || 0) > 0);

      // Opponent options for this set: each damaging move, plus a switch (no damage, small tax)
      const oppDmgOnMe = oppMoves.map(mv => ({ mv, dmg: frac(oppMon, myMon, mv) }));
      const oppDmgOnBench = (bm) => oppMoves.map(mv => frac(oppMon, bm.mon, mv));

      // ---- my move options against each opp option
      for (const { i, m, data } of myMoves) {
        const isAttack = data.category !== 'Status' && data.basePower > 0;
        const myDmg = isAttack ? frac(myMon, oppMon, data.name) : 0;
        const payoffs = [];
        for (const { dmg: oDmg } of oppDmgOnMe) {
          payoffs.push(this.pairPayoff({ myDmg, oDmg, oppHP, myHP, myMon, oppMon, data, oppFirstByDefault, oppPriority, status: !isAttack }));
        }
        payoffs.push(this.pairPayoff({ myDmg, oDmg: 0, oppHP, myHP, myMon, oppMon, data, oppFirstByDefault, oppPriority, status: !isAttack, oppSwitch: true }));
        addVal(`move ${i + 1}`, Math.min(...payoffs));  // opponent picks the move worst for me
      }

      // ---- my switch options against each opp option
      // a trapped Pokemon cannot switch: the sim rejects the choice (and the game stalled before this fix)
      for (const bm of (active.trapped ? [] : benchMons)) {
        const takes = oppDmgOnBench(bm);
        const benchAtk = Math.max(0, ...bm.raw.moves.map(id => {
          const d = dex.moves.get(id);
          return d.exists && d.basePower > 0 && d.category !== 'Status' ? frac(bm.mon, oppMon, d.name) : 0;
        }));
        const payoffs = takes.map(t => -t + 0.3 * Math.min(benchAtk, 1) - TAX);
        payoffs.push(-TAX);  // opponent switches: free hit for me next turn
        addVal(`switch ${bm.slot}`, Math.min(...payoffs));
      }
    }

    // average over determinizations
    const scored = [...perSetValue.entries()].map(([k, arr]) => ({
      choice: k, score: arr.reduce((a, b) => a + b, 0) / arr.length,
    }));
    scored.sort((a, b) => b.score - a.score);
    this.lastScored = scored;   // exposed for prior-based reranking
    return scored.length ? scored[0].choice : this.firstLegalMove(request);
  }

  // One-turn exchange of my move vs one opponent move, with speed and KO handling.
  pairPayoff({ myDmg, oDmg, oppHP, myHP, data, oppFirstByDefault, oppPriority, status, oppSwitch }) {
    const myPriority = data.priority || 0;
    const iFirst = myPriority > (oppPriority ? 1 : 0) ? true
                 : myPriority < 0 ? false : !oppFirstByDefault;
    const dealt = Math.min(myDmg, oppHP);
    const kills = myDmg >= oppHP && !status;
    if (oppSwitch) return (status ? 0.1 : dealt) - TAX;       // opp switches out: I get the attack's value, no hit
    if (iFirst) {
      if (kills) return dealt + 0.5;                          // KO before it moves
      if (oDmg >= myHP) return dealt - 1;                     // it KOs me after my hit
      return dealt - oDmg;
    }
    // opponent first
    if (oDmg >= myHP) return -1;                              // I die before acting
    if (kills) return dealt + 0.3 - oDmg;
    return dealt - oDmg;
  }
}

module.exports = { SearchAgent };
