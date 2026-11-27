#!/usr/bin/env node
/**
 * watchdog.mjs — the Build orchestrator's one watchdog (build-watchdogs@1). It runs on the VPS host from one cron
 * (axf-build-watchdog, every minute) and hosts every watch in ./watchdog/:
 *
 *   sessions   the server watchdog: builds marked running whose session is stuck, was killed or failed are reset and
 *              requeued, retried, or moved to another account (watchdog/sessions.mjs, build-watchdog@1)
 *   stale      builds standing in one status (landing, fixing, merging) too long are pushed to the next action on their
 *              ladder: the lander nudged, the retry ladder's next rung, an escalation (watchdog/stale.mjs, stale-status@1)
 *   rows       rows left on a list after their PR merged or closed are completed or removed (watchdog/rows.mjs,
 *              stale-row@1)
 *
 * Pipeline 2.0 builds are not watched here: deploy/watchdog (pipeline-watchdog@2) is their one watchdog.
 *
 * A watch is a module that exports WATCH = { id, label, what, schema, settings(), set(patch), scan(), run() }; the list
 * is WATCH_FILES below (register() adds one at run time). One pass asks every watch that is on and due to run, writes
 * what each caught to ONE log (watchdog-catch@1 records), keeps one state file and sends one alert per pass.
 *
 *   node apps/console-web/plugins/build-orchestrator/watchdog.mjs status [--json]      every watch: on/off, last run, caught
 *   … watches [--json]                         the watches and what each does
 *   … scan [--watch id] [--json]               dry run: what each watch would catch now; nothing changes
 *   … run [--watch id] [--build id] [--force] [--by who] [--json]   one pass now (--force: also watches that are off or not due)
 *   … caught [--watch id] [--build id] [--limit n] [--json]         what was caught, newest first
 *   … settings [--json]                        every setting: enabled, alerts, <watch>.<key>
 *   … set key=value… [--by who] | set --patch '{…}'                change settings (set sessions.maxRetries=5 stale.enabled=off)
 *   … request [--watch id] [--build id] [--by who]                  ask the host for a pass (the console container can't see tmux)
 *   … cron                                     what the cron runs: a requested pass, else every watch that is due
 *   … install-cron | remove-cron | cron-status the VPS schedule (/etc/cron.d/axf-build-watchdog, watchdog/cron.mjs)
 *   … sessions <args> | stale <args> | rows <args>                  a watch's own commands (sessions requeue, rows log, …)
 *
 * Files (the pipeline folder, shared with the console container): watchdogs.json (watchdogs-state@1: last pass, each
 * watch's last run), watchdogs-caught.jsonl (the one caught log), watchdogs-settings.json (enabled, alerts),
 * watchdogs-request.json (a pass the console asked for). Each watch keeps its own settings where it always did.
 * AXF_WATCHDOGS_DIR overrides the folder (tests); AXF_WATCHDOG_NOTIFY_LOG takes the alerts instead of the console.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as DF from '../../../../framework/core/data-files.mjs';

export const SCHEMA = 'build-watchdogs@1';
export const CATCH = 'watchdog-catch@1';
export const STATE = 'watchdogs-state@1';
export const HERE = dirname(fileURLToPath(import.meta.url));
/** The watches, in the order a pass runs them: a dead session is recovered before its build is judged stale. */
export const WATCH_FILES = Object.freeze({ sessions: 'watchdog/sessions.mjs', stale: 'watchdog/stale.mjs', rows: 'watchdog/rows.mjs' });
/** The alert link: the orchestrator's Watchdog tab (`?build=<id>` for one build). */
export const ALERT_LINK = 'build-orchestrator.focus:watchdog';
export const ALERT_SOURCE = 'watchdog';
/** No heartbeat for this long while the watchdog is on is stale (the systems check's red). The cron beats every minute. */
export const STALE_PASS_MIN = 5;
const CAUGHT_KEPT = 2000;
const MIN = 60_000;

