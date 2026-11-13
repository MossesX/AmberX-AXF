#!/usr/bin/env node
/**
 * Prompt engine runner + CLI (prompt-engine@1; the decisions live in framework/core/engines/prompt-engine.mjs, this
 * file stores and runs). Data in the plugin's data folder (AXF_PROMPT_ENGINE_DIR, default
 * .axf-console/plugins/prompt-engine): rules.json, macros.json, pipelines.json, manifests.json, instances.json,
 * state.json, audit.jsonl. The console server's routes call these commands (plugin-commands@1 then puts them on REST,
 * MCP, the CLI and voice); the build-hook listener (build-hooks.mjs) fires build events; the server's tick runs
 * schedules and expiries.
 *
 *   node engine.mjs state                                   rules, macros, pipelines, waiting prompts, counts
 *   node engine.mjs rules | rule <id> | add-rule <json|-> | update-rule <id> <json|-> | enable <id> | disable <id>
 *                   remove-rule <id> --confirm <id>
 *   node engine.mjs macros | add-macro <json|-> | update-macro <id> <json|-> | remove-macro <id> --confirm <id>
 *   node engine.mjs pipelines | add-pipeline <json|-> | update-pipeline <id> <json|-> | remove-pipeline <id> --confirm <id>
 *   node engine.mjs manifest [source]                       the registry (built-in + every plugin.json `promptManifest` + registered)
 *   node engine.mjs register-manifest <json|->              a source registers its events / actions / connectors
 *   node engine.mjs options <json|->                        context-aware builder choices for what is picked so far
 *   node engine.mjs templates | use-template <id> [--id x] [--title t]
 *   node engine.mjs fire <json|-> [--dry] [--by who]        an event: every rule is evaluated; prompts are asked, actions run
 *   node engine.mjs test <rule> [--event <json>] [--live]   test-fire one rule (dry by default: plans, runs nothing)
 *   node engine.mjs waiting | answer <instance> <answer> [--option o] [--text t] [--by who] | expire
 *   node engine.mjs tick                                    expire prompts past their deadline + fire due schedules
 *   node engine.mjs history [--rule r] [--instance i] [--kind k] [--limit n]
 *   node engine.mjs run <json|->                            run a list of actions now ({ actions, ctx }) — macros / pipelines included
 *   --json on any command prints JSON (the console server uses this). Exit 0 ok · 1 failed · 2 usage · 3 confirm needed.
 *
 * Running: tool.run → the Plugin commands runner (control@1: `node …/plugin-commands/commands.mjs <plugin> <command>`,
 * AXF_CONSOLE_URL + AXF_TOKEN), console.command → framework/cli/console-control.mjs, build.* → the orchestrator CLI,
 * event.fire → fire again (chain depth capped), macro / pipeline → expanded by the engine, prompt.ask → a new waiting
 * prompt (a pipeline gate resumes on the answer). notify.* and keys-needed items come back as `dispatch` entries the
 * console server delivers through the alert hub (push) or a capability (decision dialog, connectors), so this CLI
 * never needs the console to decide; standalone it prints them.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../../../../framework/core/engines/prompt-engine.mjs';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(process.env.AXF_ROOT || join(HERE, '../../../..'));
export const FOLDER = 'prompt-engine';
export const dataDir = () => resolve(process.env.AXF_PROMPT_ENGINE_DIR || join(process.env.AXF_PLUGIN_DATA_ROOT || ROOT, '.axf-console', 'plugins', FOLDER));
const PLUGINS = join(ROOT, 'apps/console-web/plugins');
const PLUGIN_COMMANDS = join(PLUGINS, 'plugin-commands/commands.mjs');
const CONSOLE_CONTROL = join(ROOT, 'framework/cli/console-control.mjs');
const ORCHESTRATOR = join(PLUGINS, 'build-orchestrator/orchestrator.mjs');
const BUILDS_STORE = join(ROOT, 'framework/cli/builds-store.mjs');
export const MAX_CHAIN = 6;
export const AUDIT_KEEP = 5000;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/* ------------------------------------------------------------------ store */

const file = (name) => join(dataDir(), name);
function readJson(name, fallback) {
  try { return JSON.parse(readFileSync(file(name), 'utf8')); } catch { return fallback; }
}
function writeJson(name, value) {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
  const f = file(name); const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, f);
}
export const loadRules = () => (readJson('rules.json', []) || []).map((r) => E.normRule(r)).filter(Boolean);
export const loadMacros = () => (readJson('macros.json', []) || []).map((m) => E.normMacro(m)).filter(Boolean);
export const loadPipelines = () => (readJson('pipelines.json', []) || []).map((p) => E.normPipeline(p)).filter(Boolean);
export const loadInstances = () => (readJson('instances.json', []) || []).map((i) => E.normInstance(i)).filter(Boolean);
export const loadState = () => E.normState(readJson('state.json', {}));
const saveRules = (xs) => writeJson('rules.json', xs);
const saveMacros = (xs) => writeJson('macros.json', xs);
const savePipelines = (xs) => writeJson('pipelines.json', xs);
const saveInstances = (xs) => writeJson('instances.json', xs.slice(-500));
const saveState = (s) => writeJson('state.json', s);

