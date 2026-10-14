// PriorAgent: SearchAgent whose options are reranked by learned priors and a Tera rule.
//   final(option) = search score + W * log(prior probability of the option)
// Priors: stage 1 (switch vs move) and stage 2 (which move) gradient-boosted trees, exported from Python.
const path = require('path');
const { SearchAgent } = require('./agent_search');
const { candidateRows } = require('./candidates');
const { ownFeatures } = require('./own_features');
const { predict, load } = require('./value_infer');
const { Dex, toID } = require('@pkmn/sim');
const dex = Dex.forGen(9);

const DIR = __dirname;
let M1 = null, M2 = null;
function models() {
  if (!M1) { M1 = load(path.join(DIR, 'stage1_switch.json')); M2 = load(path.join(DIR, 'stage2_move.json')); }
  return [M1, M2];
}
const MOVE_KEYS = ['dmg_on_opp','kills_opp','ev_dmg','ev_kill','acc','opp_threat','my_hp','opp_hp','power','priority',
  'is_status','is_phys','eff','immune_cur','bench_res_frac','bench_se_frac','is_hazard','is_screen',
  'is_setup','is_heal','is_status_inflict','is_protect','my_faster','my_stat_spe','opp_stat_spe',
  'bench_alive','my_can_setup','my_can_screen','sleep_blocked','opp_asleep_n','opp_seen_n','opp_unseen_n',
  'tera_boost','kill_tera','dmg_tera','my_tera_avail','opp_tera_avail','my_fodder'];
const OWN_KEYS = ['own_alive','own_bench_alive','own_hazard_setter','own_screen_user','own_pivot_alive','own_setup_fast',
  'own_setup_any','own_intimidate_bench','own_checks','own_ability_immune','own_active_hp',
  'own_status_block_bench','own_regen_bench','own_contact_punish_bench'];

class PriorAgent extends SearchAgent {
  constructor(stream, opts = {}) {
    super(stream, opts);
    this.W = opts.W !== undefined ? opts.W : 0.5;          // prior weight
    this.TERA = opts.tera !== undefined ? opts.tera : 0.15; // bonus for a tera move that turns a non-KO into a KO
    this.myRating = opts.myRating || 2300;
    this.oppRating = opts.oppRating || 2300;
    this.turn = 0; this.oppAsleep = new Set(); this.oppTeraUsed = false;
    this.priorStats = { used: 0, teraChoices: 0 };
    this.logRows = opts.logRows ? [] : null;   // when set, every decision is recorded for training
  }

  receiveLine(line) {
    super.receiveLine(line);
    if (!line.startsWith('|')) return;
    const parts = line.split('|'); const kind = parts[1]; const ident = parts[2] || '';
    const isOpp = this.oppSide && ident.startsWith(this.oppSide);
    if (kind === 'turn') this.turn = +parts[2];
    if (kind === '-status' && isOpp && parts[3] === 'slp') this.oppAsleep.add(this.opp.species);
    if ((kind === '-curestatus' || kind === 'faint') && isOpp) this.oppAsleep.delete(this.opp.species);
    if (kind === '-terastallize' && isOpp) this.oppTeraUsed = true;
  }

  bestMove(request) {
    const choice = super.bestMove(request);
    if (!this.lastScored || !this.opp.species || !request.active) return choice;
    try { return this.rerank(request, choice); }
    catch (e) { console.error('[prior error]', e.message.slice(0, 120)); return choice; }
  }