const str = (v, max = 400) => (typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max));
// the watchdog's files go through the console's data layer (data-store@1): local files or axf-data, by the namespace's mode
const readJson = (f, d = null) => DF.readJson(f, d);
const writeJson = (f, v) => DF.writeJson(f, v, 1);
const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------------ files

let pipeDirOf = null;
/** The folder the watchdog's files live in: AXF_WATCHDOGS_DIR, else the pipeline folder (shared with the console). */
export async function dataDir(env = process.env) {
  if (env.AXF_WATCHDOGS_DIR) return env.AXF_WATCHDOGS_DIR;
  pipeDirOf ??= (await import('./pipeline.mjs')).pipeDir;
  return pipeDirOf(env);
}
const fileOf = async (name, env) => join(await dataDir(env), name);

// ------------------------------------------------------------------ the watches (an open registry)

const extra = new Map();
/** Add a watch at run time (a plugin, a test): { id, label, what, schema, settings, set, scan, run }. */
export function register(watch) {
  if (!watch || !/^[a-z][a-z0-9-]{1,30}$/.test(watch.id ?? '') || typeof watch.run !== 'function') throw new Error('a watch needs an id (a-z, 0-9, -) and run()');
  extra.set(watch.id, watch);
  return () => extra.delete(watch.id);
}
export const watchIds = () => [...new Set([...Object.keys(WATCH_FILES), ...extra.keys()])];

/** Load one watch → { id, watch } or { id, error } (a watch that cannot load never stops the others). */
export async function loadWatch(id) {
  if (extra.has(id)) return { id, watch: extra.get(id) };
  const f = WATCH_FILES[id];
  if (!f) return { id, error: `no watch "${id}" (${watchIds().join(', ')})` };
  try {
    const m = await import(pathToFileURL(join(HERE, f)).href);
    if (!m.WATCH || m.WATCH.id !== id) return { id, error: `${f} exports no WATCH with id ${id}` };
    return { id, watch: m.WATCH };
  } catch (e) { return { id, error: str(e?.message ?? e, 300) }; }
}
export const loadWatches = async (only = '') => Promise.all(watchIds().filter((id) => !only || id === only).map(loadWatch));

// ------------------------------------------------------------------ settings

/** The watchdog's own settings; every watch adds its own under `<watch>.<key>`. */
export const HOST_SCHEMA = Object.freeze({
  enabled: { type: 'boolean', default: true, title: 'Watchdog on (every watch)' },
  alerts: { type: 'choice', options: ['batch', 'each', 'off'], default: 'batch', title: 'Alerts: one per pass, one per catch, or none (a give-up always alerts)' },
});

/** One value checked against its schema entry; throws a plain message when it does not fit. */
export function coerce(key, value, spec) {
  if (!spec) throw Object.assign(new Error(`no watchdog setting "${key}"`), { code: 2 });
  if (spec.type === 'boolean') {
    if (value === true || value === false) return value;
    const v = String(value).toLowerCase();
    if (['on', 'true', '1', 'yes'].includes(v)) return true;
    if (['off', 'false', '0', 'no'].includes(v)) return false;
    throw Object.assign(new Error(`${key} is on or off`), { code: 2 });
  }
  if (spec.type === 'integer') {
    const n = Number(value);
    if (!Number.isInteger(n) || n < (spec.min ?? -Infinity) || n > (spec.max ?? Infinity)) throw Object.assign(new Error(`${key} is a whole number from ${spec.min} to ${spec.max}`), { code: 2 });
    return n;
  }
  if (spec.type === 'choice') {
    if (!spec.options.includes(String(value))) throw Object.assign(new Error(`${key} is one of ${spec.options.join(', ')}`), { code: 2 });
    return String(value);
  }
  return value;
}

export async function hostSettings(env = process.env) {
  const raw = await readJson(await fileOf('watchdogs-settings.json', env), {}) ?? {};
  const out = {};
  for (const [k, spec] of Object.entries(HOST_SCHEMA)) { try { out[k] = raw[k] === undefined ? spec.default : coerce(k, raw[k], spec); } catch { out[k] = spec.default; } }
  return out;
}