export function audit(kind, detail = {}, by = '', now = new Date().toISOString()) {
  const line = E.auditEntry(kind, detail, now, by);
  try {
    mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    appendFileSync(file('audit.jsonl'), `${JSON.stringify(line)}\n`);
  } catch { /* history never blocks a decision */ }
  return line;
}
export function readAudit() {
  if (!existsSync(file('audit.jsonl'))) return [];
  const lines = readFileSync(file('audit.jsonl'), 'utf8').trim().split('\n').filter(Boolean);
  const out = lines.slice(-AUDIT_KEEP).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (lines.length > AUDIT_KEEP * 2) { try { writeFileSync(file('audit.jsonl'), `${out.map((l) => JSON.stringify(l)).join('\n')}\n`); } catch { /* keep going */ } }
  return out;
}

/* ------------------------------------------------------------------ manifests + registry */

/** Every plugin.json `promptManifest` (an object, or a file relative to the plugin folder) + what sources registered at run time. */
export function pluginManifests() {
  const out = [];
  let folders = [];
  try { folders = readdirSync(PLUGINS); } catch { return out; }
  for (const folder of folders) {
    if (folder.startsWith('_') || folder.startsWith('.')) continue;
    let pj;
    try { pj = JSON.parse(readFileSync(join(PLUGINS, folder, 'plugin.json'), 'utf8')); } catch { continue; }
    const pm = pj?.promptManifest;
    if (!pm) continue;
    let m = pm;
    if (typeof pm === 'string') { try { m = JSON.parse(readFileSync(join(PLUGINS, folder, pm), 'utf8')); } catch { continue; } }
    if (isObj(m)) out.push({ ...m, source: m.source || folder });
  }
  return out;
}
export const registeredManifests = () => (readJson('manifests.json', []) || []).filter(isObj);
export function registry() {
  return E.buildRegistry([...pluginManifests(), ...registeredManifests()]);
}
export function registerManifest(m, by = '') {
  const v = E.validateManifest(m);
  if (!v.ok) return { ok: false, error: E.rejectionText(v.errors), errors: v.errors };
  const n = E.normManifest(m);
  const all = registeredManifests().filter((x) => E.slug(x.source) !== n.source);
  all.push(n);
  writeJson('manifests.json', all);
  audit('rule', { reason: 'manifest', source: n.source, events: n.events.length, actions: n.actions.length }, by);
  return { ok: true, manifest: n, registry: summaryOfRegistry(registry()) };
}
const summaryOfRegistry = (reg) => ({ sources: reg.sources.length, events: Object.keys(reg.events).length, actions: Object.keys(reg.actions).length, connectors: Object.values(reg.connectors).filter((c) => c.available).map((c) => c.id) });

/* ------------------------------------------------------------------ live lists for the builder */

function pluginCommandList() {
  try {
    const r = spawnSync(process.execPath, [join(ROOT, 'framework/cli/plugin-commands.mjs'), 'registry', '--json'], { encoding: 'utf8', cwd: ROOT, timeout: 20000 });
    const reg = JSON.parse(r.stdout.trim().split('\n').pop());
    return (reg.plugins || []).filter((p) => p.enabled !== false).map((p) => ({ id: p.folder, title: p.name || p.folder, commands: (p.commands || []).map((c) => ({ id: c.id, title: c.title, kind: c.kind, effect: c.effect })) }));
  } catch { return []; }
}
function buildList() {
  try {
    const r = spawnSync(process.execPath, [ORCHESTRATOR, '--json'], { encoding: 'utf8', cwd: ROOT, timeout: 20000, env: { ...process.env, AXF_BUILD_HOOKS: process.env.AXF_BUILD_HOOKS || 'off' } });
    const j = JSON.parse(r.stdout.trim().split('\n').pop());
    const builds = Array.isArray(j) ? j : j.builds || j.items || [];
    return builds.filter((b) => b && !b.hidden).slice(0, 200).map((b) => ({ id: b.id, title: `${b.title || b.id} (${b.status || ''})` }));
  } catch { return []; }
}
export function liveLists(opts = {}) {
  return {
    builds: opts.builds === false ? [] : buildList(),
    plugins: opts.plugins === false ? [] : pluginCommandList(),
    macros: loadMacros().map((m) => ({ id: m.id, title: m.title })),
    pipelines: loadPipelines().map((p) => ({ id: p.id, title: p.title })),
    rules: loadRules().map((r) => ({ id: r.id, title: r.title })),
    addresses: [],
  };
}
export function options(picked, opts = {}) {
  const reg = registry();
  const needLive = picked?.action || picked?.field || opts.live;
  return { ok: true, ...E.optionsFor(reg, picked, needLive ? liveLists(opts) : { macros: loadMacros(), pipelines: loadPipelines(), rules: loadRules() }) };
}

/* ------------------------------------------------------------------ rules, macros, pipelines (CRUD) */

