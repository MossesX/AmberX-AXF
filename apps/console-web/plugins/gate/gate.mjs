#!/usr/bin/env node
/**
 * Gate & rules: the one implementation behind every transport (framework/spec/GATE.md). The console's REST routes
 * (server/routes.py), the MCP tools (plugin-commands → those routes) and the CLI (`axf gate …`) all end in `run(op, input)`
 * here, so the same input gives the same record everywhere (the CLI-vs-MCP parity test checks it).
 *
 *   node gate.mjs api <op> < input.json          one call, JSON in, JSON out (what the server routes run)
 *   node gate.mjs rules list|get <id>|set <id> <field> <value>|on <id>|off <id>|reset [id] [--confirm t]
 *   node gate.mjs check <pr>
 *   node gate.mjs history [--kind rule|lander] [--since …] [--pr …] [--rule …] [--limit n]
 *   node gate.mjs lander status|waiting|runs|mode [on|off]|land-now <pr> [--confirm t]|pause [--why …]|resume
 *   node gate.mjs settings [get] | settings set <key> <value>
 *   add --json for the record itself; --by and --reason say who and why (History).
 *
 * Ops (`run`): rules_list, rules_get, rules_set, rules_toggle, rules_reset, check_pr, history, lander_status,
 * lander_waiting, lander_runs, lander_mode, lander_land_now, lander_pause, lander_resume, settings_get, settings_set.
 * Answers: { ok: true, … } or { ok: false, code: invalid | not_found | confirmation_required | unavailable | failed, message }.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gate from '../../../../framework/core/gate-rules.mjs';
import { createStore } from './gate-store.mjs';
import { createLander } from './lander.mjs';
import * as history from './history.mjs';

export const OPS = Object.freeze(['rules_list', 'rules_get', 'rules_set', 'rules_toggle', 'rules_reset', 'check_pr', 'history', 'lander_status', 'lander_waiting', 'lander_runs', 'lander_mode', 'lander_land_now', 'lander_pause', 'lander_resume', 'settings_get', 'settings_set']);

/** The plugin's own settings (Settings → Plugins → Gate): key → { type, default, … }. */
export const SETTINGS = Object.freeze({
  refreshSec: { type: 'integer', min: 5, max: 600, default: 30, title: 'Refresh every (seconds)' },
  historySize: { type: 'integer', min: 50, max: history.HISTORY_MAX, default: history.HISTORY_DEFAULT, title: 'History size (entries kept)' },
  defaultTab: { type: 'enum', values: ['rules', 'auto-lander', 'history'], default: 'rules', title: 'Tab it opens on' },
});