/**
 * Every setting in one flat map: { values: { enabled, alerts, 'sessions.maxRetries', … }, schema: { key: { type, …,
 * title, watch } }, unavailable: { watch: why } }. The same map Settings, REST, MCP, the CLI and voice read and write.
 */
export async function allSettings(env = process.env) {
  const values = { ...(await hostSettings(env)) };
  const schema = Object.fromEntries(Object.entries(HOST_SCHEMA).map(([k, v]) => [k, { ...v, watch: '' }]));
  const unavailable = {};
  for (const w of await loadWatches()) {
    if (!w.watch) { unavailable[w.id] = w.error; continue; }
    let cur = {};
    try { cur = await w.watch.settings(env) ?? {}; } catch (e) { unavailable[w.id] = str(e.message, 200); continue; }
    for (const [k, spec] of Object.entries(w.watch.schema ?? {})) { schema[`${w.id}.${k}`] = { ...spec, watch: w.id }; values[`${w.id}.${k}`] = cur[k] ?? spec.default; }
  }
  return { $axf: 'watchdogs-settings@1', values, schema, unavailable };
}

/** Change settings: { enabled, alerts, '<watch>.<key>' }. Every key is checked before anything is saved. */
export async function setSettings(patch = {}, { by = process.env.AXF_ACTOR || 'cli', env = process.env } = {}) {
  const { schema } = await allSettings(env);
  const host = {}; const perWatch = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    const spec = schema[k];
    if (!spec) throw Object.assign(new Error(`no watchdog setting "${k}" (${Object.keys(schema).join(', ')})`), { code: 2 });
    const val = coerce(k, v, spec);
    if (!spec.watch) host[k] = val; else (perWatch[spec.watch] ??= {})[k.slice(spec.watch.length + 1)] = val;
  }
  if (Object.keys(host).length) {
    const f = await fileOf('watchdogs-settings.json', env);
    await writeJson(f, { $axf: 'watchdogs-host-settings@1', ...(await hostSettings(env)), ...host, setBy: str(by, 80), setAt: nowIso() });
  }
  for (const [id, p] of Object.entries(perWatch)) { const w = await loadWatch(id); await w.watch.set(p, { by, env }); }
  return allSettings(env);
}

// ------------------------------------------------------------------ state and the caught log

export async function loadState(env = process.env) {
  return { $axf: STATE, lastPass: '', passes: 0, watches: {}, ...(await readJson(await fileOf('watchdogs.json', env), {}) ?? {}) };
}
const saveState = async (s, env) => writeJson(await fileOf('watchdogs.json', env), { ...s, $axf: STATE });

/** A catch as the log keeps it (watchdog-catch@1): what was caught, on which build, why, and what was done. */
export function normCatch(c, { at = nowIso(), watch = '' } = {}) {
  return { $axf: CATCH, at: str(c.at, 40) || at, watch: str(c.watch || watch, 40), build: str(c.build, 120), title: str(c.title, 160), status: str(c.status, 40),
    cause: str(c.cause, 200), action: str(c.action, 60), rung: str(c.rung, 60), attempt: Number.isFinite(Number(c.attempt)) ? Number(c.attempt) : 0, minutes: Number.isFinite(Number(c.minutes)) ? Math.round(Number(c.minutes)) : 0,
    ok: c.ok !== false, gaveUp: c.gaveUp === true, notified: str(c.notified, 40), note: str(c.note, 600), ...(c.pr ? { pr: str(c.pr, 20) } : {}) };
}

async function appendCaught(recs, env) {
  if (!recs.length) return;
  const f = await fileOf('watchdogs-caught.jsonl', env);
  for (const r of recs) await DF.appendJsonl(f, r);
  const lines = String(await DF.readText(f, '') ?? '').split('\n').filter(Boolean);
  if (lines.length > CAUGHT_KEPT * 1.5) await DF.writeText(f, `${lines.slice(-CAUGHT_KEPT).join('\n')}\n`);
}