const now = () => new Date().toISOString();
function crud(kind) {
  const [load, save, norm, validate, rec] = kind === 'rule' ? [loadRules, saveRules, E.normRule, E.validateRule, 'rule'] : kind === 'macro' ? [loadMacros, saveMacros, E.normMacro, E.validateMacro, 'macro'] : [loadPipelines, savePipelines, E.normPipeline, E.validatePipeline, 'pipeline'];
  return {
    list: () => load(),
    get: (id) => load().find((x) => x.id === E.slug(id)) ?? null,
    add(raw, by = '') {
      const reg = registry();
      const v = validate(raw, reg);
      if (!v.ok) return { ok: false, error: E.rejectionText(v.errors), errors: v.errors };
      const item = norm({ ...raw, by }, { now: now() });
      const all = load();
      if (all.some((x) => x.id === item.id)) return { ok: false, error: `${rec} ${item.id} already exists (update it instead)`, code: 'validation' };
      all.push(item); save(all);
      audit(rec, { [rec]: item.id, reason: 'added', title: item.title }, by);
      return { ok: true, [rec]: item, summary: kind === 'rule' ? E.summarize(item, reg) : item.title };
    },
    update(id, patch, by = '') {
      const all = load(); const i = all.findIndex((x) => x.id === E.slug(id));
      if (i < 0) return { ok: false, error: `no ${rec} ${id}`, code: 'not_found' };
      const reg = registry();
      const merged = { ...all[i], ...(isObj(patch) ? patch : {}), id: all[i].id, createdAt: all[i].createdAt, by: by || all[i].by };
      const v = validate(merged, reg);
      if (!v.ok) return { ok: false, error: E.rejectionText(v.errors), errors: v.errors };
      all[i] = norm(merged, { now: now() }); save(all);
      audit(rec, { [rec]: all[i].id, reason: 'updated', fields: Object.keys(isObj(patch) ? patch : {}) }, by);
      return { ok: true, [rec]: all[i], summary: kind === 'rule' ? E.summarize(all[i], reg) : all[i].title };
    },
    remove(id, confirm, by = '') {
      const all = load(); const item = all.find((x) => x.id === E.slug(id));
      if (!item) return { ok: false, error: `no ${rec} ${id}`, code: 'not_found' };
      if (confirm !== item.id) return { ok: false, error: `removing ${rec} ${item.id} needs confirm: "${item.id}"`, code: 'confirmation_required', confirm: item.id };
      save(all.filter((x) => x.id !== item.id));
      audit(rec, { [rec]: item.id, reason: 'removed', title: item.title }, by);
      return { ok: true, removed: item.id };
    },
  };
}
export const rules = crud('rule');
export const macros = crud('macro');
export const pipelines = crud('pipeline');
export function setEnabled(id, on, by = '') {
  const all = loadRules(); const r = all.find((x) => x.id === E.slug(id));
  if (!r) return { ok: false, error: `no rule ${id}`, code: 'not_found' };
  r.enabled = Boolean(on); r.updatedAt = now(); saveRules(all);
  audit('rule', { rule: r.id, reason: on ? 'enabled' : 'disabled' }, by);
  return { ok: true, rule: r };
}
export function useTemplate(id, overrides = {}, by = '') {
  const r = E.fromTemplate(id, overrides, { now: now() });
  if (!r) return { ok: false, error: `no template ${id}; templates: ${E.TEMPLATES.map((t) => t.id).join(', ')}`, code: 'not_found' };
  return rules.add({ ...r, by }, by);
}

/* ------------------------------------------------------------------ running */

function node(args, opts = {}) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', cwd: ROOT, timeout: opts.timeout || 60000, env: { ...process.env, ...(opts.env || {}) }, input: opts.input });
  const out = (r.stdout || '').trim().split('\n').filter(Boolean);
  let json = null;
  for (let i = out.length - 1; i >= 0 && !json; i--) { try { json = JSON.parse(out[i]); } catch { /* not that line */ } }
  return { status: r.status, json, stdout: r.stdout || '', stderr: (r.stderr || '').trim().slice(-800) };
}
const inputArgs = (input) => Object.entries(isObj(input) ? input : {}).flatMap(([k, v]) => [`--${k}`, typeof v === 'object' ? JSON.stringify(v) : String(v)]);

