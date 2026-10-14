// Full-game replay, turn-keyed driver. Each choice the simulator asks for is answered from the log entries
// for THAT side in THAT turn. A side with no executed action this turn gets a non-executing legal move.
// Lock-in continuations and automatic recharge produce no request and are skipped.
const fs = require('fs');
const game = process.argv[2], root = process.argv[3], realLog = process.argv[4];
const OVR = process.env.OVERRIDES ? JSON.parse(process.env.OVERRIDES) : {}; const DEC = []; let NTOTAL = 0, NDET = 0;
const { BattleStream } = require(root + '/dist/sim/battle-stream.js');
const { Teams, Dex } = require('@pkmn/sim');
const { TeamGenerators } = require('@pkmn/randoms'); Teams.setGeneratorFactory(TeamGenerators);
const dirs = ['/home/claude/userlogs/logs/raw', '/home/claude/raw2/raw2', '/home/claude/raw3/raw3'];
const dir = dirs.find(d => fs.existsSync(`${d}/${game}.json`));
const data = JSON.parse(fs.readFileSync(`${dir}/${game}.json`, 'utf8'));
const start = data.inputlog.split('\n').find(l => l.startsWith('>start'));
const oracle = JSON.parse(fs.readFileSync(process.env.ORACLE || 'shadow/rebuild/oracle_teams.json', 'utf8'))[game];
const st = JSON.parse(fs.readFileSync('/home/claude/exact/state.json', 'utf8'));
let ours = null;
const exLog = st.matches[game] ? `/home/claude/exact/${game}.${st.matches[game].slice(0, 8)}.log` : null;
if (exLog && fs.existsSync(exLog)) for (const l of fs.readFileSync(exLog, 'utf8').split('\n')) if (l.startsWith('|request|')) { const d = JSON.parse(l.slice(9)); if (d.side && d.side.id === 'p1') { const { Dex } = require(root + '/dist/sim/dex.js'); ours = d.side.pokemon.map(p => ({ name: p.details.split(',')[0], species: p.details.split(',')[0], item: p.item, ability: p.baseAbility, moves: p.moves.map(id => Dex.moves.get(id).name || id), level: +(/L(\d+)/.exec(p.details) || [0, 80])[1], gender: (p.details.split(',').map(x => x.trim()).find(x => x === 'M' || x === 'F')) || '', teraType: p.teraType || undefined, nature: 'Serious', evs: { hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85 }, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 } })); break; } }
// the oracle file holds both sides' sets from the replay start; they are our own team when no exact-replay request exists
const ORC = JSON.parse(fs.readFileSync(process.env.ORACLE || 'shadow/rebuild/oracle_teams.json', 'utf8'));
if (!ours && ORC[game + '_p1']) {
  const { Dex } = require(root + '/dist/sim/dex.js');
  ours = ORC[game + '_p1'].map(q => ({ name: q.species, species: q.species, item: q.set.item, ability: q.set.ability, moves: q.set.moves, level: q.level, gender: q.gender || q.set.gender || '', teraType: q.set.teraType, nature: q.set.nature || 'Serious', evs: q.set.evs, ivs: q.set.ivs }));
}
if (!ours || !oracle) { console.log(JSON.stringify({ game, error: 'missing team data' })); process.exit(0); }
// our own real spreads (EVs, IVs, nature) from the replay's start: the request does not carry them
{ const all = ORC; const own1 = all[game + '_p1'];
  if (own1) for (const m of ours) { const b0 = (x) => String(x).split('-')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    const hit = own1.find(q => b0(q.species) === b0(m.species)); if (hit && hit.set) { m.evs = hit.set.evs; m.ivs = hit.set.ivs; if (hit.set.nature) m.nature = hit.set.nature; } } }