/** What was caught, newest first. Filters: watch, build, gaveUp; `limit` (default 100). */
export async function caught({ watch = '', build = '', gaveUp = null, limit = 100, env = process.env } = {}) {
  let lines = [];
  try { lines = String(await DF.readText(await fileOf('watchdogs-caught.jsonl', env), '') ?? '').split('\n').filter(Boolean); } catch { /* nothing caught yet */ }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < Math.max(1, Math.min(1000, Number(limit) || 100)); i -= 1) {
    let r = null; try { r = JSON.parse(lines[i]); } catch { continue; }
    if ((watch && r.watch !== watch) || (build && r.build !== build) || (gaveUp != null && !!r.gaveUp !== !!gaveUp)) continue;
    out.push(r);
  }
  return out;
}

// ------------------------------------------------------------------ alerts

const catchLine = (c) => `${c.title || c.build || c.watch}: ${c.status ? `${c.status}, ` : ''}${c.cause} → ${c.action}${c.rung ? ` (${c.rung})` : ''}${c.attempt ? `, attempt ${c.attempt}` : ''}`;

/**
 * The alerts for one pass's catches that nobody was told about yet: one per give-up (always), plus one FYI for the rest
 * ('batch'), one each ('each') or none ('off'). Each alert carries `catches` (the records it covers).
 */
export function alertsFor(catches, { alerts = 'batch', at = nowIso(), labels = {} } = {}) {
  const todo = catches.filter((c) => !c.notified && c.ok !== false);
  const gave = todo.filter((c) => c.gaveUp); const rest = todo.filter((c) => !c.gaveUp);
  const link = (c) => (c.build ? `${ALERT_LINK}?build=${encodeURIComponent(c.build)}` : ALERT_LINK);
  const meta = (c) => ({ kind: c.gaveUp ? 'gave-up' : 'caught', watch: c.watch, build: c.build, status: c.status, cause: c.cause, action: c.action, attempt: c.attempt });
  const out = gave.map((c) => ({ source: ALERT_SOURCE, key: `watchdog:gave-up:${c.watch}:${c.build}`, severity: 'error', link: link(c),
    title: `Watchdog gave up: ${str(c.title || c.build, 100)}`, body: str(`${catchLine(c)}\n${c.note}\nRetry it from the systems check banner or Build orchestrator → Watchdog.`, 1500), meta: meta(c), catches: [c] }));
  if (!rest.length || alerts === 'off') return out;
  if (alerts === 'each') return [...rest.map((c) => ({ source: ALERT_SOURCE, key: `watchdog:caught:${c.watch}:${c.build || 'none'}:${c.at}`, severity: 'info', link: link(c),
    title: `Watchdog: ${str(c.title || c.build || labels[c.watch] || c.watch, 100)}`, body: str(`${catchLine(c)}\n${c.note}`, 1500), meta: meta(c), catches: [c] })), ...out];
  const by = [...new Set(rest.map((c) => labels[c.watch] || c.watch))];
  return [{ source: ALERT_SOURCE, key: `watchdog:caught:${at}`, severity: 'info', link: rest.length === 1 ? link(rest[0]) : ALERT_LINK,
    title: rest.length === 1 ? `Watchdog: ${str(rest[0].title || rest[0].build || by[0], 100)}` : `Watchdog caught ${rest.length} (${by.join(', ')})`,
    body: str(rest.map((c) => `${catchLine(c)}${rest.length === 1 ? `\n${c.note}` : ''}`).join('\n'), 1500),
    meta: { kind: 'caught', count: rest.length, watches: [...new Set(rest.map((c) => c.watch))], builds: rest.map((c) => c.build).filter(Boolean) }, catches: rest }, ...out];
}