/** The default executors, by action id; `tool.run` and the rest are what a step turns into. Tests swap them (`exec` option). */
export const EXEC = {
  'tool.run'(step, ctx) {
    const { plugin, command, input } = step.input;
    const r = node([PLUGIN_COMMANDS, E.slug(plugin), E.slug(command), ...inputArgs(input), '--json', ...(ctx.by ? ['--by', ctx.by] : [])], { timeout: 120000 });
    if (r.json && (r.json.ok || r.json.status === 'ok')) return { ok: true, result: r.json.result ?? r.json.data ?? r.json };
    return { ok: false, error: r.json?.error || r.json?.message || r.stderr || `exit ${r.status}`, code: r.json?.code };
  },
  'console.command'(step) {
    const { verb, address, value } = step.input;
    const args = [CONSOLE_CONTROL, 'do', String(verb), ...(address ? [String(address)] : []), ...(value !== undefined && value !== '' ? ['--value', String(value)] : []), '--json'];
    const r = node(args);
    return r.json?.ok ? { ok: true, result: r.json } : { ok: false, error: r.json?.error || r.stderr || `exit ${r.status}` };
  },
  'build.create'(step, ctx) {
    const { title, detail, priority, queue } = step.input;
    const change = { action: 'add', title: String(title), detail: String(detail ?? ''), ...(priority ? { priority } : {}), said: `Prompt engine rule ${ctx.rule || ''}: ${title}`.trim(), origin: { source: 'prompt-engine', by: ctx.by || 'prompt-engine' } };
    const r = node([ORCHESTRATOR, 'act', '--json', JSON.stringify(change)]);
    if (!r.json?.ok && r.status !== 0) return { ok: false, error: r.json?.error || r.stderr || `exit ${r.status}` };
    const id = r.json?.id || r.json?.build?.id || '';
    if (queue && id) node([ORCHESTRATOR, 'act', 'status', id, 'queued', '--json']);
    return { ok: true, result: { build: id, queued: Boolean(queue && id) } };
  },
  'build.note'(step) { return orch(['act', 'note', String(step.input.build), String(step.input.text)]); },
  'build.status'(step) { return orch(['act', 'status', String(step.input.build), String(step.input.status)]); },
  'build.archive'(step) { return orch(['act', 'archive', String(step.input.build)]); },
  'build.delete'(step) { return orch(['act', 'remove', String(step.input.build)]); },
  'build.approve-upgrade'(step, ctx) {
    if (!ctx.brett) return { ok: false, error: 'only Brett approves a model upgrade: answer this prompt from his signed-in console', code: 'denied' };
    return orch(['act', 'approve', String(step.input.build), String(step.input.phase)], { AXF_APPROVER: ctx.brett, AXF_APPROVER_VIA: 'console' });
  },
  'ui-review.decide'(step, ctx) {
    return EXEC['tool.run']({ input: { plugin: 'ui-review', command: 'decide', input: { ids: step.input.item, decision: step.input.decision, ...(step.input.comment ? { comment: step.input.comment } : {}), ...(step.input.option ? { option: step.input.option } : {}) } } }, ctx);
  },
  'rule.enable'(step, ctx) { return setEnabled(step.input.rule, true, ctx.by); },
  'rule.disable'(step, ctx) { return setEnabled(step.input.rule, false, ctx.by); },
  'log.note'(step) { return { ok: true, result: { note: String(step.input.text) } }; },
  'event.fire'(step, ctx) {
    if ((ctx.chain || 0) >= MAX_CHAIN) return { ok: false, error: `event chain deeper than ${MAX_CHAIN}: stopped`, code: 'validation' };
    const r = fire({ source: step.input.source, event: step.input.event, payload: isObj(step.input.payload) ? step.input.payload : {}, by: ctx.by || 'rule' }, { by: ctx.by, chain: (ctx.chain || 0) + 1, dry: ctx.dry, exec: ctx.exec });
    return { ok: true, result: { fired: r.fired.map((f) => f.rule), asked: r.instances.map((i) => i.id) }, dispatch: r.dispatch };
  },
  // Delivered by the console server (alert hub, connectors, decision dialog): the runner hands them back as `dispatch`.
  'notify.push'(step) { return { ok: true, dispatch: { kind: 'notify', channel: 'push', ...step.input } }; },
  'notify.email'(step) { return { ok: true, dispatch: { kind: 'notify', channel: 'email', ...step.input } }; },
  'notify.sms'(step) { return { ok: true, dispatch: { kind: 'notify', channel: 'sms', ...step.input } }; },
  'notify.call'(step) { return { ok: true, dispatch: { kind: 'notify', channel: 'call', ...step.input } }; },
  'voice.say'(step) { return { ok: true, dispatch: { kind: 'say', text: String(step.input.text) } }; },
  'webhook.send'(step) { return { ok: true, dispatch: { kind: 'webhook', url: String(step.input.url), body: step.input.body ?? {} } }; },
};
function orch(args, env = {}) {
  const r = node([ORCHESTRATOR, ...args, '--json'], { env });
  if (r.status === 0 || r.json?.ok) return { ok: true, result: r.json ?? { stdout: r.stdout.trim().slice(-400) } };
  return { ok: false, error: r.json?.error || r.stderr || r.stdout.trim().slice(-400) || `exit ${r.status}` };
}

/**
 * Run a list of actions: plan (macros, pipelines, connectors), then each runnable step in order. A gate (prompt.ask or
 * a pipeline stage gate) becomes a waiting prompt; what follows it waits for the answer. `dry` plans and runs nothing.
 */
