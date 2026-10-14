// Offline gen9 random battle match harness. Fully local.
// Usage: node selfplay.js <games> [agentA=heuristic] [agentB=random]
// Sides swap every game so turn-order bias cancels. Reports Elo diff of A vs B with 95% CI.
const { BattleStreams, RandomPlayerAI, Teams } = require('@pkmn/sim');
const { TeamGenerators } = require('@pkmn/randoms');
const { HeuristicAgent } = require('./agent');
const { HeuristicAgent: HeuristicV1 } = { HeuristicAgent: require('./agent_v1').HeuristicAgent };
const { SearchAgent } = require('./agent_search');
const { PriorAgent } = require('./agent_prior');
const { Depth3Agent } = require('./search/agent_depth3');
Teams.setGeneratorFactory(TeamGenerators);

const FORMAT = 'gen9randombattle';


// Legality guard: a choice the request does not allow (fainted switch target, disabled or empty move slot)
// is replaced by the first legal option, and counted. Keeps a single bad choice from ending a game as an error.
const GUARD = { switch: 0, move: 0, default: 0, byAgent: {} };   // every correction the guard makes, reported at the end of the run
function hpSwitch(req) {
  // fallback switch: the living bench Pokemon with the most HP (not the first legal slot)
  let best = null;
  req.side.pokemon.forEach((p, i) => {
    if (i === 0 || p.active || p.condition.endsWith(' fnt')) return;
    const [cur, max] = p.condition.split(' ')[0].split('/').map(Number);
    const frac = max ? cur / max : 0;
    if (!best || frac > best.frac) best = { i, frac };
  });
  return best ? 'switch ' + (best.i + 1) : 'default';
}
function bestLegalMove(req) {
  const { Dex } = require('@pkmn/sim');
  let best = null;
  req.active[0].moves.forEach((m, i) => {
    if (m.disabled || m.pp <= 0) return;
    const bp = Dex.moves.get(m.move).basePower || 0;
    if (!best || bp > best.bp) best = { i, bp };
  });
  return best ? 'move ' + (best.i + 1) : 'default';
}
// Legality guard: a choice the request does not allow is replaced by a ranked legal option (not the first legal one).
// Corrections are counted in GUARD and reported, so benchmarks state how often the agent's choice was illegal.
function guard(agent) {
  agent.corrections = 0;
  const origR = agent.receiveRequest.bind(agent);
  agent.receiveRequest = (req) => { agent._req = req; return origR(req); };
  const origC = agent.choose.bind(agent);
  agent.choose = (c) => {
    const req = agent._req;
    if (process.env.ALLDBG && agent.constructor.name === 'PriorAgent') console.error('PRIOR choose', c, 'fs', !!(req && req.forceSwitch), 'wait', !!(req && req.wait), 'active', !!(req && req.active), 'trapped', !!(req && req.active && req.active[0] && req.active[0].trapped));
    if (!req || !req.side || req.wait) return origC(c);
    if (c === 'default' && req.active && !req.teamPreview) {
      // 'default' on a real decision is not a legal answer: replace it with a ranked legal choice and count it
      GUARD.default = (GUARD.default || 0) + 1; agent.corrections++;
      if (process.env.GDBG) console.error('GUARD default ->', agent.constructor.name, 'fs', !!req.forceSwitch);
      if (req.forceSwitch) { const f = hpSwitch(req); return origC(f); }
      return origC(bestLegalMove(req));
    }
    if (c === 'default') return origC(c);
    const team = req.side.pokemon;
    if (c.startsWith('switch ') && process.env.TRAPDBG) console.error('SWDBG', agent.constructor.name, c, 'fs', !!req.forceSwitch, 'activeTrapped', !!(req.active && req.active[0] && req.active[0].trapped), 'activeCond', req.side.pokemon[0].condition, 'choiceStr', c);
    if (c.startsWith('switch ')) {
      const i = +c.split(' ')[1] - 1, p = team[i];
      const trappedNow = !!(req.active && req.active[0] && (req.active[0].trapped || req.active[0].maybeTrapped));   // a switch the simulator may reject is not offered
      if (!p || p.active || p.condition.endsWith(' fnt') || (trappedNow && !req.forceSwitch)) {
        GUARD.switch++; agent.corrections++;
        GUARD.byAgent[agent.constructor.name] = (GUARD.byAgent[agent.constructor.name] || 0) + 1;
        if (trappedNow && !req.forceSwitch) return origC(bestLegalMove(req));   // a trapped Pokemon cannot switch: the replacement is a move if (process.env.GDBG) console.error('GUARD reject', c, 'team', JSON.stringify(team.map(q => [q.details.split(',')[0], q.condition, q.active])), 'fs', !!req.forceSwitch, 'trapped', !!(req.active && req.active[0].trapped)); GUARD.byAgent[agent.constructor.name] = (GUARD.byAgent[agent.constructor.name] || 0) + 1;
        const fix = typeof agent.bestSwitchForced === 'function' && req.forceSwitch ? agent.bestSwitchForced(req) : hpSwitch(req);
        return origC(fix && fix !== 'default' ? fix : hpSwitch(req));
      }
      return origC(c);
    }
    if (c.startsWith('move ') && req.active) {
      const m = /^move (\d+)/.exec(c), mv = m ? req.active[0].moves[+m[1] - 1] : null;
      if (!mv || mv.disabled || mv.pp <= 0) { GUARD.move++; agent.corrections++; GUARD.byAgent[agent.constructor.name] = (GUARD.byAgent[agent.constructor.name] || 0) + 1; return origC(bestLegalMove(req)); }
    }
    return origC(c);
  };
  return agent;
}

