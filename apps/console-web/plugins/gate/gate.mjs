#!/usr/bin/env node
/**
 * VPS Configuration: the one implementation behind every transport (framework/spec/GATE.md). The console's REST routes
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
 * lander_waiting, lander_runs, lander_mode, lander_land_now, lander_pause, lander_resume, settings_get, settings_set, and the
 * build rules ops build_rules_* (build-rules-api.mjs).
 * Answers: { ok: true, … } or { ok: false, code: invalid | not_found | confirmation_required | unavailable | failed, message }.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as gate from '../../../../framework/core/gate-rules.mjs';
import { createStore } from './gate-store.mjs';
import { createLander } from './lander.mjs';
import * as history from './history.mjs';
import { readRuns } from './build-rules-runner.mjs';
import { BUILD_RULE_OPS, createBuildRulesOps } from './build-rules-api.mjs';

/**
 * The build rules' part of a verdict: the latest gate-phase run of each rule for the build (build-rules@1). A rule whose
 * last run failed blocks; no run yet = nothing known (the lander runs them when CI is green).
 */
export function buildRulesVerdict(build, { dir } = {}) {
  if (!build) return null;
  const latest = new Map();
  for (const r of readRuns({ build, limit: 2000, ...(dir ? { dir } : {}) })) if (r.phase === 'gate' && !latest.has(r.id)) latest.set(r.id, r);
  if (!latest.size) return { build, ran: false, failing: [], results: [] };
  const results = [...latest.values()].map((r) => ({ id: r.id, result: r.result, at: r.at, detail: String(r.detail || '').split('\n')[0].slice(0, 200) }));
  return { build, ran: true, failing: results.filter((r) => r.result === 'fail').map((r) => r.id), results };
}

export const OPS = Object.freeze(['rules_list', 'rules_get', 'rules_set', 'rules_toggle', 'rules_reset', 'check_pr', 'history', 'lander_status', 'lander_waiting', 'lander_runs', 'lander_mode', 'lander_land_now', 'lander_pause', 'lander_resume', 'settings_get', 'settings_set', ...BUILD_RULE_OPS]);