export function run(actions, ctx = {}, opts = {}) {
  const reg = opts.registry || registry();
  const exec = { ...EXEC, ...(opts.exec || {}) };
  const planned = E.plan(actions, { registry: reg, macros: loadMacros(), pipelines: loadPipelines(), ctx: ctx.ctx || {}, trail: opts.trail });
  const at = now();
  const result = { ok: planned.ok, planned: planned.steps.length, errors: planned.errors, keysNeeded: planned.keysNeeded, ran: [], failed: [], dispatch: [], asked: [], dry: Boolean(opts.dry) };
  for (const k of planned.keysNeeded) {
    result.dispatch.push({ kind: 'keys-needed', connector: k, for: ctx.rule || 'prompt engine', message: `The ${k} connector is not set up on axHub; ${ctx.rule ? `rule ${ctx.rule}` : 'this run'} needs it.` });
    audit('keys-needed', { rule: ctx.rule, instance: ctx.instance, connector: k }, ctx.by, at);
  }
  if (opts.dry) { audit('dry-run', { rule: ctx.rule, instance: ctx.instance, steps: planned.steps.map((s) => `${s.action}${s.blocked ? ' (blocked)' : ''}`), errors: planned.errors }, ctx.by, at); result.steps = planned.steps; return result; }
  audit('planned', { rule: ctx.rule, instance: ctx.instance, steps: planned.steps.length, errors: planned.errors.length }, ctx.by, at);
  for (const step of planned.steps) {
    if (step.marker === 'macro-start' || step.marker === 'stage') continue;
    if (step.blocked) { result.failed.push({ action: step.action, error: step.blocked, at: step.at }); continue; }
    if (step.action === 'prompt.ask' || step.marker === 'gate') {
      const ask = E.normRule({ id: ctx.rule || 'ask', trigger: { event: 'engine.prompt' }, ask: step.input }).ask;
      const inst = E.instanceFor({ id: ctx.rule || 'ask', title: step.title, trigger: { event: 'engine.prompt' }, ask }, { source: 'engine', event: 'prompt.gate', payload: ctx.ctx || {}, by: ctx.by }, at, { registry: reg, resume: step.input.resume });
      inst.title = step.title || inst.title;
      const all = loadInstances(); all.push(inst); saveInstances(all);
      audit('asked', { rule: ctx.rule, instance: inst.id, event: 'gate', kind: inst.kind, title: inst.title }, ctx.by, at);
      result.asked.push(inst); result.dispatch.push({ kind: 'ask', instance: inst });
      break;
    }
    const fn = exec[step.action];
    if (!fn) { result.failed.push({ action: step.action, error: 'no executor for this action', at: step.at }); if (!step.continueOnError) break; continue; }
    let r;
    try { r = fn(step, { ...ctx, exec: opts.exec, dry: opts.dry }) || { ok: false, error: 'no answer' }; } catch (e) { r = { ok: false, error: String(e?.message || e) }; }
    if (r.dispatch) result.dispatch.push(...(Array.isArray(r.dispatch) ? r.dispatch : [r.dispatch]));
    if (r.ok) { result.ran.push({ action: step.action, at: step.at, ...(r.result !== undefined ? { result: trim(r.result) } : {}) }); audit('ran', { rule: ctx.rule, instance: ctx.instance, action: step.action, input: trim(step.input) }, ctx.by); }
    else { result.failed.push({ action: step.action, at: step.at, error: String(r.error || 'failed'), ...(r.code ? { code: r.code } : {}) }); audit('failed', { rule: ctx.rule, instance: ctx.instance, action: step.action, reason: String(r.error || 'failed') }, ctx.by); if (!step.continueOnError) break; }
  }
  result.ok = result.errors.length === 0 && result.failed.length === 0;
  return result;
}
const trim = (v) => { const s = JSON.stringify(v); return s && s.length > 2000 ? { truncated: true, head: s.slice(0, 2000) } : v; };

/** An event in: every rule evaluated; prompts stored (and handed back to show), run-now rules run. */
export function fire(event, opts = {}) {
  const e = E.normEvent(event, { now: now() });
  if (!e) return { ok: false, error: 'an event has { source, event, payload }', code: 'validation' };
  const reg = registry();
  const all = loadRules();
  const at = now();
  const { results, fired, state } = E.evaluateAll(all, e, loadState(), at, { force: Boolean(opts.force), registry: reg });
  if (!opts.dry) saveState(E.pruneState(state, at));
  const out = { ok: true, event: { source: e.source, event: e.event, id: e.id }, evaluated: results.length, fired: [], skipped: results.filter((r) => !r.fire).map((r) => ({ rule: r.rule, reason: r.reason })), instances: [], runs: [], dispatch: [], dry: Boolean(opts.dry) };
  for (const r of results) if (!r.fire && r.reason !== 'no-match' && r.reason !== 'disabled') audit('skipped', { rule: r.rule, event: e.id, reason: r.reason }, opts.by, at);
  for (const f of fired) {
    audit('fired', { rule: f.rule, event: e.id, kind: f.instance ? f.instance.kind : 'none' }, opts.by, at);
    out.fired.push({ rule: f.rule, asks: Boolean(f.instance) });
    if (f.instance) {
      const inst = { ...f.instance, keysNeeded: f.instance.outputs.filter((o) => E.CONNECTOR_OUTPUTS.includes(o) && !reg.connectors?.[{ email: 'email', sms: 'sms', call: 'voice-call' }[o]]?.available) };
      if (!opts.dry) { const xs = loadInstances().filter((i) => i.id !== inst.id); xs.push(inst); saveInstances(xs); audit('asked', { rule: f.rule, instance: inst.id, event: e.id, kind: inst.kind, title: inst.title }, opts.by, at); }
      out.instances.push(inst); out.dispatch.push({ kind: 'ask', instance: inst });
      for (const k of inst.keysNeeded) out.dispatch.push({ kind: 'keys-needed', connector: k, for: `rule ${f.rule}`, message: `Rule ${f.rule} wants to reach Brett by ${k}, which is not set up on axHub.` });
    } else {
      const res = run(f.actions, { rule: f.rule, by: opts.by, chain: opts.chain || 0, ctx: f.ctx, brett: opts.brett }, { registry: reg, dry: opts.dry, exec: opts.exec, trail: [`rule:${f.rule}`] });
      out.runs.push({ rule: f.rule, ...res }); out.dispatch.push(...res.dispatch);
    }
  }
  return out;
}