const fail = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });
const by = (i) => (typeof i.by === 'string' && i.by.trim() ? i.by.trim().slice(0, 80) : 'console');
const prOf = (v) => { const n = Number(String(v ?? '').replace(/^#/, '')); return Number.isInteger(n) && n > 0 ? n : 0; };
const boolOf = (v) => (typeof v === 'boolean' ? v : v === 'true' || v === 'on' ? true : v === 'false' || v === 'off' ? false : undefined);

/** Settings with defaults filled in. */
export function settingsOf(store) {
  const raw = store.settings(); const out = {};
  for (const [k, d] of Object.entries(SETTINGS)) out[k] = validSetting(k, raw[k]) ? raw[k] : d.default;
  return out;
}
function validSetting(k, v) {
  const d = SETTINGS[k]; if (!d) return false;
  if (d.type === 'integer') return Number.isInteger(v) && v >= d.min && v <= d.max;
  if (d.type === 'enum') return d.values.includes(v);
  return false;
}

/** The ops over one store. */
export function createGate(opts = {}) {
  const store = opts.store || createStore(opts);
  const lander = createLander(store);
  const log = (e) => history.record(store, { kind: 'rule', ...e });
  const findRule = (set, id) => set.rules.find((r) => r.id === id);

  const ops = {
    rules_list(i = {}) {
      const set = store.readRules(); const en = boolOf(i.enabled);
      return { ok: true, ...set, rules: set.rules.filter((r) => (!i.kind || r.kind === i.kind) && (en === undefined || r.enabled === en) && (!i.owner || r.owner === i.owner)) };
    },
    rules_get(i = {}) {
      const r = findRule(store.readRules(), String(i.id || ''));
      if (!r) return fail('not_found', `no rule ${i.id}`);
      const d = gate.defaultRuleSet({ at: store.iso() }).rules.find((x) => x.id === r.id) || null;
      return { ok: true, rule: r, default: d };
    },
    rules_set(i = {}, action = 'set') {
      const id = String(i.id || '');
      if (!new RegExp(gate.ID_PATTERN).test(id)) return fail('invalid', `id must match ${gate.ID_PATTERN}`);
      const set = store.readRules(); const cur = findRule(set, id);
      const patch = {};
      if (i.enabled !== undefined) { const b = boolOf(i.enabled); if (b === undefined) return fail('invalid', 'enabled is true or false'); patch.enabled = b; }
      if (i.severity !== undefined) { if (!gate.SEVERITIES.includes(i.severity)) return fail('invalid', `severity is one of ${gate.SEVERITIES.join(', ')}`); patch.severity = i.severity; }
      if (i.owner !== undefined) { if (!gate.OWNERS.includes(i.owner)) return fail('invalid', `owner is one of ${gate.OWNERS.join(', ')}`); patch.owner = i.owner; }
      if (i.settings !== undefined) { if (!i.settings || typeof i.settings !== 'object' || Array.isArray(i.settings)) return fail('invalid', 'settings is an object'); patch.settings = { ...(cur?.settings || {}), ...i.settings }; }
      for (const k of ['title', 'description']) if (typeof i[k] === 'string') patch[k] = i[k];
      if (!cur && (i.kind !== undefined && i.kind !== 'custom')) return fail('invalid', 'a new rule is kind custom');
      if (!cur && !patch.title) return fail('not_found', `no rule ${id} (a new custom rule needs a title)`);
      if (!Object.keys(patch).length) return fail('invalid', 'nothing to change: send enabled, severity, owner, settings, title or description');
      const before = cur || null;
      const next = { ...(cur || { $axf: gate.RULE_FRAME, id, kind: 'custom', enabled: true, severity: 'block', owner: 'console', settings: {} }), ...patch, updatedAt: store.iso(), updatedBy: by(i) };
      const rules = cur ? set.rules.map((r) => (r.id === id ? next : r)) : [...set.rules, next];
      let saved; try { saved = store.writeRules({ ...set, rules }, { by: by(i) }); } catch (e) { return fail(e.code || 'failed', e.message); }
      const rule = findRule(saved, id);
      log({ action, id, by: by(i), before, after: rule, reason: i.reason || '' });
      return { ok: true, rule, before, rev: saved.rev };
    },
    rules_toggle(i = {}) {
      const b = boolOf(i.enabled);
      if (b === undefined) return fail('invalid', 'enabled is true or false');
      const r = ops.rules_set({ id: i.id, enabled: b, by: i.by, reason: i.reason }, 'toggle');
      return r.ok ? { ok: true, rule: r.rule, rev: r.rev } : r;
    },
    rules_reset(i = {}) {
      const id = i.id ? String(i.id) : '';
      const set = store.readRules(); const defs = gate.defaultRuleSet({ at: store.iso() });
      if (id && !findRule(defs, id)) return fail('not_found', `${id} is not a default rule (nothing to reset it to)`);
      const affects = id ? [id] : defs.rules.map((r) => r.id);
      if (!i.confirm) return { ok: false, code: 'confirmation_required', message: `resets ${affects.join(', ')} to the defaults: call again with confirm`, confirm: store.issueConfirm('gate.rules_reset', id), affects };
      if (!store.takeConfirm('gate.rules_reset', id, i.confirm)) return fail('invalid', 'the confirm token is wrong or expired: ask again');
      const rules = id ? (findRule(set, id) ? set.rules.map((r) => (r.id === id ? findRule(defs, id) : r)) : [...set.rules, findRule(defs, id)]) : defs.rules;
      let saved; try { saved = store.writeRules({ ...set, rules }, { by: by(i) }); } catch (e) { return fail(e.code || 'failed', e.message); }
      log({ action: 'reset', ...(id ? { id } : {}), by: by(i), before: id ? findRule(set, id) || null : set.rules, after: id ? findRule(saved, id) : saved.rules, reason: i.reason || '' });
      return { ok: true, rules: saved, rev: saved.rev };
    },
    check_pr(i = {}) {
      let snap = null;
      if (i.snapshot && typeof i.snapshot === 'object') snap = i.snapshot;
      else if (i.branch) {
        const q = store.queue(); const land = store.land();
        const hit = [...(q.items || []), ...(q.waiting || []), ...(land.items || [])].find((x) => x.branch === i.branch && x.pr);
        if (!hit) return fail('not_found', `the lander knows no PR for ${i.branch}`);
        snap = lander.snapshot(hit.pr);
      } else {
        const n = prOf(i.pr);
        if (!n) return fail('invalid', 'send pr, branch or snapshot');
        snap = lander.snapshot(n) || { number: n };
      }
      const known = !!(snap && (snap.title || snap.head || snap.ci && snap.ci !== 'none'));
      return { ok: true, ...gate.evaluate(store.readRules(), snap, { at: store.iso() }), known };
    },
    history(i = {}) { return { ok: true, ...history.read(store, i) }; },
    lander_status() { return { ok: true, ...lander.status() }; },
    lander_waiting(i = {}) { return { ok: true, ...lander.waiting(i) }; },
    lander_runs(i = {}) { return { ok: true, ...lander.runs(i) }; },
    lander_mode(i = {}) {
      if (i.mergeQueue === undefined) { const m = lander.mode(); return { ok: true, ...m }; }
      const b = boolOf(i.mergeQueue);
      if (b === undefined) return fail('invalid', 'mergeQueue is true or false');
      return { ok: true, ...lander.setMode(b, { by: by(i), reason: i.reason || '' }) };
    },
    lander_land_now(i = {}) { const r = lander.landNow({ pr: i.pr, by: by(i), reason: i.reason || '', confirm: i.confirm || '' }); return r.ok === false ? { ...r, message: `lands #${r.pr} next: call again with confirm` } : r; },
    lander_pause(i = {}) { return { ok: true, ...lander.pause({ why: i.why || '', by: by(i), reason: i.reason || '' }) }; },
    lander_resume(i = {}) { return { ok: true, ...lander.resume({ by: by(i), reason: i.reason || '' }) }; },
    settings_get() { return { ok: true, settings: settingsOf(store), schema: SETTINGS }; },
    settings_set(i = {}) {
      const patch = i.settings && typeof i.settings === 'object' ? i.settings : Object.fromEntries(Object.entries(i).filter(([k]) => k in SETTINGS));
      const cur = settingsOf(store);
      for (const [k, v0] of Object.entries(patch)) {
        if (!(k in SETTINGS)) return fail('invalid', `no setting ${k} (${Object.keys(SETTINGS).join(', ')})`);
        const v = SETTINGS[k].type === 'integer' && typeof v0 === 'string' ? Number(v0) : v0;
        if (!validSetting(k, v)) return fail('invalid', SETTINGS[k].type === 'integer' ? `${k} is a whole number ${SETTINGS[k].min} to ${SETTINGS[k].max}` : `${k} is one of ${SETTINGS[k].values.join(', ')}`);
        cur[k] = v;
      }
      store.writeSettings(cur);
      return { ok: true, settings: settingsOf(store), schema: SETTINGS };
    },
  };

  return {
    store, lander, ops,
    /** One call by op name: never throws (errors come back as { ok: false, code, message }). */
    run(op, input = {}) {
      if (!OPS.includes(op)) return fail('invalid', `no op ${op} (${OPS.join(', ')})`);
      try { return ops[op](input && typeof input === 'object' ? input : {}); } catch (e) { return fail(e.code || 'failed', String(e.message || e).slice(0, 600)); }
    },
  };
}

// ------------------------------------------------------------------ CLI

const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };

export async function main(argv, { out = (s) => console.log(s), err = (s) => console.error(s), gateApi = null } = {}) {
  const g = gateApi || createGate();
  if (argv[0] === 'api') {
    const op = argv[1] || '';
    let input = {}; try { input = JSON.parse(readStdin() || '{}'); } catch { out(JSON.stringify(fail('invalid', 'the input is not JSON'))); return 2; }
    const r = g.run(op, input);
    out(JSON.stringify(r));
    return r.ok || r.code === 'confirmation_required' ? 0 : 1;
  }
  return cli(argv, g, { out, err });
}

/** Filled in by the CLI step: the human commands map onto the same ops. */
export async function cli(argv, g, { out }) {
  out(JSON.stringify(fail('invalid', 'usage: gate.mjs api <op> < input.json')));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e?.message ?? e); process.exitCode = 1; });
}