/** Send one alert: the console's alerts API, or AXF_WATCHDOG_NOTIFY_LOG (tests: one JSON line each). */
export async function sendAlert(a, env = process.env) {
  const { catches, ...alert } = a;
  // axf-data: not data (a test hook: the alerts go to this file instead of the console)
  if (env.AXF_WATCHDOG_NOTIFY_LOG) { try { appendFileSync(env.AXF_WATCHDOG_NOTIFY_LOG, `${JSON.stringify(alert)}\n`); return true; } catch { return false; } }
  try { return (await import('./pipeline.mjs')).makeConsole(env)('POST', '/api/alerts', alert) != null; } catch { return false; }
}

// ------------------------------------------------------------------ one pass

const dueAt = (st, intervalMin) => (Date.parse(st?.lastRun || '') || 0) + Math.max(1, Number(intervalMin) || 1) * MIN - 5000;

/**
 * One pass: every watch that is on and due (or `only`, or all with force) runs; what each caught goes to the one log,
 * the state file and the alerts. A watch that throws is recorded and never stops the next one.
 * → { $axf, at, by, ran: [{ id, caught, gaveUp, watching, skipped, errors, durationMs }], notRun: [{ id, why }], catches, alerts }
 */
export async function pass({ env = process.env, only = '', build = '', force = false, by = 'watchdog', now = Date.now(), watchOpts = {} } = {}) {
  const at = new Date(now).toISOString();
  const host = await hostSettings(env);
  const state = await loadState(env);
  const ran = []; const notRun = []; const catches = []; const labels = {};
  for (const w of await loadWatches(only)) {
    if (!w.watch) { notRun.push({ id: w.id, why: `cannot load: ${w.error}` }); state.watches[w.id] = { ...(state.watches[w.id] ?? {}), lastError: w.error, lastErrorAt: at }; continue; }
    labels[w.id] = w.watch.label;
    let settings = {};
    try { settings = await w.watch.settings(env) ?? {}; } catch { /* a watch with unreadable settings runs on its defaults */ }
    const st = state.watches[w.id] ?? {};
    // a pass the console asked one watch for (its own request file): runs now, even when the watch is off
    let asked = null;
    if (!force && typeof w.watch.asked === 'function') { try { asked = w.watch.asked(env); } catch { /* no request */ } }
    if (!force && !asked) {
      if (!host.enabled) { notRun.push({ id: w.id, why: 'the watchdog is off' }); continue; }
      if (settings.enabled === false) { notRun.push({ id: w.id, why: 'this watch is off' }); continue; }
      if (now < dueAt(st, settings.intervalMin)) { notRun.push({ id: w.id, why: `next run due ${new Date(dueAt(st, settings.intervalMin) + 5000).toISOString()}` }); continue; }
    }
    const t0 = Date.now(); let res = null; let error = '';
    try { res = await w.watch.run({ env, only: build || asked?.build || '', by: asked?.by || by, force: force || !!asked, ...(watchOpts[w.id] ?? {}) }); } catch (e) { error = str(e?.message ?? e, 300); }
    const mine = (res?.catches ?? []).map((c) => normCatch(c, { at, watch: w.id }));
    catches.push(...mine);
    const errors = [...(error ? [error] : []), ...(res?.errors ?? []).filter(Boolean).map((e) => str(e, 300))];
    const rec = { id: w.id, label: w.watch.label, caught: mine.length, gaveUp: mine.filter((c) => c.gaveUp).length, watching: res?.watching ?? 0, skipped: res?.skipped ?? [], errors, durationMs: Date.now() - t0 };
    ran.push(rec);
    state.watches[w.id] = { ...st, lastRun: at, runs: (st.runs ?? 0) + 1, lastCaught: mine.length, watching: rec.watching, durationMs: rec.durationMs, skipped: rec.skipped.slice(0, 20),
      ...(errors.length ? { lastError: errors[0], lastErrorAt: at } : { lastOk: at, lastError: '' }), ...(mine.length ? { lastCatch: at, caught: (st.caught ?? 0) + mine.length } : {}) };
  }
  // tell the phone: whatever a watch did not already send itself
  let sent = 0;
  if (catches.length) {
    for (const a of alertsFor(catches, { alerts: host.alerts, at, labels })) {
      if (!(await sendAlert(a, env))) continue;
      sent += 1; for (const c of a.catches) c.notified = at;
    }
    await appendCaught(catches, env);
  }
  // lastTick is the heartbeat (every cron minute, whether or not a watch was due); lastPass is the last time one ran
  await saveState({ ...state, lastTick: at, ...(ran.length ? { lastPass: at, lastBy: str(by, 80), passes: (state.passes ?? 0) + 1 } : {}), ...(catches.length ? { lastCatch: at } : {}) }, env);
  return { $axf: 'watchdogs-pass@1', at, by, ran, notRun, catches, alerts: sent };
}