/** Brett's answer: the instance moves on and the branch's actions run (a gate resumes its pipeline). */
export function answer(instanceId, rawAnswer, opts = {}) {
  const all = loadInstances();
  const inst = all.find((i) => i.id === String(instanceId || '').trim()) || (/^\d+$/.test(String(instanceId)) ? all.filter((i) => i.status === 'waiting')[Number(instanceId) - 1] : null);
  if (!inst) return { ok: false, error: `no waiting prompt ${instanceId}; \`waiting\` lists them`, code: 'not_found' };
  const rule = loadRules().find((r) => r.id === inst.rule) ?? null;
  const res = E.answerInstance(inst, rule, rawAnswer, now());
  if (!res.ok) return res;
  const idx = all.findIndex((i) => i.id === inst.id); all[idx] = res.instance; saveInstances(all);
  audit(res.branch === 'later' ? 'shelved' : 'answered', { rule: inst.rule, instance: inst.id, branch: res.branch, answer: res.instance.answer }, opts.by);
  const out = { ok: true, instance: res.instance, branch: res.branch, option: res.option };
  if (res.branch === 'later') return out;
  const reg = registry();
  let actions = res.actions;
  let ctx = { ...E.eventContext(inst.event ?? {}, rule), answer: res.instance.answer, instance: { id: inst.id, title: inst.title } };
  if (inst.resume && (res.branch === 'approve' || res.branch === 'pick' || res.branch === 'text') && !actions.length) {
    actions = [{ action: 'pipeline.run', input: { pipeline: inst.resume.pipeline, stage: inst.resume.stage, params: inst.resume.params, gatePassed: true } }];
    ctx = { ...ctx, ...(inst.event?.payload || {}) };
  }
  if (!actions.length) { out.run = { ok: true, planned: 0, ran: [], failed: [], dispatch: [], note: `nothing to run on ${res.branch}` }; return out; }
  out.run = run(actions, { rule: inst.rule, instance: inst.id, by: opts.by, brett: opts.brett, ctx }, { registry: reg, exec: opts.exec, dry: opts.dry, trail: [`rule:${inst.rule}`, `answer:${res.branch}`] });
  if (!opts.dry) { const xs = loadInstances(); const i = xs.findIndex((x) => x.id === inst.id); if (i >= 0) { xs[i].status = out.run.ok ? 'ran' : 'failed'; xs[i].ranAt = now(); saveInstances(xs); } }
  return out;
}
export function waiting() {
  const xs = loadInstances();
  const w = xs.filter((i) => i.status === 'waiting' || i.status === 'shelved').sort((a, b) => String(a.askedAt).localeCompare(String(b.askedAt)));
  return { ok: true, count: w.filter((i) => i.status === 'waiting').length, shelved: w.filter((i) => i.status === 'shelved').length, items: w.map((i, n) => ({ n: n + 1, ...i })) };
}
export function expire(opts = {}) {
  const all = loadInstances(); const rulesById = Object.fromEntries(loadRules().map((r) => [r.id, r]));
  const changed = E.expireInstances(all, rulesById, now());
  const out = { ok: true, expired: [], dispatch: [] };
  for (const res of changed) {
    const i = all.findIndex((x) => x.id === res.instance.id); all[i] = res.instance;
    audit('expired', { rule: res.instance.rule, instance: res.instance.id, branch: res.branch }, 'tick');
    saveInstances(all);
    if (res.actions.length) {
      const ctx = { ...E.eventContext(res.instance.event ?? {}, rulesById[res.instance.rule]), answer: res.instance.answer };
      const r = run(res.actions, { rule: res.instance.rule, instance: res.instance.id, by: 'timeout', ctx }, { exec: opts.exec, trail: [`rule:${res.instance.rule}`, 'timeout'] });
      out.dispatch.push(...r.dispatch); out.expired.push({ instance: res.instance.id, branch: res.branch, ran: r.ran.length, failed: r.failed.length });
    } else out.expired.push({ instance: res.instance.id, branch: res.branch, ran: 0, failed: 0 });
  }
  return out;
}

/* ------------------------------------------------------------------ schedules (the server's tick, once a minute) */

const DUR = { s: 1, m: 60, h: 3600, d: 86400 };
export function durationSec(v) { const m = /^(\d+)\s*([smhd])?$/i.exec(String(v ?? '').trim()); return m ? Number(m[1]) * DUR[(m[2] || 'm').toLowerCase()] : 0; }
/** Which schedule rules are due now: `every` (a duration since the last tick of that rule) or `at` (HH:MM once a day, with weekday). */
export function dueSchedules(rulesList, state, nowIso) {
  const t = new Date(nowIso); const due = [];
  for (const r of rulesList) {
    if (!r.enabled || r.trigger.event !== 'schedule.tick') continue;
    const f = r.trigger.filter; const last = state.lastFired[r.id] ? new Date(state.lastFired[r.id]) : null;
    const every = durationSec(f.every); const at = typeof f.at === 'string' ? f.at : '';
    if (every > 0) { if (!last || t - last >= every * 1000) due.push(r); continue; }
    if (at) {
      const [hh, mm] = at.split(':').map(Number);
      if (!Number.isFinite(hh)) continue;
      const slot = new Date(t); slot.setUTCHours(hh, Number.isFinite(mm) ? mm : 0, 0, 0);
      const wd = f.weekday === undefined || f.weekday === '' ? null : Number(f.weekday);
      if (wd !== null && t.getUTCDay() !== wd) continue;
      if (t >= slot && (!last || last < slot)) due.push(r);
    }
  }
  return due;
}
export function tick(opts = {}) {
  const out = { ok: true, at: now(), expired: expire(opts).expired, schedules: [] };
  const state = loadState();
  for (const r of dueSchedules(loadRules(), state, out.at)) {
    const f = r.trigger.filter;
    const res = fire({ source: 'schedule', event: 'schedule.tick', payload: { schedule: f.schedule || r.id, every: f.every || '', at: f.at || '', weekday: f.weekday ?? '', hour: new Date(out.at).getUTCHours(), ...f }, by: 'tick' }, { by: 'tick', exec: opts.exec });
    out.schedules.push({ rule: r.id, fired: res.fired.some((x) => x.rule === r.id) });
  }
  return out;
}

