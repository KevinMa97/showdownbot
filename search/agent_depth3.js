// Depth-3 agent for the self-play harness. Uses the live battle (via battleRef) for the search, and answers
// through the normal player stream with index-based choices. Omniscient: the search sees the true state.
const { BattleStreams } = require('@pkmn/sim');
const { BattlePlayer } = BattleStreams;
const { chooseDepth3 } = require('./depth3');

class Depth3Agent extends BattlePlayer {
  constructor(stream, battleRef) { super(stream); this.battleRef = battleRef; this.searchMs = 0; this.decisions = 0; }
  receiveRequest(request) {
    if (request.wait || (!request.active && !request.forceSwitch && !request.teamPreview)) return;   // nothing to decide for this side
    if (request.teamPreview) return this.choose('default');
    if (request.forceSwitch) return this.choose(this.switchChoice(request));
    const battle = this.battleRef && this.battleRef();
    if (!battle || battle.ended || (battle.requestState !== 'move' && battle.requestState !== 'switch')) return this.choose(this.fallback(request));
    // switches the request allows: living, not already active (the request is the simulator's own view)
    const allowed = new Set(request.side.pokemon.map((p, i) => (i + 1)).filter(n => !request.side.pokemon[n - 1].active && !request.side.pokemon[n - 1].condition.endsWith(' fnt')));
    const r = chooseDepth3(battle, { depth: 3, allowed });
    this.searchMs += r.ms; this.decisions++;
    this.choose(this.toIndex(r.choice, request) || this.fallback(request));
  }
  toIndex(choice, request) {
    if (choice === 'default' || !request.active) return null;
    if (choice.startsWith('switch ')) return choice;                       // switch N is already index-based
    const name = choice.replace(/^move /, '');
    const idx = request.active[0].moves.findIndex(m => m.move === name || m.id === name.toLowerCase().replace(/[^a-z0-9]/g, ''));
    return idx >= 0 ? 'move ' + (idx + 1) : null;
  }
  // a living bench Pokemon from the request (switch N is 1-based over the side's team)
  switchChoice(request) {
    const team = request.side.pokemon;
    const i = team.findIndex((p, k) => k > 0 && !p.condition.endsWith(' fnt') && !p.active);
    return i >= 0 ? 'switch ' + (i + 1) : 'default';
  }
  fallback(request) {
    if (request.forceSwitch) return this.switchChoice(request);
    const idx = request.active && request.active[0].moves.findIndex(m => !m.disabled && m.pp > 0);
    return idx >= 0 ? 'move ' + (idx + 1) : 'default';
  }
}
module.exports = { Depth3Agent };