/** Dry run: what every watch (or one) would catch now. Nothing changes. */
export async function scan({ env = process.env, only = '' } = {}) {
  const out = [];
  for (const w of await loadWatches(only)) {
    if (!w.watch) { out.push({ id: w.id, error: w.error, items: [] }); continue; }
    if (typeof w.watch.scan !== 'function') { out.push({ id: w.id, label: w.watch.label, items: [], note: 'this watch has no dry run' }); continue; }
    try { const r = await w.watch.scan({ env }); out.push({ id: w.id, label: w.watch.label, watching: r.watching ?? 0, items: (r.items ?? []).map((c) => normCatch(c, { watch: w.id })) }); }
    catch (e) { out.push({ id: w.id, label: w.watch.label, error: str(e.message, 300), items: [] }); }
  }
  return { $axf: 'watchdogs-scan@1', at: nowIso(), watches: out, items: out.flatMap((w) => w.items) };
}

/** Ask the host for a pass (the console container can't see the host's processes): the next cron minute runs it. */
export async function requestPass({ by = process.env.AXF_ACTOR || 'console', watch = '', build = '', env = process.env } = {}) {
  const r = { at: nowIso(), by: str(by, 80), watch: str(watch, 40), build: str(build, 120) };
  await writeJson(await fileOf('watchdogs-request.json', env), r);
  return r;
}

/** The cron's minute: a pass somebody asked for (forced, for that watch / build), then every watch that is due. */
export async function cronPass({ env = process.env } = {}) {
  const f = await fileOf('watchdogs-request.json', env);
  const asked = await readJson(f);
  if (asked) { try { DF.removeSync(f); } catch { /* gone */ } return { asked, ...(await pass({ env, only: asked.watch || '', build: asked.build || '', force: true, by: asked.by || 'console' })) }; }
  return pass({ env, by: 'cron' });
}

// ------------------------------------------------------------------ status

/**
 * Everything the Watchdog tab, REST, MCP, the CLI and voice show: on/off, the cron, the last pass and its age, and per
 * watch what it is, whether it is on, its last run, what it caught, its last error. `ageMin` is the age of the heartbeat
 * (lastTick: the cron reached the watchdog), `stale` = on and no heartbeat for STALE_PASS_MIN minutes.
 */
export async function status({ env = process.env, now = Date.now(), recent = 20 } = {}) {
  const host = await hostSettings(env); const state = await loadState(env);
  // alive = the cron reached the watchdog lately (the heartbeat), not "a watch happened to be due"
  const last = Date.parse(state.lastTick || state.lastPass || '') || 0;
  const ageMin = last ? Math.round((now - last) / 6000) / 10 : null;
  const watches = [];
  for (const w of await loadWatches()) {
    const st = state.watches[w.id] ?? {};
    if (!w.watch) { watches.push({ id: w.id, label: w.id, available: false, error: w.error, enabled: false, ...st }); continue; }
    let settings = {}; try { settings = await w.watch.settings(env) ?? {}; } catch { /* defaults */ }
    watches.push({ id: w.id, label: w.watch.label, what: w.watch.what, hostOnly: !!w.watch.hostOnly, available: true, enabled: host.enabled && settings.enabled !== false, intervalMin: settings.intervalMin ?? 1,
      lastRun: st.lastRun ?? '', lastOk: st.lastOk ?? '', lastError: st.lastError ?? '', lastErrorAt: st.lastErrorAt ?? '', lastCatch: st.lastCatch ?? '', lastCaught: st.lastCaught ?? 0, caught: st.caught ?? 0, runs: st.runs ?? 0, watching: st.watching ?? 0, skipped: st.skipped ?? [] });
  }
  let cron = null; try { cron = (await import('./watchdog/cron.mjs')).status(); } catch { /* no cron module */ }
  const recentCaught = await caught({ limit: recent, env });
  return { $axf: 'watchdogs-status@1', ok: true, at: new Date(now).toISOString(), enabled: host.enabled, alerts: host.alerts, cron, lastTick: state.lastTick || '', lastPass: state.lastPass || '', lastBy: state.lastBy || '', ageMin,
    stale: host.enabled && (ageMin == null || ageMin > STALE_PASS_MIN), passes: state.passes ?? 0, lastCatch: state.lastCatch || '', watches,
    caught: recentCaught, gaveUp: (await caught({ gaveUp: true, limit: 20, env })), request: await readJson(await fileOf('watchdogs-request.json', env)) };
}