/* ------------------------------------------------------------------ state + test */

export function state() {
  const reg = registry(); const rs = loadRules(); const w = waiting();
  return {
    ok: true, $axf: E.SCHEMA, rules: rs.map((r) => ({ ...r, summary: E.summarize(r, reg) })), macros: loadMacros(), pipelines: loadPipelines(), waiting: w.items, counts: { rules: rs.length, enabled: rs.filter((r) => r.enabled).length, macros: loadMacros().length, pipelines: loadPipelines().length, waiting: w.count, shelved: w.shelved },
    registry: summaryOfRegistry(reg), templates: E.TEMPLATES.map((t) => ({ id: t.id, title: t.title, group: t.group, description: t.description })), dataDir: dataDir(),
  };
}
/** A sample event for a rule from its event's fields (strings get the field name, numbers 1, enums their first value). */
export function sampleEvent(rule, reg = registry()) {
  const def = E.eventDef(reg, rule.trigger.event);
  const payload = {};
  for (const f of def?.fields ?? []) {
    const v = f.enum ? f.enum[0] : f.type === 'number' ? 1 : f.type === 'boolean' ? true : f.type === 'list' ? [`${f.name}-1`] : f.type === 'object' ? {} : `sample ${f.title.toLowerCase()}`;
    const parts = f.name.split('.'); let cur = payload;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = isObj(cur[parts[i]]) ? cur[parts[i]] : {};
    cur[parts[parts.length - 1]] = v;
  }
  for (const [k, v] of Object.entries(rule.trigger.filter)) { const parts = k.split('.'); let cur = payload; for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = isObj(cur[parts[i]]) ? cur[parts[i]] : {}; cur[parts[parts.length - 1]] = Array.isArray(v) ? v[0] : v; }
  return { source: def?.source || rule.trigger.source, event: rule.trigger.event, payload, by: 'test' };
}
/** Test-fire one rule: a sample (or given) event, limits ignored, dry unless `live`. Shows the prompt it would ask and the plan per answer. */
export function testRule(id, opts = {}) {
  const r = rules.get(id);
  if (!r) return { ok: false, error: `no rule ${id}`, code: 'not_found' };
  const reg = registry();
  const ev = E.normEvent(opts.event || sampleEvent(r, reg), { now: now() });
  const res = E.evaluate(r, ev, loadState(), now(), { force: true, registry: reg });
  const out = { ok: true, rule: r.id, event: ev, fire: res.fire, reason: res.reason, dry: !opts.live };
  if (!res.fire) return out;
  const ctx = res.ctx;
  if (res.instance) {
    out.instance = res.instance;
    out.plans = Object.fromEntries(Object.entries(r.on).flatMap(([k, v]) => (k === 'pick' ? Object.entries(v).map(([o, acts]) => [`pick:${o}`, E.plan(acts, { registry: reg, macros: loadMacros(), pipelines: loadPipelines(), ctx })]) : [[k, E.plan(v, { registry: reg, macros: loadMacros(), pipelines: loadPipelines(), ctx })]])));
    if (opts.live) { const xs = loadInstances(); xs.push(res.instance); saveInstances(xs); audit('asked', { rule: r.id, instance: res.instance.id, event: ev.id, kind: res.instance.kind, title: res.instance.title, test: true }, opts.by); }
    else audit('dry-run', { rule: r.id, event: ev.id, would: 'ask', kind: res.instance.kind, title: res.instance.title }, opts.by);
  } else out.run = run(res.actions, { rule: r.id, by: opts.by, ctx }, { registry: reg, dry: !opts.live, exec: opts.exec, trail: [`rule:${r.id}`, 'test'] });
  return out;
}
export function history(filter = {}, limit = 100) { return { ok: true, items: E.historyOf(readAudit(), filter, Math.min(1000, Math.max(1, Number(limit) || 100))) }; }

/* ------------------------------------------------------------------ CLI */