/** The plugin's own settings (Settings → Plugins → VPS Configuration): key → { type, default, … }. */
export const SETTINGS = Object.freeze({
  refreshSec: { type: 'integer', min: 5, max: 600, default: 30, title: 'Refresh every (seconds)' },
  historySize: { type: 'integer', min: 50, max: history.HISTORY_MAX, default: history.HISTORY_DEFAULT, title: 'History size (entries kept)' },
  defaultTab: { type: 'enum', values: ['rules', 'build-rules', 'auto-lander', 'build-cap', 'approvals', 'passes', 'history'], default: 'rules', title: 'Tab it opens on' },
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
      const v = gate.evaluate(store.readRules(), snap, { at: store.iso() });
      // build rules (phase gate): a failing one blocks like a block rule
      const build = String(i.build || (i.branch || snap?.head || '').replace(/^claude\//, '') || '').slice(0, 120);
      const br = i.build || i.branch ? buildRulesVerdict(build, { dir: i.rulesDir }) : null;
      if (br?.failing.length) {
        const reason = `build-rules: ${br.failing.join(', ')} failed at the gate (Builds → VPS Configuration → Build rules).`;
        return { ok: true, ...v, pass: false, held: false, blockedBy: v.blockedBy || 'build-rules', reasons: [...(v.reasons || []), reason], buildRules: br, known };
      }
      return { ok: true, ...v, ...(br ? { buildRules: br } : {}), known };
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
    ...createBuildRulesOps({ confirms: store }),
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
    /** One call by op name: never throws (errors come back as { ok: false, code, message }). build_rules_run answers a promise. */
    run(op, input = {}) {
      if (!OPS.includes(op)) return fail('invalid', `no op ${op} (${OPS.join(', ')})`);
      try {
        const r = ops[op](input && typeof input === 'object' ? input : {});
        return r && typeof r.then === 'function' ? r.catch((e) => fail(e.code || 'failed', String(e.message || e).slice(0, 600))) : r;
      } catch (e) { return fail(e.code || 'failed', String(e.message || e).slice(0, 600)); }
    },
  };
}

// ------------------------------------------------------------------ CLI

const readStdin = () => { try { return readFileSync(0, 'utf8'); } catch { return ''; } };

export async function main(argv, { out = (s) => console.log(s), err = (s) => console.error(s), gateApi = null } = {}) {
  process.umask(0o002); // shared data folders (the build rules store) are group-written by the console, dispatcher and lander
  // the human CLI on the VPS host reads the live console's data (the same default as the lander's own CLI)
  const host = argv[0] !== 'api' && !process.env.AXF_CONSOLE_ROOT && !process.env.AXF_GATE_DIR && existsSync('/opt/axf/.axf-console') ? { consoleRoot: '/opt/axf' } : {};
  const g = gateApi || createGate(host);
  if (argv[0] === 'api') {
    const op = argv[1] || '';
    let input = {}; try { input = JSON.parse(readStdin() || '{}'); } catch { out(JSON.stringify(fail('invalid', 'the input is not JSON'))); return 2; }
    const r = await g.run(op, input);
    out(JSON.stringify(r));
    return r.ok || r.code === 'confirmation_required' ? 0 : 1;
  }
  if (argv[0] === 'auto-lander') return autoLanderCli(argv.slice(1));
  if (argv[0] === 'build-cap') return (await import('./build-cap.mjs')).main(argv.slice(1));
  if (argv[0] === 'approvals') return (await import('./approval-rules.mjs')).main(argv.slice(1));
  return cli(argv, g, { out, err });
}

/** The first words `axf gate …` hands to this file (framework/cli/axf.mjs, plugin.json "cli"); the rest go to plugin-commands. */
export const cliWords = Object.freeze(['rules', 'build-rules', 'check', 'history', 'lander', 'auto-lander', 'build-cap', 'approvals', 'settings', 'help']);

/**
 * `axf gate auto-lander status|show <build>|run [--now]|retry <build>|fix <build>|pause|resume|settings|set <key> <value>`:
 * the lander's own CLI (deploy/lander/run.mjs, Pipeline 2.0; it replaced deploy/auto-lander on Nov 19 2026), the
 * same commands REST, MCP and voice call. `run` asks the service for a tick (as the console does); `run --now` ticks here.
 */
export async function autoLanderCli(argv) {
  const al = await import('../../../../deploy/lander/run.mjs');
  const [cmd = 'status', ...rest] = argv;
  const known = ['status', 'show', 'run', 'retry', 'fix', 'pause', 'resume', 'settings', 'set'];
  if (!known.includes(cmd)) { console.error(`axf gate auto-lander ${known.join('|')}`); return 2; }
  const args = cmd === 'run' && !rest.includes('--now') ? ['run', '--request', ...rest] : [cmd, ...rest.filter((x) => x !== '--now')];
  try { await al.main(args); return process.exitCode || 0; } catch (e) { console.error(e.message); return e.code === 'invalid' ? 2 : 1; }
}

const USAGE = [
  'axf gate rules list [--kind k] [--enabled true|false] [--owner o]',
  'axf gate rules get <id>',
  'axf gate rules set <id> <enabled|severity|owner|title|description|settings.<key>> <value>',
  'axf gate rules on <id> | off <id>',
  'axf gate rules reset [id] [--confirm <token>]',
  'axf gate check <pr> | check --branch <branch>',
  'axf gate history [--kind rule|lander] [--since <date>] [--pr <n>] [--rule <id>] [--action <a>] [--limit <n>]',
  'axf gate lander status | waiting [--rule r] [--state s] | runs [--limit n] [--result r]',
  'axf gate lander mode [on|off] | land-now <pr> [--confirm <token>] | pause [--why "…"] | resume',
  'axf gate settings [get] | settings set <key> <value>',
  'axf gate build-cap [status] | build-cap set stepsInParallel <n>',
  'axf gate approvals [status] | approvals add <service> <match> <allow|veto|confirm|deny|hold> [seconds] | edit <service> <n> <field> <value> | remove <service> <n> | move <service> <n> <to> | clear-own <service> [on|off] | default | discard [service]',
  'axf gate auto-lander status | show <build> | run [--now] | retry <build> | fix <build> | pause | resume | settings | set <key> <value>',
  'axf gate build-rules list [--doer vps|session] [--kind k] [--phase p] [--enabled true|false] [--q text]',
  'axf gate build-rules get <id> | on <id> | off <id> | delete <id> [--confirm <token>]',
  'axf gate build-rules add <id> --title "…" --text "…" --doer vps|session --kind mechanical|judgement --phase before|dispatch|after|gate [--check …] [--autofix …] [--brief-block …]',
  'axf gate build-rules edit <id> <title|text|doer|kind|phase|check|autofix|briefBlock|applies|note> <value>',
  'axf gate build-rules history [id] [--action a] [--since d] [--limit n] | runs [id] [--build b] [--result r]',
  'axf gate build-rules run <build> --phase before|after|gate [--rules a,b] [--dry-run] | brief <build> [--title "…"]',
  '  --json prints the record; --by and --reason say who and why (History)',
];

function flagsOf(argv) {
  const f = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') f.json = true;
    else if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'; f[k] = v; }
    else f._.push(a);
  }
  return f;
}
const parseValue = (v) => { try { return JSON.parse(v); } catch { return v; } };

/** The human command → { op, input }, or { usage } when it doesn't parse. */
export function parseCli(argv) {
  const f = flagsOf(argv); const [a, b, c, d] = f._;
  const who = { ...(f.by ? { by: f.by } : { by: 'cli' }), ...(f.reason ? { reason: f.reason } : {}) };
  const pick = (...ks) => Object.fromEntries(ks.filter((k) => f[k] !== undefined).map((k) => [k, f[k]]));
  if (a === 'rules') {
    if (!b || b === 'list') return { op: 'rules_list', input: pick('kind', 'enabled', 'owner') };
    if (b === 'get' && c) return { op: 'rules_get', input: { id: c } };
    if ((b === 'on' || b === 'off') && c) return { op: 'rules_toggle', input: { id: c, enabled: b === 'on', ...who } };
    if (b === 'reset') return { op: 'rules_reset', input: { ...(c ? { id: c } : {}), ...pick('confirm'), ...who } };
    if (b === 'set' && c && d && argv.length) {
      const value = f._.slice(4).join(' ');
      if (value === '') return { usage: true };
      if (d.startsWith('settings.')) return { op: 'rules_set', input: { id: c, settings: { [d.slice(9)]: parseValue(value) }, ...who } };
      if (!['enabled', 'severity', 'owner', 'title', 'description'].includes(d)) return { usage: true };
      return { op: 'rules_set', input: { id: c, [d]: d === 'enabled' ? boolOf(value) ?? value : value, ...who } };
    }
    return { usage: true };
  }
  if (a === 'check') return b ? { op: 'check_pr', input: { pr: b } } : f.branch ? { op: 'check_pr', input: { branch: f.branch } } : { usage: true };
  if (a === 'build-rules') {
    if (!b || b === 'list') return { op: 'build_rules_list', input: pick('doer', 'kind', 'phase', 'enabled', 'q') };
    if (b === 'get' && c) return { op: 'build_rules_get', input: { id: c } };
    if ((b === 'on' || b === 'off') && c) return { op: 'build_rules_toggle', input: { id: c, enabled: b === 'on', ...who } };
    if (b === 'toggle' && c) return { op: 'build_rules_toggle', input: { id: c, ...who } };
    if (b === 'delete' && c) return { op: 'build_rules_delete', input: { id: c, ...pick('confirm'), ...who } };
    if (b === 'add' && c) {
      const rule = { id: c, ...pick('title', 'text', 'doer', 'kind', 'phase', 'check', 'autofix', 'applies', 'note'), ...(f['brief-block'] ? { briefBlock: f['brief-block'] } : {}), ...(f.enabled !== undefined ? { enabled: boolOf(f.enabled) ?? true } : {}) };
      return { op: 'build_rules_add', input: { rule, ...who } };
    }
    if (b === 'edit' && c && d) {
      const value = f._.slice(4).join(' ');
      if (value === '' || !['title', 'text', 'doer', 'kind', 'phase', 'check', 'autofix', 'briefBlock', 'applies', 'note', 'when'].includes(d)) return { usage: true };
      return { op: 'build_rules_edit', input: { id: c, patch: { [d]: d === 'when' ? parseValue(value) : value }, ...who } };
    }
    if (b === 'history') return { op: 'build_rules_history', input: { ...(c ? { id: c } : {}), ...pick('action', 'since', 'limit') } };
    if (b === 'runs') return { op: 'build_rules_runs', input: { ...(c ? { id: c } : {}), ...pick('build', 'result', 'since', 'limit') } };
    if (b === 'run' && c && f.phase) return { op: 'build_rules_run', input: { build: c, phase: f.phase, ...(f.rules ? { rules: f.rules } : {}), dryRun: f['dry-run'] === 'true', ...who } };
    if (b === 'brief') return { op: 'build_rules_brief', input: { build: c || '', ...pick('title', 'text', 'ui') } };
    return { usage: true };
  }
  if (a === 'history') return { op: 'history', input: pick('kind', 'since', 'pr', 'rule', 'action', 'limit') };
  if (a === 'lander') {
    if (!b || b === 'status') return { op: 'lander_status', input: {} };
    if (b === 'waiting') return { op: 'lander_waiting', input: pick('rule', 'state') };
    if (b === 'runs') return { op: 'lander_runs', input: pick('limit', 'result') };
    if (b === 'mode') return c ? { op: 'lander_mode', input: { mergeQueue: c === 'on' ? true : c === 'off' ? false : c, ...who } } : { op: 'lander_mode', input: {} };
    if (b === 'land-now' && c) return { op: 'lander_land_now', input: { pr: c, ...pick('confirm'), ...who } };
    if (b === 'pause') return { op: 'lander_pause', input: { ...pick('why'), ...who } };
    if (b === 'resume') return { op: 'lander_resume', input: { ...who } };
    return { usage: true };
  }
  if (a === 'settings') {
    if (!b || b === 'get') return { op: 'settings_get', input: {} };
    if (b === 'set' && c && d !== undefined) return { op: 'settings_set', input: { settings: { [c]: parseValue(d) } } };
    return { usage: true };
  }
  return { usage: true };
}

const onOff = (b) => (b ? 'on' : 'off');
/** Plain lines for a person (the record itself with --json). */
export function textOf(op, r) {
  if (!r.ok && r.code === 'confirmation_required') return `${r.message || 'confirm first'}\n  again with --confirm ${r.confirm}`;
  if (!r.ok) return `${r.code}: ${r.message}`;
  switch (op) {
    case 'rules_list': return r.rules.map((x) => `${onOff(x.enabled).padEnd(4)} ${x.severity.padEnd(6)} ${x.id.padEnd(18)} ${x.title}`).join('\n') || 'no rules';
    case 'rules_get': return `${r.rule.id} (${r.rule.kind}) ${onOff(r.rule.enabled)}, ${r.rule.severity}, run by ${r.rule.owner}\n${r.rule.title}: ${r.rule.description}\nsettings ${JSON.stringify(r.rule.settings)}`;
    case 'rules_set': case 'rules_toggle': return `${r.rule.id}: ${onOff(r.rule.enabled)}, ${r.rule.severity} (rev ${r.rev})`;
    case 'rules_reset': return `reset to the defaults (rev ${r.rev})`;
    case 'check_pr': return r.pass ? `#${r.pr} can land: every rule passes.` : `#${r.pr} ${r.held ? 'waits' : 'needs a fix'}: ${r.reasons.join(' · ')}`;
    case 'history': return r.items.map((e) => `${e.at} ${e.by.padEnd(14)} ${e.kind}/${e.action}${e.id ? ` ${e.id}` : ''}${e.pr ? ` #${e.pr}` : ''}`).join('\n') || 'no history yet';
    case 'lander_status': case 'lander_mode_set': case 'lander_pause': case 'lander_resume':
      return `auto-lander ${r.status} · merge queue ${onOff(r.mergeQueue)} (${r.mode})${r.paused ? ` · paused: ${r.pause?.why || 'no reason given'}` : ''}${r.landing ? ` · landing #${r.landing.pr}` : ''} · ${r.counts.waiting} waiting`;
    case 'lander_mode': return r.status ? `merge queue ${onOff(r.mergeQueue)} (${r.mode}) · auto-lander ${r.status}` : `merge queue ${onOff(r.mergeQueue)}${r.since ? ` since ${r.since}${r.by ? ` (${r.by})` : ''}` : ''}`;
    case 'lander_waiting': return r.items.map((w) => `${String(w.position).padStart(3)} #${w.pr} ${w.state.padEnd(8)} ${w.rule ? `[${w.rule}] ` : ''}${w.reason}`).join('\n') || 'nothing waits';
    case 'lander_runs': return r.items.map((x) => `${x.startedAt} ${x.result.padEnd(8)} ${x.landing?.pr ? `#${x.landing.pr} ` : ''}${x.reasonText}`).join('\n') || 'no runs yet';
    case 'lander_land_now': return `#${r.pr} lands next (${r.via})`;
    case 'build_rules_list': return `${r.counts.total} build rules (${r.counts.vps} VPS, ${r.counts.session} session, ${r.counts.on} on; ${r.source})\n${r.rules.map((x) => `${onOff(x.enabled).padEnd(4)} ${x.doer.padEnd(7)} ${x.phase.padEnd(8)} ${x.id.padEnd(28)} ${x.last ? `[${x.last.result}] ` : ''}${x.title}`).join('\n')}`;
    case 'build_rules_get': return `${r.rule.id} ${onOff(r.rule.enabled)}: ${r.rule.doer}, ${r.rule.kind}, ${r.rule.phase}${r.rule.check ? `, check ${r.rule.check}` : ''}${r.rule.autofix ? `, fixer ${r.rule.autofix}` : ''}\n${r.rule.title}\n${r.rule.text}${r.runs.length ? `\nlast run: ${r.runs[0].result} ${r.runs[0].at}` : ''}`;
    case 'build_rules_add': case 'build_rules_edit': case 'build_rules_toggle': return `${r.rule.id}: ${onOff(r.rule.enabled)}, ${r.rule.doer}, ${r.rule.phase}${r.rev ? ` (rev ${r.rev})` : ''}`;
    case 'build_rules_delete': return `deleted ${r.removed} (rev ${r.rev}); History keeps it`;
    case 'build_rules_history': return r.entries.map((e) => `${e.at} ${String(e.by).padEnd(14)} ${e.action}${e.id ? ` ${e.id}` : ''} ${e.reason?.title || ''}`).join('\n') || 'no history yet';
    case 'build_rules_runs': return r.runs.map((x) => `${x.at} ${x.result.padEnd(7)} ${x.id} ${x.build} ${x.phase}`).join('\n') || 'no runs yet';
    case 'build_rules_run': return `${r.pass ? 'ok' : 'FAIL'} ${r.phase} ${r.build}${r.dryRun ? ' (dry run)' : ''}: ${Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ')}\n${r.runs.map((x) => `  ${x.result.padEnd(7)} ${x.id}: ${String(x.detail).split('\n')[0].slice(0, 140)}`).join('\n')}`;
    case 'build_rules_brief': return r.text || 'no session rules for this build';
    case 'settings_get': case 'settings_set': return Object.entries(r.settings).map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n');
    default: return JSON.stringify(r);
  }
}

/** The human commands: the same ops as the API, printed for a person (or as the record with --json). Exit 3 = confirm first. */
export async function cli(argv, g, { out }) {
  if (!argv.length || argv[0] === 'help' || argv.includes('--help')) { out(USAGE.join('\n')); return argv.length ? 0 : 2; }
  const p = parseCli(argv);
  if (p.usage) { out(USAGE.join('\n')); return 2; }
  const r = await g.run(p.op, p.input);
  out(argv.includes('--json') ? JSON.stringify(r, null, 2) : textOf(p.op === 'lander_mode' && p.input.mergeQueue !== undefined ? 'lander_mode' : p.op, r));
  return r.ok ? 0 : r.code === 'confirmation_required' ? 3 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(e?.message ?? e); process.exitCode = 1; });
}