const oppSets = oracle.map(p => ({ ...p.set, gender: p.gender || p.set.gender || '' }));
const tid = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
const LOCKED = new Set(['beakblast','focuspunch','shelltrap','bidefend','outrage','thrash','petaldance','rollout','iceball','uproar','hyperbeam','gigaimpact','blastburn','frenzyplant','hydrocannon','rockwrecker','roaroftime','prismaticlaser','meteorassault','eternabeam','skyattack','solarbeam','razorwind','dig','fly','dive','bounce','phantomforce','shadowforce']);
// log entries per side: {turn, kind, name, tera} in log order
const real = fs.readFileSync(realLog, 'utf8').split('\n');
const fainted = { p1: false, p2: false }; const ents = { p1: [], p2: [] }; const pendingCant = { p1: false, p2: false }; const cantReason = { p1: '', p2: '' }; const blockMoved = { p1: false, p2: false }; const encoreOn = { p1: false, p2: false }; const cantAfter = { p1: false, p2: false }; const lastSeen = { p1: null, p2: null }; let turn = 0; const leadSeen = { p1: false, p2: false }; const tera = { p1: false, p2: false };
for (const l of real) {
  const p = l.split('|');
  if (p[1] === 'faint' && p.length > 2) { fainted[p[2].slice(0, 2)] = true; continue; }
  if (p[1] === 'turn' || p[1] === 'upkeep') { if (p[1] === 'turn') fainted.p1 = fainted.p2 = false; blockMoved.p1 = blockMoved.p2 = false; for (const k of ['p1','p2']) if (pendingCant[k]) { ents[k].push({ turn, kind: 'cant', reason: cantReason[k], afterOther: cantAfter[k] }); pendingCant[k] = false; } if (p[1] === 'turn') { turn = +p[2]; tera.p1 = tera.p2 = false; } continue; }
  if (p.length < 3) continue;
  const s = p[2] ? p[2].slice(0, 2) : '';
  if (p[1] === '-singleturn' && p.length > 3 && /^move: /.test(p[3]) && ents[p[2].slice(0, 2)]) {
    const cs = p[2].slice(0, 2), cname = p[3].replace(/^move: /, '').trim();
    ents[cs].push({ turn, kind: 'move', name: cname, tera: false, charge: true }); lastSeen[cs] = { name: tid(cname), turn }; continue;
  }
  if (p[1] === '-heal' && l.includes('Revival Blessing') && p.length > 3) { ents[p[2].slice(0, 2)].push({ turn, kind: 'revive', species: p[2].split(': ')[1].trim(), tera: false }); continue; }   // the log names the revived party member
  if (p[1] === '-start' && p.length > 3 && p[3] === 'Encore' && ents[s]) { encoreOn[s] = true; continue; }   // Encore overrides this side's next choice
  if (p[1] === '-activate' && p.length > 3 && p[3] === 'confusion' && ents[s]) {
    // a confused Pokemon's chosen move may be replaced by a self-hit, leaving no move line: an unlogged action
    const lastC = ents[s][ents[s].length - 1];
    if (lastC && lastC.teraOnly && lastC.turn === turn && lastC.name === null) { lastC.unlogged = true; lastC.teraOnly = false; lastC.tera = true; continue; }   // a Tera followed by a self-hit is one action
    ents[s].push({ turn, kind: 'move', name: null, unlogged: true }); continue;
  }
  if (p[1] === '-terastallize' && ents[s]) {
    // a Tera happens at the start of the action even if the mon faints before its move: its own entry
    tera[s] = true; ents[s].push({ turn, kind: 'move', name: null, tera: true, teraOnly: true }); continue;
  }
  if (!(s === 'p1' || s === 'p2')) continue;
  const forcedByMove = p[1] === 'switch' && /\|\[from\] (Parting Shot|drag)/.test(l);   // the forced side's replacement choice   // a switch forced by a move (Parting Shot, Dragon Tail): not a choice
  if (p[1] === 'switch') { encoreOn[s] = false; if (!leadSeen[s]) { leadSeen[s] = true; continue; } ents[s].push({ turn, kind: 'switch', species: p[3].split(',')[0].trim(), replacement: fainted[s] || forcedByMove }); }
  else if (p[1] === 'move' && !l.includes('|[from]')) {
    pendingCant[s] = false; blockMoved[s] = true; const wasEncored = encoreOn[s]; encoreOn[s] = false;
    // a locked move repeating last turn's move is a continuation, even when the log omits the [from] tag
    const nm = tid(p[3]);
    if (process.env.NOCONT !== '1' && LOCKED.has(nm) && lastSeen[s] && lastSeen[s].name === nm && turn === lastSeen[s].turn + 1) { lastSeen[s] = { name: nm, turn }; tera[s] = false; continue; }
    lastSeen[s] = { name: nm, turn };
    const last = ents[s][ents[s].length - 1];
    if (last && last.teraOnly && last.turn === turn && last.name === null) { last.name = p[3]; last.teraOnly = false; }   // the move of a Tera entry
    else if (last && last.unlogged && last.turn === turn && last.name === null) { last.name = p[3]; last.unlogged = false; last.tera = tera[s]; }   // the move of a confused action
    else if (last && last.kind === 'cant' && last.turn === turn && last.name === null && last.tera) { last.kind = 'move'; last.name = p[3]; last.blockedMove = false; }   // a Tera followed by a sleep or paralysis check and then the move is one action: the move names it
    else ents[s].push({ turn, kind: 'move', name: p[3], tera: tera[s], encored: wasEncored });
    tera[s] = false;
  }
  else if (p[1] === 'cant') {
    if (p[3] && p[3].trim() === 'recharge') ents[s].push({ turn, kind: 'recharge' });
    else if (p[3] && p[3].trim().startsWith('move:') && p[4]) ents[s].push({ turn, kind: 'cant', name: p[4].trim(), blockedMove: true, tera: false });   // the log names the blocked move (Taunt, Disable...)
    else {
      // a Tera logged just before a block is that same action: it becomes the blocked choice, with its Tera
      const last = ents[s][ents[s].length - 1];
      if (last && last.teraOnly && last.turn === turn && last.name === null) { last.kind = 'cant'; last.teraOnly = false; last.tera = true; last.reason = (p[3] || '').trim(); last.afterOther = blockMoved[s === 'p1' ? 'p2' : 'p1']; }
      else { pendingCant[s] = true; cantReason[s] = (p[3] || '').trim(); cantAfter[s] = blockMoved[s === 'p1' ? 'p2' : 'p1']; }
    }
  }
}
const cur = { p1: 0, p2: 0 }; const lastLocked = { p1: null, p2: null }; const lastExec = { p1: null, p2: null };
const stream = new BattleStream(); const lines = [];
(async () => { for await (const c of stream) for (const x of c.split('\n')) lines.push(x); })();
// the starting forme of each Pokemon is the forme in its first switch line (e.g. Minior-Core, Terapagos-Stellar)
const formeOf = {};
for (const l of real) { const q = l.split('|'); if (q[1] === 'switch' && q.length > 3) { const sd = q[2].slice(0, 2); const forme = q[3].split(',')[0].trim(); const base = forme.split('-')[0].toLowerCase().replace(/[^a-z0-9]/g, ''); if (!formeOf[sd + base]) formeOf[sd + base] = forme; } }
const applyForme = (team, side) => team.map(x => { const base = x.species.split('-')[0].toLowerCase().replace(/[^a-z0-9]/g, ''); const f = formeOf[side + base]; return f ? { ...x, species: f, name: f } : x; });
const packed = { p1: require('@pkmn/sim').Teams.pack(applyForme(ours, 'p1')), p2: require('@pkmn/sim').Teams.pack(applyForme(oppSets, 'p2')) };
stream.write(`${start}\n>player p1 ${JSON.stringify({ name: 'A', team: packed.p1 })}\n>player p2 ${JSON.stringify({ name: 'B', team: packed.p2 })}`);
// oracle-only: the replay's dice at turn 1 (same as earlier runs)
let diceSet = false;
const pickEntry = (side, b, want) => {
  // next entry for this side that belongs to the current turn (or is a replacement when want === 'switch')
  for (let i = cur[side]; i < ents[side].length; i++) {
    const e = ents[side][i];
    if (e.kind === 'recharge') { cur[side] = i + 1; continue; }
    if (want === 'switch') {
      // a forced replacement (faint or pivot) is logged in the same turn block as the move that caused it
      if (e.kind === 'switch' && (e.turn === b.turn || e.replacement)) { cur[side] = i + 1; return e; }
      if (e.kind === 'switch' && i === cur[side]) { cur[side] = i + 1; return e; }
      if (e.kind === 'move' || e.kind === 'cant') { cur[side] = i + 1; continue; }
      continue;
    }
    if (e.turn > b.turn) return null;                       // nothing executed this turn for this side
    if (e.kind === 'switch' && e.replacement) return null;  // a replacement after a faint is not this turn's move choice
    if (e.kind === 'move' && lastLocked[side] && tid(e.name) === lastLocked[side]) { cur[side] = i + 1; lastLocked[side] = null; continue; }
    if (e.turn < b.turn) { cur[side] = i + 1; continue; }   // stale entry (should not happen)
    cur[side] = i + 1; return e;
  }
  return null;
};
// one rule for every unexecuted choice: a legal move (not disabled, has PP) with no priority, damaging preferred
const CHARGE = new Set(['beakblast','focuspunch','shelltrap','bidefend','solarbeam','solarblade','skyattack','razorwind','dig','fly','dive','bounce','phantomforce','shadowforce','meteorbeam','freezeshock','iceburn','geomancy','skullbash']);
// effective priority for ordering: the move's base priority plus conditional boosts (Grassy Glide in Grassy Terrain)
const effMovePrio = (sd, name) => { const mv = Dex.moves.get(name); const terr = sd.battle && sd.battle.field ? sd.battle.field.terrain : ''; return mv.priority + ((tid(name) === 'grassyglide' && terr === 'grassyterrain') ? 1 : 0); };
const safeMove = (sd) => {
  // an unlogged choice never starts a charge: a real charge always leaves a log line
  const ok = sd.active[0].moveSlots.filter(m => m && m.pp > 0 && !m.disabled && effMovePrio(sd, m.move) <= 0 && !CHARGE.has(tid(m.move)));
  const dmg = ok.find(m => Dex.moves.get(m.move).basePower > 0);
  const pick = dmg || ok[0];
  return pick ? pick.move : null;
};
const legalMove = (sd) => { const m = sd.active[0] && sd.active[0].moveSlots.find(x => x && x.pp > 0); return m ? 'move ' + m.move : 'default'; };
const pump = () => {
  const b = stream.battle; if (!b) return;
  if (process.env.STATS && b.requestState === 'move' && !pump.statsShown) { pump.statsShown = true; for (let i = 0; i < 2; i++) { const p = b.sides[i].active[0]; console.log('PACKED p' + (i + 1), p.species.name, 'L' + p.level, 'item', p.item, 'stats', JSON.stringify(p.storedStats)); } }
  if (process.env.ORACLE_PRNG_EVERY && b.turn !== pump.lastTurn) {   // oracle only: the replay's dice at the moment each turn starts
    const truth = JSON.parse(fs.readFileSync(process.env.PRNG || 'shadow/rebuild/prng_truth.json', 'utf8'))[game];
    if (truth && truth[String(b.turn)]) { const { PRNG } = require(root + '/dist/sim/prng.js'); b.prng = new PRNG(truth[String(b.turn)], b.prng.startingSeed); }
    pump.lastTurn = b.turn;
  }
  if (process.env.ORACLE_PRNG && !diceSet && b.requestState === 'move') {
    const truth = JSON.parse(fs.readFileSync(process.env.PRNG || 'shadow/rebuild/prng_truth.json', 'utf8'))[game];
    if (truth && truth['1']) { const { PRNG } = require(root + '/dist/sim/prng.js'); b.prng = new PRNG(truth['1'], b.prng.startingSeed); diceSet = true; }
  }
  for (let guard = 0; guard < 4000 && !b.ended; guard++) {
    const rs = b.requestState;
    if (process.env.DRAWLOG && b.prng && !b.prng.__wrapped) { b.prng.__wrapped = true; const origR = b.prng.random.bind(b.prng); b.prng.random = (...a) => { const st = new Error().stack.split('\n').slice(2, 5).map(x => (x.trim().split(' ')[1] || '?')).join('<'); const r = origR(...a); if (process.env.DRAWLOG) console.log('DRAW t' + b.turn, JSON.stringify(a), '->', r, st); return r; }; }
    if (process.env.HITMON && process.env.HITNAME === undefined && false) {} if (process.env.HITMON && b.turn >= (+process.env.HITFROM || 33) && b.turn <= (+process.env.HITTO || 35) && rs === 'move' && !b['__hm' + b.turn]) { b['__hm' + b.turn] = true; const pk = b.sides[0].pokemon.find(p => p.species.name === 'Pawmot'); console.log('SPEED turn', b.turn, 'Pawmot spe', pk && pk.storedStats.spe, 'item', pk && pk.item, 'boosts', pk && JSON.stringify(pk.boosts), 'status', pk && pk.status, 'active', pk && pk.isActive); const hm = b.sides[1].pokemon.find(p => p.species.name === 'Hitmonlee'); if (hm) console.log('SPEED turn', b.turn, 'Hitmonlee spe', hm.storedStats.spe, 'item', hm.item, 'nature', hm.set && hm.set.nature, 'evs', JSON.stringify(hm.set && hm.set.evs), 'boosts', JSON.stringify(hm.boosts), 'status', hm.status, 'moves', hm.moveSlots.map(m => m.move + (Dex.moves.get(m.move).priority ? '(prio ' + Dex.moves.get(m.move).priority + ')' : '')).join(', '), 'spe', hm.storedStats.spe); const m = (b.sides[1].pokemon.concat(b.sides[0].pokemon)).find(p => p.species.name === (process.env.HITNAME || 'Hitmonlee')); console.log('HITMON turn', b.turn, m ? JSON.stringify({ hp: m.hp, maxhp: m.maxhp, status: m.status, statusTime: m.statusState && m.statusState.time, active: m.isActive, fainted: m.fainted, spe: m.storedStats.spe, moves: m.moveSlots.map(x => x.move + (Dex.moves.get(x.move).priority ? '(p' + Dex.moves.get(x.move).priority + ')' : '')).join(',') }) : 'none', 'p2 active', b.sides[1].active[0].species.name); }
    if (process.env.CHOOSE_LOG && !b.__chooseWrapped && b.turn >= +(process.env.CHOOSE_FROM || 12) && b.turn <= +(process.env.CHOOSE_TO || 13)) {   // diagnostic: every choose call
      b.__chooseWrapped = true;
      const origChoose = b.choose.bind(b);
      b.choose = (side, choice) => { const st = new Error().stack.split('\n').slice(2, 4).map(x => x.trim().split(' ')[1]).join(' < '); console.log('CHOOSE turn', b.turn, 'rs', b.requestState, side, JSON.stringify(choice), '@', st); return origChoose(side, choice); };
    }
    if (process.env.QUEUE_LOG && b.turn >= 12 && b.turn <= 13 && !b.queue.__logged) {   // diagnostic: queue inserts, turns 12-13
      b.queue.__logged = true;
      const fmt = (a) => a ? (a.choice + (a.move ? ':' + (a.move.id || a.move) : '') + ' ' + (a.pokemon ? (a.pokemon.species ? a.pokemon.species.name : '?') : '') + ' side=' + (a.pokemon && a.pokemon.side ? a.pokemon.side.id : '?') + (a.order !== undefined ? ' order=' + a.order : '') + (a.priority !== undefined ? ' prio=' + a.priority : '')) : 'null';
      for (const m of ['push', 'unshift', 'insertChoice', 'addChoice', 'prioritizeAction', 'changeAction', 'cancelMove']) { const orig = b.queue[m].bind(b.queue); b.queue[m] = (...args) => { const st = new Error().stack.split('\n').slice(2, 4).map(x => x.trim().split(' ')[1]).join(' < '); const before = b.queue.list ? b.queue.list.length : -1; const r = orig(...args); console.log('QUEUE', m, args.map(x => Array.isArray(x) ? x.map(fmt).join(' | ') : fmt(x)).join(' ;; '), '@', st); return r; }; }
    }
    if (process.env.RNG_LOG && b.turn === +process.env.RNG_LOG && !b.prng.__logged) {   // diagnostic: log every draw this turn
      b.prng.__logged = true;
    const orig = b.prng.random.bind(b.prng);
    b.prng.random = (...a) => { const st = new Error().stack.split('\n').slice(2, 6).map(x => x.trim().split(' ')[1]).join(' < '); const r = orig(...a); console.log('RNG', JSON.stringify(a), '->', r, st); return r; };
  }
    if (rs === 'teampreview') { b.choose('p1', 'default'); b.choose('p2', 'default'); continue; }
    let progressed = false;
    for (const side of ['p1', 'p2']) {
      const sd = side === 'p1' ? b.sides[0] : b.sides[1];
      if (!sd.active[0]) { try { b.choose(side, 'switch 1'); } catch (e) {} progressed = true; continue; }
      if (rs !== 'move' && rs !== 'switch') continue;
      const reqKey = b.turn + '|' + rs + '|' + side;
      pump.answered = pump.answered || new Set();
      // (answer-once keying removed: the simulator re-requests a side after a blocked turn)
      if (sd.isChoiceDone && sd.isChoiceDone()) continue;                       // already answered
      if (rs === 'switch' && !(sd.active[0].fainted || sd.active[0].hp <= 0 || sd.active[0].switchFlag)) continue;   // only a side that must replace
      const want = rs === 'switch' ? 'switch' : 'move';
      if (rs === 'switch' && sd.choice && sd.choice.forcedPassesLeft > 0 && sd.active[0].switchFlag !== 'revivalblessing') { try { b.choose(side, 'pass'); } catch (e) {} progressed = true; continue; }   // the simulator requires a pass first
      if (process.env.PROBE && side === 'p1' && rs === 'switch' && b.turn === 10 && !pump.probed) {
        pump.probed = true;
        const { Battle } = require(root + '/dist/sim/battle.js');
        for (const cand of ['pass', 'switch 5', 'switch 6']) {
          const c = Battle.fromJSON(JSON.parse(JSON.stringify(b.toJSON())));
          try { c.choose('p1', cand); } catch (e) { console.log('PROBE throw', cand, e.message.slice(0, 80)); }
          const err = c.sides[0].choice && c.sides[0].choice.error;
          console.log('PROBE', cand, 'error:', err || '(none)', 'side done:', c.sides[0].isChoiceDone && c.sides[0].isChoiceDone(), 'rs:', c.requestState);
        }
      }
      if (process.env.REVIVE && rs === 'switch' && side === 'p1' && b.turn === 10 && !pump.revived) { pump.revived = true; console.log('REVIVE turn', b.turn, side, 'active', sd.active[0].species.name, 'hp', sd.active[0].hp, 'fainted', sd.active[0].fainted, 'switchFlag', sd.active[0].switchFlag); sd.pokemon.forEach((p, i) => console.log('REVIVE slot', i + 1, p.species.name, 'hp', p.hp + '/' + p.maxhp, 'fainted', p.fainted, 'status', p.status, 'isActive', p.isActive, 'switchFlag', p.switchFlag)); }
      if (process.env.P2SW && rs === 'switch' && side === 'p2' && b.turn === +process.env.P2SW && !pump.p2sw) { pump.p2sw = true; const a = sd.active[0]; console.log('P2SW turn', b.turn, 'active', a.species.name, 'hp', a.hp, 'fainted', a.fainted, 'switchFlag', a.switchFlag, 'forcedSwitchesLeft', sd.choice && sd.choice.forcedSwitchesLeft, 'p1 active hp', b.sides[0].active[0].hp, 'p1 switchFlag', b.sides[0].active[0].switchFlag, 'p1 choice', b.sides[0].choice && b.sides[0].choice.forcedSwitchesLeft); }
      if (rs === 'switch' && sd.active[0].switchFlag === 'revivalblessing' && sd.active[0].hp > 0 && !sd.active[0].fainted) {
        // Revival Blessing: the request is answered by choosing the fainted party member, which revives it; no log entry is used
        const rv = ents[side].slice(cur[side]).find(x => x.kind === 'revive');
        const wantSp = rv ? rv.species.toLowerCase().replace(/[^a-z0-9]/g, '') : null;
        let fi = wantSp ? sd.pokemon.findIndex((p, i) => i > 0 && p.fainted && p.species.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(wantSp.split('-')[0])) : -1;
        if (fi < 0) fi = sd.pokemon.findIndex((p, i) => i > 0 && p.fainted);
        if (fi >= 0) { try { b.choose(side, 'switch ' + (fi + 1)); } catch (err) {} progressed = true; continue; }
      }
      const lock = sd.active[0].volatiles && (sd.active[0].volatiles.lockedmove || sd.active[0].volatiles.twoturnmove);
      if (lock && want === 'move') { const lm = sd.active[0].lastMove && sd.active[0].lastMove.id; try { b.choose(side, lm ? 'move ' + lm : 'default'); } catch (e) { b.choose(side, 'default'); } progressed = true; continue; }   // locked move: no entry used
      const e = pickEntry(side, b, want);
      let choice;
      if (!e && want === 'switch' && sd.active[0].hp > 0 && !sd.active[0].fainted) {
        // no replacement logged for a live active: a Revival Blessing self-switch takes the revived (fainted) party member
        const rv = ents[side].slice(cur[side]).find(x => x.kind === 'revive');
        const wantSp = rv ? rv.species.toLowerCase().replace(/[^a-z0-9]/g, '') : null;
        let fi = wantSp ? sd.pokemon.findIndex((p, i) => i > 0 && p.fainted && p.species.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(wantSp.split('-')[0])) : -1;
        if (fi < 0) fi = sd.pokemon.findIndex((p, i) => i > 0 && p.fainted);
        if (fi >= 0) { try { b.choose(side, 'switch ' + (fi + 1)); } catch (err) {} progressed = true; continue; }
      }
      if (!e) {   // no executed action this turn: repeat the last executed move if it is known, else a non-priority move
        // a priority move would act first and change the turn, so an unexecuted choice must not be priority
        const usable = (m) => m && m.pp > 0 && !m.disabled && effMovePrio(sd, m.move) <= 0;
        const lm = lastExec[side] && sd.active[0].moveSlots.find(m => m && tid(m.move) === lastExec[side] && usable(m));
        const nonPrio = sd.active[0].moveSlots.find(m => usable(m) && Dex.moves.get(m.move).basePower > 0);
        choice = want === 'move' ? (lm ? 'move ' + lm.move : (nonPrio ? 'move ' + nonPrio.move : 'default')) : 'default';   // a move is only legal in a move request
      }
      else if (e.kind === 'move' && e.encored) { const sm = safeMove(sd); choice = sm ? 'move ' + sm : legalMove(sd); lastExec[side] = null; }   // Encore fixes the move; only its priority matters
      else if (e.kind === 'move') {
        if (e.unlogged) { const cand = sd.active[0].moveSlots.filter(m => m && m.pp > 0 && !m.disabled).sort((a, c) => Dex.moves.get(c.move).priority - Dex.moves.get(a.move).priority); choice = cand.length ? 'move ' + cand[0].move : 'default'; }   // a confused action: the highest-priority move (the confusion self-hit then took its place)
        else if (e.name === null) { const m0 = safeMove(sd) || sd.active[0].moveSlots[0].move; choice = 'move ' + m0 + ' terastallize'; lastExec[side] = CHARGE.has(tid(m0)) ? null : tid(m0); }   // Tera with no logged move: the unexecuted-move rule
        else { if (LOCKED.has(tid(e.name))) lastLocked[side] = tid(e.name); else lastLocked[side] = null; lastExec[side] = Dex.moves.get(e.name).basePower > 0 && !CHARGE.has(tid(e.name)) ? tid(e.name) : null;   // only damaging moves are repeated
        choice = 'move ' + e.name + (e.tera ? ' terastallize' : ''); }
      } else if (e.kind === 'switch') {
        const base = (x) => String(x).split('-')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        let i = sd.pokemon.findIndex(p => base(p.species.name) === base(e.species));
        // Illusion: the switch line shows the disguise. If the named Pokemon lacks the next logged move but an Illusion user has it, that user switched in.
        const nxt = ents[side].slice(cur[side]).find(x => x.kind === 'move' && x.name);
        if (i >= 0 && nxt) {
          const hasMove = (q) => q.moveSlots.some(m => m && tid(m.move) === tid(nxt.name));
          if (!hasMove(sd.pokemon[i])) {
            const ill = sd.pokemon.findIndex((q, k) => k > 0 && !q.fainted && /^zoroark/.test(base(q.species.name)) && hasMove(q));
            if (ill >= 0) i = ill;
          }
        }
        choice = i >= 0 ? 'switch ' + (i + 1) : legalMove(sd);
      } else if (e.kind === 'cant') {
        // a blocked action never executes, but its priority decides where its cant line falls in the turn: use the highest-priority move
        // sleep blocks every move, so a sleeping side's blocked move can be any move (Protect's priority still orders the cant line)
        // moves that work or show a message while asleep are excluded; charge moves only when the block comes first (they act after the other side when blocked after it)
        const sleepUsable = new Set(['sleeptalk', 'snore', 'focuspunch', 'beakblast', 'shelltrap', 'bidefend']);   // moves that work or show a message before the block are never fillers
        // paralysis and freeze stop every move before it takes effect, so any move can stand in; only its effective priority (Prankster adds 1 to status) orders the cant line
        const anyMoveBlock = (e.reason === 'par' || e.reason === 'frz') && ['par', 'frz'].includes(sd.active[0].status);
        const effPrio = (m) => { const mv = Dex.moves.get(m.move); const ab = tid(sd.active[0].baseAbility); return mv.priority + ((ab === 'prankster' && mv.category === 'Status') ? 1 : 0) + ((ab === 'triage' && (mv.flags && mv.flags.heal || mv.drain)) ? 3 : 0); };   // Prankster (status +1) and Triage (healing/drain +3)
        // a Charged Pokemon's Charge ends when it attempts an Electric move, even if the move is then blocked: prefer one
        const charged = !!(sd.active[0].volatiles && sd.active[0].volatiles.charge);
        const cand = sd.active[0].moveSlots.filter(m => m && m.pp > 0 && !m.disabled && !sleepUsable.has(tid(m.move)) && ((e.reason === 'slp' && sd.active[0].status === 'slp') || anyMoveBlock || Dex.moves.get(m.move).basePower > 0)).sort((a, c) => {
          const ea = charged && Dex.moves.get(a.move).type === 'Electric' ? 1 : 0, ec = charged && Dex.moves.get(c.move).type === 'Electric' ? 1 : 0;
          if (ea !== ec) return ec - ea;
          return e.afterOther ? effPrio(a) - effPrio(c) : effPrio(c) - effPrio(a); });
        if (e.blockedMove && e.name) choice = 'move ' + e.name;   // the blocked move is named in the log
        else choice = cand.length ? 'move ' + cand[0].move + (e.tera ? ' terastallize' : '') : legalMove(sd);
      } else choice = legalMove(sd);
      if (process.env.TRACE) console.log('TRACE turn', b.turn, 'rs', rs, side, 'entry', e ? JSON.stringify(e) : 'none', '->', choice, 'slots', sd.pokemon.map(p => p.species.name.split('-')[0] + (p.fainted ? '(F)' : '') + (p.isActive ? '*' : '')).join(' '));
      pump.answered.add(reqKey);
      if (process.env.QUEUE_LOG) console.log('DRIVER turn', b.turn, rs, side, '->', choice, 'entry', e ? (e.kind + ':' + (e.name || e.species || '')) : 'none');
      // search support: an override replaces the choice at this decision point; uncertain decisions are recorded with their alternatives
      const ovKey = b.turn + '|' + side + '|' + rs;
      const uncertain = !e || e.unlogged || e.kind === 'cant' || e.name === null || !!e.blockedMove || !!e.teraOnly || !!e.encored;
      if (OVR[ovKey]) choice = OVR[ovKey];
      NTOTAL++; if (!uncertain) NDET++;
      if (uncertain) DEC.push({ key: ovKey, turn: b.turn, side, rs, choice, cands: sd.active[0].moveSlots.filter(m => m && m.pp > 0 && !m.disabled).map(m => m.move) });
      try { b.choose(side, choice); } catch (err) { try { b.choose(side, legalMove(sd)); } catch (e2) {} }
      if (process.env.TRACE2) console.log('TRACE2', b.turn, side, 'rs', b.requestState, 'choice', sd.choice && JSON.stringify(sd.choice).slice(0, 400));
      progressed = true;
    }
    if (!progressed) break;
  }
};
const wait = setInterval(() => { pump(); if (stream.battle && stream.battle.ended) { clearInterval(wait); finish(); } }, 2);
setTimeout(() => { clearInterval(wait); finish(); }, 8000);
let done = false;
function finish() {
  if (done) return; done = true;
  const pct = (l) => l.replace(/(\d+)\/(\d+)/g, (m, a, b) => Math.ceil(100 * (+a) / (+b)) + '%').replace(/^\|(-sidestart|-sideend)\|(p[12]): [^|]*\|/, '|$1|$2|');
  const keep = (l) => l && /^\|(move|switch|drag|faint|cant|win|-|-damage|-heal)/.test(l) && !/^\|-message/.test(l) && !l.startsWith('|j|') && !l.startsWith('|l|') && !l.startsWith('|c|') && !l.startsWith('|c:|') && !l.startsWith('|inactive') && !l.startsWith('|player|') && !l.startsWith('|n|') && !l.startsWith('|t:|') && !l.startsWith('|debug|') && !l.startsWith('|split|') && !l.startsWith('|upkeep') && !l.startsWith('|request') && !l.startsWith('|turn|') && l !== '|';
  const key = (l) => l.split('|').slice(0, 3).join('|');
  const norm = (arr) => { const out = []; for (const x0 of arr.map(z => pct(z.trim()).replace(/^\|win\|.*/, '|win|').replace(/^\|drag\|/, '|switch|').replace(/^\|switch\|(p[12][ab]: [^|]*)\|[^|]*\|/, '|switch|$1|').replace(/^(\|[a-z-]+\|p[12][ab]): [^|]*/, '$1')).filter(keep)) { const x = x0.replace(/\|\[from\] /g, '|').replace(/\|\[still\]/g, '').replace(/\|\[silent\]/g, ''); if (out.length && /^\|(-damage|-heal|switch|-sethp)\|/.test(out[out.length - 1]) && /^\|(-damage|-heal|switch|-sethp)\|/.test(x) && key(out[out.length - 1]) === key(x)) continue; out.push(x); } return out; };
  const sortLeads = (arr) => { const i = arr.findIndex(x => x.startsWith('|turn|')); if (i <= 0) return arr; const head = arr.slice(0, i).filter(x => x.startsWith('|switch|')); const rest = arr.slice(0, i).filter(x => !x.startsWith('|switch|')); return [...head.sort(), ...rest, ...arr.slice(i)]; };
  const simLog = stream.battle && stream.battle.log ? stream.battle.log : lines;
  if (process.env.SIMRAW) require('fs').writeFileSync(process.env.SIMRAW, simLog.join('\n'));
  const realN = norm(sortLeads(real)), simN = norm(sortLeads(simLog));
  let i = 0; while (i < Math.min(realN.length, simN.length) && realN[i] === simN[i]) i++;
  if (process.env.GREP) { const pat = new RegExp(process.env.GREP); console.log('GREP real:\n' + realN.filter(x => pat.test(x)).slice(0, 14).join('\n')); console.log('GREP sim:\n' + simN.filter(x => pat.test(x)).slice(0, 14).join('\n')); }
  if (process.env.DUMP) { const a = Math.max(0, i - 8); console.log('DUMP real:\n' + realN.slice(a, i + 4).join('\n')); console.log('DUMP sim:\n' + simN.slice(a, i + 14).join('\n')); }
  let divTurn = 0; { const rawSim = sortLeads(simLog); for (let L = 1; L <= rawSim.length; L++) { if (norm(rawSim.slice(0, L)).length > i) { for (const x of rawSim.slice(0, L)) { const mt = /^\|turn\|(\d+)/.exec(x); if (mt) divTurn = +mt[1]; } break; } } }
  console.log('RESULT ' + JSON.stringify({ game, first: i, divTurn, decisions: DEC, nTotal: NTOTAL, nDetermined: NDET }));
  console.log(JSON.stringify({ game, realLines: realN.length, simLines: simN.length, exact: JSON.stringify(realN) === JSON.stringify(simN), firstDiffAt: i, real: realN[i] || '<end>', sim: simN[i] || '<end>' }));
  // let stdout flush before the process ends (process.exit can cut large piped output)
}