  buildRow(request) {
    const side = request.side.pokemon;
    const act = side.find(p => p.active);
    const det = act.details.split(',');
    const lvlM = det.find(x => /^L\d+$/.test(x.trim()));
    const myLvl = lvlM ? +lvlM.trim().slice(1) : 80;
    const [hpNum, hpMax] = act.condition.split(' ')[0].split('/').map(Number);
    const myFainted = side.filter(p => p.condition.endsWith(' fnt')).length;
    const seen = [...this.opp.team].filter(x => x !== this.opp.species);
    return {
      my_sp: dex.species.get(det[0]).name || det[0],
      my_lvl: myLvl, my_hp: hpMax ? hpNum / hpMax : 0, my_st: null,
      opp_sp: this.opp.species, opp_lvl: this.opp.level, opp_hp: this.opp.hp, opp_st: this.opp.status,
      opp_revealed: [...this.opp.revealedMoves], opp_seen: seen,
      my_revealed: [], my_fainted: myFainted, opp_fainted: this.oppFainted || 0,
      opp_asleep_n: this.oppAsleep.size, tera_now: 0,
      my_tera_avail: request.active[0].canTerastallize ? 1 : 0, opp_tera_avail: this.oppTeraUsed ? 0 : 1,
      my_rating: this.myRating, opp_rating: this.oppRating, turn: this.turn, label: 'switch',
    };
  }

  rerank(request, chosen) {
    const [M1, M2] = models();
    const d = this.buildRow(request);
    const act = request.side.pokemon.find(p => p.active);
    const own = ownFeatures(request, d);
    // ---- stage 1: P(switch)
    const s1 = {
      my_hp: d.my_hp, opp_hp: d.opp_hp, my_fainted: d.my_fainted, opp_fainted: d.opp_fainted, turn: d.turn,
      my_lvl: d.my_lvl, opp_lvl: d.opp_lvl, ...own,
    };
    const x1 = [...['my_hp','opp_hp','my_fainted','opp_fainted','turn','my_lvl','opp_lvl'].map(k => s1[k]),
                ...OWN_KEYS.map(k => own[k]), 1 + d.opp_seen.length,
                d.my_rating, d.opp_rating, 1];
    const pSw = Math.min(0.98, Math.max(0.02, predict(M1, x1)));
    // ---- stage 2: candidate move scores from candidate rows (pool moves)
    const rows = candidateRows(d, 0).filter(r => !r.is_switch);
    const byName = new Map(rows.map(r => [r.cand, r]));
    const moveOpts = [];
    (request.active[0].moves || []).forEach((m, i) => {
      if (m.disabled) return;
      const name = dex.moves.get(m.id).name || m.move;
      const row = byName.get(name);
      const x2 = row ? [...MOVE_KEYS.map(k => row[k]), ...OWN_KEYS.map(k => own[k])] : null;
      moveOpts.push({ i, name, s: x2 ? predict(M2, x2) : 0.01, row });
    });
    const sum = moveOpts.reduce((a, o) => a + o.s, 0) || 1;
    const q = new Map(moveOpts.map(o => [o.i, o.s / sum]));
    // ---- combine with search scores
    const benchCount = request.side.pokemon.filter(p => !p.active && !p.condition.endsWith(' fnt')).length;
    const finals = [];
    for (const opt of this.lastScored) {
      let m, base = opt.score;
      if ((m = /^move (\d+)$/.exec(opt.choice))) {
        const i = +m[1] - 1;
        const qm = q.get(i) || 1e-3;
        finals.push({ choice: opt.choice, score: base + this.W * (Math.log(1 - pSw) + Math.log(Math.max(qm, 1e-3))) });
        // tera variant: only where tera turns a non-KO into a KO and tera is still available
        const o = moveOpts.find(x => x.i === i);
        if (request.active[0].canTerastallize && o && o.row && o.row.kill_tera && !o.row.kills_opp) {
          finals.push({ choice: `move ${i + 1} terastallize`, score: base + this.TERA + this.W * (Math.log(1 - pSw) + Math.log(Math.max(qm, 1e-3))) });
        }
      } else if ((m = /^switch (\d+)$/.exec(opt.choice))) {
        finals.push({ choice: opt.choice, score: base + this.W * (Math.log(pSw) - Math.log(Math.max(benchCount, 1))) });
      } else {
        finals.push({ choice: opt.choice, score: base });
      }
    }
    finals.sort((a, b) => b.score - a.score);
    const best = finals.length ? finals[0].choice : chosen;
    this.priorStats.used++;
    if (best.includes('terastallize')) this.priorStats.teraChoices++;
    if (this.logRows) this.logRows.push({ turn: this.turn, state: d, own, pSw, q: Object.fromEntries(q), chosen: best });
    return best;
  }
}
module.exports = { PriorAgent };