// ------------------------------------------------------------------ CLI

function flags(argv) {
  const f = {}; const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    if (['json', 'force', 'dry-run'].includes(k)) f[k] = true; else { f[k] = argv[i + 1] ?? ''; i += 1; }
  }
  return { f, pos };
}
const ago = (iso) => { const t = Date.parse(iso || ''); if (!t) return 'never'; const m = Math.round((Date.now() - t) / MIN); return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
const printCatch = (c) => console.log(`  ${c.ok === false ? '✗' : c.gaveUp ? '!' : '✓'} ${c.at ? `${c.at.slice(0, 16).replace('T', ' ')} ` : ''}[${c.watch}] ${catchLine(c)}${c.note ? `\n      ${c.note}` : ''}`);

/** The words `axf watchdog <word>` runs (plugin.json "cli": { "watchdog": "watchdog.mjs" }). */
export const cliWords = ['status', 'watches', 'scan', 'run', 'caught', 'settings', 'set', 'request', 'cron', 'install-cron', 'remove-cron', 'cron-status', ...Object.keys(WATCH_FILES)];

export async function main(argv = process.argv.slice(2)) {
  const [cmd = 'status', ...rest] = argv;
  // a watch's own commands: `watchdog.mjs sessions requeue <id>`, `watchdog.mjs rows log --limit 20`
  if (WATCH_FILES[cmd]) { const m = await import(pathToFileURL(join(HERE, WATCH_FILES[cmd])).href); if (typeof m.main !== 'function') throw new Error(`the ${cmd} watch has no commands of its own`); return m.main(rest); }
  const { f, pos } = flags(rest);
  const out = (o, print) => (f.json ? console.log(JSON.stringify(o, null, 1)) : print(o));
  if (cmd === 'status') {
    return out(await status(), (s) => {
      console.log(`watchdog ${s.enabled ? 'on' : 'off'} · checked ${ago(s.lastTick || s.lastPass)}${s.stale ? ' (STALE: the cron is not running it)' : ''} · a watch last ran ${ago(s.lastPass)} · cron ${s.cron?.installed ? (s.cron.current ? 'installed' : 'installed, out of date') : 'not installed'} · alerts ${s.alerts}`);
      for (const w of s.watches) console.log(`  ${w.available ? (w.enabled ? '✓' : '–') : '!'} ${w.id.padEnd(9)} ${w.available ? `${w.enabled ? `every ${w.intervalMin} min` : 'off'} · last run ${ago(w.lastRun)} · caught ${w.caught}${w.lastError ? ` · last error: ${w.lastError}` : ''}` : `cannot load: ${w.error}`}`);
      if (s.caught.length) { console.log('caught lately:'); s.caught.slice(0, 10).forEach(printCatch); }
    });
  }
  if (cmd === 'watches') return out((await loadWatches()).map((w) => (w.watch ? { id: w.id, label: w.watch.label, what: w.watch.what, hostOnly: !!w.watch.hostOnly } : { id: w.id, error: w.error })), (l) => l.forEach((w) => console.log(`${w.id.padEnd(9)} ${w.error ? `cannot load: ${w.error}` : `${w.label}: ${w.what}`}`)));
  if (cmd === 'scan') {
    return out(await scan({ only: f.watch || '' }), (s) => {
      for (const w of s.watches) { console.log(`${w.id}: ${w.error ? `failed: ${w.error}` : `${w.items.length} to catch${w.watching != null ? ` of ${w.watching} watched` : ''}`}`); w.items.forEach(printCatch); }
    });
  }
  if (cmd === 'run') {
    const r = await pass({ only: f.watch || '', build: f.build || '', force: !!f.force || !!f.watch || !!f.build, by: f.by || process.env.AXF_ACTOR || 'cli' });
    out(r, printPass);
    if (r.ran.some((x) => x.errors.length)) process.exitCode = 1;
    return r;
  }
  if (cmd === 'cron') { const r = await cronPass(); out(r, (p) => { if (p.ran.length) printPass(p); }); return r; }
  if (cmd === 'request') return out(await requestPass({ by: f.by || undefined, watch: f.watch || '', build: f.build || '' }), (r) => console.log(`asked the host for a pass${r.watch ? ` of ${r.watch}` : ''}${r.build ? ` for ${r.build}` : ''}: the next cron minute runs it`));
  if (cmd === 'caught') return out({ caught: await caught({ watch: f.watch || '', build: f.build || '', limit: Number(f.limit) || 50 }) }, (o) => { if (!o.caught.length) console.log('nothing caught yet'); o.caught.forEach(printCatch); });
  if (cmd === 'settings') return out(await allSettings(), (s) => { for (const [k, v] of Object.entries(s.values)) console.log(`${k.padEnd(28)} ${String(v).padEnd(8)} ${s.schema[k].title}`); for (const [id, why] of Object.entries(s.unavailable)) console.log(`${id}: unavailable (${why})`); });
  if (cmd === 'set') {
    let patch = {};
    if (f.patch) patch = JSON.parse(f.patch);
    else if (pos.length === 2 && !pos[0].includes('=')) patch = { [pos[0]]: pos[1] };
    else for (const p of pos) { const i = p.indexOf('='); if (i < 1) throw Object.assign(new Error('usage: set key=value… | set --patch \'{…}\''), { code: 2 }); patch[p.slice(0, i)] = p.slice(i + 1); }
    if (!Object.keys(patch).length) throw Object.assign(new Error('usage: set key=value… | set --patch \'{…}\''), { code: 2 });
    return out(await setSettings(patch, { by: f.by || undefined }), (s) => { for (const k of Object.keys(patch)) console.log(`${k} = ${s.values[k]}`); });
  }
  if (['install-cron', 'remove-cron', 'cron-status'].includes(cmd)) {
    const cron = await import('./watchdog/cron.mjs');
    const r = cmd === 'install-cron' ? cron.install({ force: !!f.force }) : cmd === 'remove-cron' ? cron.uninstall() : cron.status();
    return out(r, (o) => console.log(JSON.stringify(o)));
  }
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 35).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
}

function printPass(p) {
  console.log(`watchdog pass ${p.at} · ${p.ran.length} watch(es) ran · ${p.catches.length} caught${p.alerts ? ` · ${p.alerts} alert(s)` : ''}`);
  for (const r of p.ran) console.log(`  ${r.errors.length ? '!' : '✓'} ${r.id}: ${r.caught} caught of ${r.watching} watched · ${r.durationMs} ms${r.errors.length ? ` · ${r.errors.join('; ')}` : ''}`);
  for (const n of p.notRun) console.log(`  – ${n.id}: ${n.why}`);
  p.catches.forEach(printCatch);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => { /* a watch may hold handles open (a GitHub client): the pass is done */ if (['run', 'cron', 'scan'].includes(process.argv[2])) process.exit(process.exitCode ?? 0); })
    .catch((e) => { console.error(`watchdog: ${e.message}`); process.exit(e.code === 2 ? 2 : 1); });
}
