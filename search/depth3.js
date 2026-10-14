// Depth-3 search over simulator battle states.
// Each ply is one full turn: both sides choose, the engine resolves. The searching side (p1 here) maximises,
// the opponent minimises over its pruned options. Pruning keeps the best two options per side by base power
// and priority. Leaves are scored by material (remaining HP fractions and living Pokemon).
// Input: a Battle at a decision point (requestState 'move' or 'switch'). Deterministic: no clock, no randomness.
const { Battle } = require('@pkmn/sim');

const toId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Legal choices for one side from its request state, pruned to the top two by base power and priority.
function options(battle, sideIdx, topK = 2, allowed = null) {
  const side = battle.sides[sideIdx];
  const rs = battle.requestState;
  const out = [];
  if (rs === 'teampreview') return ['default'];
  const active = side.active[0];
  const mustSwitch = rs === 'switch' || !active || active.hp <= 0;
  if (!mustSwitch) {
    const moves = active.moveSlots.filter((m) => m && m.pp > 0 && !m.disabled);
    const dex = battle.dex;
    moves.sort((a, b) => {
      const ma = dex.moves.get(a.move), mb = dex.moves.get(b.move);
      return (mb.basePower + 40 * mb.priority) - (ma.basePower + 40 * ma.priority);
    });
    for (const m of moves.slice(0, topK)) out.push('move ' + m.move);
    if (out.length === 0) out.push('default');
  }
  // switches: living bench mons; only when forced or as a candidate
  // a trapped Pokemon cannot switch (the simulator rejects the choice)
  const trapped = !!(active && (active.trapped || active.maybeTrapped));   // maybeTrapped: the simulator may reject a switch, so offer none
  const bench = trapped && !mustSwitch ? [] : side.pokemon.map((p, i) => ({ p, i })).filter(({ p, i }) => !p.isActive && !p.fainted && p.hp > 0 && p.status !== 'fnt' && (!allowed || allowed.has(i + 1)));   // the active slot is not a bench slot (it moves after switches)
  for (const { i } of bench.slice(0, mustSwitch ? 5 : 1)) out.push('switch ' + (i + 1));
  if (out.length === 0) out.push('default');
  return out;
}

// One snapshot per node; each child restores from a structured copy of it (cheaper than re-serialising the parent)
function fromSnap(snap) { return Battle.fromJSON(structuredClone(snap)); }

// Material evaluation for side 0 (the searcher): positive is good.
function evaluate(battle) {
  const sum = (side) => {
    let hp = 0, alive = 0;
    for (const p of side.pokemon) if (!p.fainted && p.hp > 0) { alive++; hp += p.hp / p.maxhp; }
    return { hp, alive };
  };
  const a = sum(battle.sides[0]), b = sum(battle.sides[1]);
  if (a.alive === 0) return -100;
  if (b.alive === 0) return 100;
  return (a.hp - b.hp) + 0.5 * (a.alive - b.alive);
}

// Play one full turn with the given choices; returns the resulting battle (a clone) or null if illegal.
function playTurn(battle, c0, c1, snap) {
  const b = fromSnap(snap || battle.toJSON());
  try { b.choose('p1', c0); b.choose('p2', c1); } catch (e) { return null; }
  return b;
}

// Depth-3: our turn, their turn, our turn. Opponent minimises at each of its turns; we maximise.
function search(battle, depth, stats) {
  stats.nodes++;
  if (battle.ended || depth === 0) return evaluate(battle);
  const snap = battle.toJSON();
  const ours = options(battle, 0);
  const theirs = options(battle, 1, 1);   // deeper plies: the opponent's single most damaging option (budget)
  let best = -Infinity;
  for (const c0 of ours) {
    let worst = Infinity;
    for (const c1 of theirs) {
      const next = playTurn(battle, c0, c1, snap);
      const v = next ? search(next, depth - 1, stats) : -Infinity;
      if (v < worst) worst = v;
    }
    if (worst > best) best = worst;
  }
  return best;
}

// Public entry: choose the searcher's (p1) move from a live battle state.
function chooseDepth3(battle, { depth = 3, allowed = null } = {}) {
  const stats = { nodes: 0 };
  const t0 = process.hrtime.bigint();
  const ours = options(battle, 0, 2, allowed);
  const theirs = options(battle, 1);
  let best = { choice: ours[0], value: -Infinity };
  const rootSnap = battle.toJSON();
  for (const c0 of ours) {
    let worst = Infinity;
    for (const c1 of theirs) {
      const next = playTurn(battle, c0, c1, rootSnap);
      const v = next ? search(next, depth - 1, stats) : -Infinity;
      if (v < worst) worst = v;
    }
    if (worst > best.value) best = { choice: c0, value: worst };
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ...best, nodes: stats.nodes, ms: +ms.toFixed(1), options: ours };
}

module.exports = { chooseDepth3, options, evaluate, playTurn };