function makeAgent(name, stream, battleRef) {
  if (name === 'depth3') return guard(new Depth3Agent(stream, battleRef));   // depth-3 search on the live battle
  if (name === 'random') return new RandomPlayerAI(stream);
  if (name === 'heuristic') return new HeuristicAgent(stream);      // current (v2)
  if (name === 'heuristic_v1') return new HeuristicV1(stream);      // frozen baseline
  if (name === 'search') return guard(new SearchAgent(stream));            // v3 determinized 2-ply
  if (name === 'prior') return guard(new PriorAgent(stream, { W: +(process.env.PRIOR_W || 0.5), tera: +(process.env.PRIOR_TERA || 0.15) }));
  throw new Error('unknown agent: ' + name);
}

async function playGame(seed, p1Name, p2Name) {
  const bs = new BattleStreams.BattleStream();
  const streams = BattleStreams.getPlayerStreams(bs);
  const battleRef = () => bs.battle;
  const p1 = makeAgent(p1Name, streams.p1, battleRef);
  const p2 = makeAgent(p2Name, streams.p2, battleRef);
  p1.start().catch(e => console.error('p1 crash', e.message));
  p2.start().catch(e => console.error('p2 crash', e.message));
  void streams.omniscient.write(
    `>start ${JSON.stringify({ formatid: FORMAT, seed })}\n` +
    `>player p1 ${JSON.stringify({ name: 'A', seed: seed.map(x => (x + 1) % 65536) })}\n` +
    `>player p2 ${JSON.stringify({ name: 'B', seed: seed.map(x => (x + 2) % 65536) })}`
  );
  let winner = null, turns = 0, error = null;
  const loop = (async () => {
    for await (const chunk of streams.omniscient) {
      for (const line of chunk.split('\n')) {
        if (line.startsWith('|turn|')) turns = +line.split('|')[2];
        else if (line.startsWith('|win|')) winner = line.slice(5) === 'A' ? 'p1' : 'p2';
        else if (line === '|tie') winner = 'tie';
        else if (line.startsWith('|error|')) error = line.slice(7);
      }
      if (winner !== null || error) break;
    }
  })();
  const timeout = new Promise(res => setTimeout(() => res('__timeout'), +(process.env.TIMEOUT_MS || 20000)));
  if ((await Promise.race([loop.then(() => null), timeout])) === '__timeout') error = 'timeout';
  return { winner, turns, error };
}

// Elo diff from score fraction, with 95% CI from binomial normal approx.
function eloReport(wins, losses, draws) {
  const n = wins + losses + draws;
  const score = (wins + draws / 2) / n;
  const clamp = Math.min(Math.max(score, 1e-3), 1 - 1e-3);
  const elo = (p) => -400 * Math.log10(1 / p - 1);
  const se = Math.sqrt(score * (1 - score) / n);
  return {
    score: +score.toFixed(3),
    elo: +elo(clamp).toFixed(0),
    ci95: [+elo(Math.min(Math.max(score - 1.96 * se, 1e-3), 1 - 1e-3)).toFixed(0),
           +elo(Math.min(Math.max(score + 1.96 * se, 1e-3), 1 - 1e-3)).toFixed(0)],
  };
}

async function main() {
  const n = +(process.argv[2] || 100);
  const a = process.argv[3] || 'heuristic';
  const b = process.argv[4] || 'random';
  const r = { wins: 0, losses: 0, draws: 0, error: 0 };
  let totalTurns = 0, done = 0;
  for (let i = 0; i < n; i++) {
    const off = +(process.env.SEED_OFFSET || 0) + i;
    const seed = [off + 1, off * 7 + 3, off * 13 + 5, off * 31 + 11];
    const aIsP1 = i % 2 === 0;
    const res = await playGame(seed, aIsP1 ? a : b, aIsP1 ? b : a);
    if (res.error) { r.error++; if (process.env.LOG_ERR) console.error('ERR', JSON.stringify(seed), aIsP1 ? 'A=p1' : 'A=p2', res.error.slice(0, 160)); continue; }
    done++; totalTurns += res.turns;
    if (res.winner === 'tie') r.draws++;
    else if ((res.winner === 'p1') === aIsP1) r.wins++;
    else r.losses++;
  }
  console.log(JSON.stringify({ guardCorrections: GUARD, A: a, B: b, ...r, avgTurns: done ? +(totalTurns / done).toFixed(1) : 0, ...eloReport(r.wins, r.losses, r.draws) }));
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { playGame, eloReport };
