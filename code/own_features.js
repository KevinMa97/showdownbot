// JavaScript port of own_team.py own_features(req, opp). Same definitions, same inputs.
const fs = require('fs');
const path = require('path');
const DEX = JSON.parse(fs.readFileSync(path.join(__dirname, 'dex_export.json'), 'utf8'));
const AT = JSON.parse(fs.readFileSync(path.join(__dirname, 'ability_table.json'), 'utf8')).fields;
const toid = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const ID2NAME = {}; for (const n of Object.keys(AT)) ID2NAME[toid(n)] = n;
const abilityFields = (id) => AT[ID2NAME[id] || id] || {};
const spTypes = (name) => { const s = DEX.SPECIES[toid(name)] || DEX.SPECIES[toid(String(name).split('-')[0])]; return s ? s.types : []; };
const mv = (name) => DEX.MOVES[toid(name)] || {};
const STATUS_OF_MOVE = { tox: 'psn', psn: 'psn', par: 'par', brn: 'brn', slp: 'slp', frz: 'frz' };
function eff(att, defTypes) {
  if (!att || !defTypes.length) return 1.0;
  let e = 1.0;
  for (const t of defTypes) { const row = DEX.CHART[att] || {}; e *= (row[t] === undefined ? 1 : row[t]); }
  return e;
}
function ownFeatures(req, opp) {
  const team = req.side.pokemon;
  const active = team.filter(p => p.active);
  const alive = team.filter(p => !p.condition.endsWith(' fnt'));
  const bench = alive.filter(p => !p.active);
  const oppTypes = opp.opp_sp ? spTypes(opp.opp_sp) : [];
  const oppAtkTypes = (opp.opp_revealed || []).map(m => mv(m)).filter(m => (m.bp || 0) > 0 && m.type).map(m => m.type);
  const oppSpe = opp.opp_stat_spe || 0;
  const spe = (p) => (p.stats && p.stats.spe) || 0;
  const ids = (p) => p.moves || [];
  const has = (p, key) => ids(p).some(m => mv(m)[key]);
  const checks = (p) => {
    const ts = spTypes(p.details.split(',')[0]);
    if (!oppAtkTypes.length) return 0;
    return oppAtkTypes.every(t => eff(t, ts) < 1) ? 1 : 0;
  };
  const abilityId = (p) => p.baseAbility || p.ability || '';
  const immuneFromAbility = (p) => (abilityFields(abilityId(p)).type_immune || []).some(t => oppAtkTypes.includes(t)) ? 1 : 0;
  const oppStatusKinds = new Set((opp.opp_revealed || []).map(m => mv(m).status).filter(Boolean).map(s => STATUS_OF_MOVE[s]).filter(Boolean));
  const statusBlock = (p) => {
    const ab = abilityFields(abilityId(p));
    return oppStatusKinds.size && (ab.status_immune || []).some(k => oppStatusKinds.has(k)) ? 1 : 0;
  };
  const monOk = (p) => !p.active && !p.condition.endsWith(' fnt');
  let activeHp = 0.0;
  if (active.length) {
    const head = active[0].condition.split(' ')[0].split('/');
    if (head.length === 2 && Number(head[1]) !== 0) activeHp = Number(head[0]) / Number(head[1]);
  }
  const b = (x) => (x ? 1 : 0);
  return {
    own_alive: alive.length,
    own_bench_alive: bench.length,
    own_hazard_setter: b(alive.some(p => has(p, 'hazard'))),
    own_screen_user: b(alive.some(p => has(p, 'screen'))),
    own_pivot_alive: b(bench.some(p => has(p, 'pivot'))),
    own_setup_fast: b(alive.some(p => has(p, 'setup') && spe(p) >= oppSpe)),
    own_setup_any: b(alive.some(p => has(p, 'setup'))),
    own_intimidate_bench: bench.reduce((n, p) => n + (abilityFields(abilityId(p)).switch_in === 'intimidate' ? 1 : 0), 0),
    own_checks: bench.filter(monOk).reduce((n, p) => n + checks(p), 0),
    own_ability_immune: bench.filter(monOk).reduce((n, p) => n + immuneFromAbility(p), 0),
    own_active_hp: activeHp,
    own_status_block_bench: bench.filter(monOk).reduce((n, p) => n + statusBlock(p), 0),
    own_regen_bench: bench.reduce((n, p) => n + (abilityFields(abilityId(p)).heal_on_switch ? 1 : 0), 0),
    own_contact_punish_bench: bench.reduce((n, p) => n + (abilityFields(abilityId(p)).contact_punish ? 1 : 0), 0),
  };
}
module.exports = { ownFeatures };