function parse(argv) {
  const words = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { words.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) flags[k] = inline;
    else if (['confirm', 'by', 'option', 'text', 'event', 'id', 'title', 'rule', 'instance', 'kind', 'limit'].includes(k) && i + 1 < argv.length) flags[k] = argv[++i];
    else flags[k] = true;
  }
  return { words, flags };
}
function jsonArg(v) {
  if (v === '-' || v === undefined) { try { return JSON.parse(readFileSync(0, 'utf8')); } catch { return null; } }
  try { return JSON.parse(v); } catch { return null; }
}
export function main(argv = process.argv.slice(2)) {
  const { words, flags } = parse(argv);
  const [cmd, a, b] = words;
  const by = flags.by || process.env.AXF_ACTOR || 'cli';
  const brett = process.env.AXF_APPROVER && process.env.AXF_APPROVER_VIA === 'console' && !process.env.CLAUDECODE && process.env.AXF_SURFACE !== 'headless' ? process.env.AXF_APPROVER : '';
  const need = (what) => ({ ok: false, error: `usage: ${what}`, code: 'usage' });
  switch (cmd) {
    case 'state': return state();
    case 'rules': return { ok: true, items: state().rules };
    case 'rule': { const r = rules.get(a); return r ? { ok: true, rule: r, summary: E.summarize(r, registry()) } : { ok: false, error: `no rule ${a}`, code: 'not_found' }; }
    case 'add-rule': { const j = jsonArg(a); return j ? rules.add(j, by) : need('add-rule <json|->'); }
    case 'update-rule': { const j = jsonArg(b); return a && j ? rules.update(a, j, by) : need('update-rule <id> <json|->'); }
    case 'enable': return a ? setEnabled(a, true, by) : need('enable <rule>');
    case 'disable': return a ? setEnabled(a, false, by) : need('disable <rule>');
    case 'remove-rule': return a ? rules.remove(a, flags.confirm, by) : need('remove-rule <id> --confirm <id>');
    case 'macros': return { ok: true, items: loadMacros() };
    case 'add-macro': { const j = jsonArg(a); return j ? macros.add(j, by) : need('add-macro <json|->'); }
    case 'update-macro': { const j = jsonArg(b); return a && j ? macros.update(a, j, by) : need('update-macro <id> <json|->'); }
    case 'remove-macro': return a ? macros.remove(a, flags.confirm, by) : need('remove-macro <id> --confirm <id>');
    case 'pipelines': return { ok: true, items: loadPipelines() };
    case 'add-pipeline': { const j = jsonArg(a); return j ? pipelines.add(j, by) : need('add-pipeline <json|->'); }
    case 'update-pipeline': { const j = jsonArg(b); return a && j ? pipelines.update(a, j, by) : need('update-pipeline <id> <json|->'); }
    case 'remove-pipeline': return a ? pipelines.remove(a, flags.confirm, by) : need('remove-pipeline <id> --confirm <id>');
    case 'manifest': { const reg = registry(); if (a) { const s = reg.sources.find((x) => x.source === E.slug(a)); return s ? { ok: true, source: s } : { ok: false, error: `no source ${a}`, code: 'not_found' }; } return { ok: true, ...reg }; }
    case 'register-manifest': { const j = jsonArg(a); return j ? registerManifest(j, by) : need('register-manifest <json|->'); }
    case 'options': return options(jsonArg(a) || {}, { live: Boolean(flags.live) });
    case 'templates': return { ok: true, items: E.TEMPLATES.map((t) => ({ ...t, summary: E.summarize(E.fromTemplate(t.id), registry()) })) };
    case 'use-template': return a ? useTemplate(a, { id: flags.id, title: flags.title }, by) : need('use-template <id> [--id x] [--title t]');
    case 'fire': { const j = jsonArg(a); return j ? fire(j, { by, dry: Boolean(flags.dry), brett }) : need('fire <json|-> [--dry]'); }
    case 'test': return a ? testRule(a, { event: flags.event ? jsonArg(flags.event) : null, live: Boolean(flags.live), by }) : need('test <rule> [--event json] [--live]');
    case 'waiting': return waiting();
    case 'answer': { if (!a) return need('answer <instance|n> <approve|deny|later|pick|text> [--option o] [--text t]'); const ans = b === 'pick' ? { kind: 'pick', option: flags.option ?? words[3] } : b === 'text' ? { kind: 'text', text: flags.text ?? words.slice(3).join(' ') } : b || flags.text; return answer(a, ans, { by, brett }); }
    case 'expire': return expire();
    case 'tick': return tick();
    case 'history': return history({ rule: flags.rule, instance: flags.instance, kind: flags.kind }, flags.limit);
    case 'run': { const j = jsonArg(a); return j ? run(j.actions ?? j, { by, ctx: j.ctx ?? {}, brett }, { dry: Boolean(flags.dry) }) : need('run <json|-> [--dry]'); }
    default: return { ok: false, error: 'commands: state rules rule add-rule update-rule enable disable remove-rule macros add-macro update-macro remove-macro pipelines add-pipeline update-pipeline remove-pipeline manifest register-manifest options templates use-template fire test waiting answer expire tick history run', code: 'usage' };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const res = main();
  const json = process.argv.includes('--json');
  if (json || !res.ok) console.log(JSON.stringify(res, null, json ? 0 : 2));
  else if (res.items) for (const i of res.items) console.log(i.id ? `${i.id}${i.enabled === false ? ' (off)' : ''}  ${i.summary || i.title || i.kind || ''}` : JSON.stringify(i));
  else console.log(JSON.stringify(res, null, 2));
  process.exit(res.ok ? 0 : res.code === 'usage' ? 2 : res.code === 'confirmation_required' ? 3 : 1);
}
