const { BattleStreams, Teams } = require('@pkmn/sim');
const { TeamGenerators } = require('@pkmn/randoms'); Teams.setGeneratorFactory(TeamGenerators);
const { chooseDepth3, playTurn } = require('./depth3.js');
const s = new BattleStreams.BattleStream(); const st = BattleStreams.getPlayerStreams(s);
(async () => { for await (const _ of st.omniscient) {} })();
st.omniscient.write('>start {"formatid":"gen9randombattle","seed":[21,22,23,24]}\n>player p1 {"name":"A","seed":[31,32,33,34]}\n>player p2 {"name":"B","seed":[41,42,43,44]}');
// advance with random legal choices until turn 4 at a decision point
let guard = 0;
const timer = setInterval(() => {
  const b = s.battle; if (!b) return;
  if (b.requestState === 'teampreview') { b.choose('p1', 'default'); b.choose('p2', 'default'); return; }
  if (b.turn >= 4 && b.requestState === 'move' && !b.ended) {
    clearInterval(timer);
    const r = chooseDepth3(b, { depth: 3 });
    console.log(JSON.stringify({ turn: b.turn, choice: r.choice, value: +r.value.toFixed(3), nodes: r.nodes, ms: r.ms, options: r.options }));
    const chk = playTurn(b, r.choice, r.options[0]); console.log('chosen choice legal (turn advanced):', !!chk);
    process.exit(0);
  }
  if (b.requestState === 'move') { const sd = b.sides[0]; const act = sd.active[0];
    const mv = act.moveSlots.find(m => m && m.pp > 0 && !m.disabled); try { b.choose('p1', mv ? 'move ' + mv.move : 'default'); } catch (e) {} 
    try { const mv2 = b.sides[1].active[0].moveSlots.find(m => m && m.pp > 0 && !m.disabled); b.choose('p2', mv2 ? 'move ' + mv2.move : 'default'); } catch (e) {} }
  else if (b.requestState === 'switch') { try { b.choose('p1', 'switch 2'); } catch (e) {} try { b.choose('p2', 'switch 2'); } catch (e) {} }
  if (++guard > 5000) { console.log('no decision reached'); process.exit(1); }
}, 1);
