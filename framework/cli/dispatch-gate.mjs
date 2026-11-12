#!/usr/bin/env node
/**
 * dispatch-gate — one way to start a build: the orchestrator (Brett, Nov 9 2026: "We need to make sure there's only one
 * way to start builds. It can't be two. It needs to be one. It has to be the orchestrator. The orchestrator has to take
 * the build from the queue and then start them. Not the build manager.").
 *
 * The orchestrator's dispatcher (its pipeline tick) issues a one-build
 * dispatch token right before it runs deploy/claude-headless.sh and hands it over in AXF_DISPATCH_TOKEN. The launcher asks
 * this gate before anything starts: a launch that belongs to a build (an orchestrator build named by --build /
 * AXF_BUILD_ID, the session name or the brief's "Continue build … (<id>)" line, or any session named build-* / build:*)
 * without a valid token for that build is refused (exit 3, one line saying how to queue it). Non-build sessions (a
 * walkthrough, a UI shot job, a chat) are not builds and pass.
 *
 *   node framework/cli/dispatch-gate.mjs check   [--build <id>] [--name <session>] [--brief <file>] [--json]   exit 0 ok · 3 refused
 *   node framework/cli/dispatch-gate.mjs consume [--build <id>] [--name <session>] [--brief <file>]           mark the token used
 *   node framework/cli/dispatch-gate.mjs issue <build> --account <a> --model <m>      (the dispatcher's call; prints the token)
 *   node framework/cli/dispatch-gate.mjs list [--json]                                 tokens on file (no token values)
 *
 * A token is bound to one build, lives DISPATCH_TTL_MS (long enough for a look-approval wait), and is spent when the
 * session really starts (consume, after the look gate), so the look waiter's relaunch still passes and nothing can
 * reuse it. Tokens sit in the dispatcher's folder (dispatch.json, 0600; AXF_DISPATCH_DIR, else the pipeline folder).
 * The file holds only a hash of each token.
 *
 * The ID registry (the server gate, Nov 12 2026): the builds store is the registry of orchestrator-issued IDs. A launch is a
 * build launch when it names a build at all (--build / AXF_BUILD_ID, a `# Build: <id>` brief heading, the "Continue build"
 * line, a build-* / build:* session name); it starts only when that ID is in the registry, the build is in Queued (or
 * Running with its dispatch token not yet spent: the dispatcher's own launch, a look-approval relaunch) and the token
 * holds. No ID, an unknown ID or any other status (Pending, Built, Archived…) is refused. The re-entries the launcher makes
 * for itself (--queued slot waiter, --inner tmux run) ask `reentry`: the build's token must already be spent by a
 * dispatcher launch, so `claude-headless.sh --inner` by hand is refused too. Every refusal is logged
 * (dispatch-refusals.jsonl next to dispatch.json) and sent to AmberX as an FYI (console alert pipeline:gate:<id>).
 *
 * The one switch: the owner-only Claude setting "Let builds start without the orchestrator" (builds.dispatchGateOverride,
 * default off; only Brett's signed-in console session can change it: REST PUT /api/claude-settings/settings, MCP
 * claude_settings_set, the claude-settings CLI, voice). While on, a refused launch still starts, and is logged and sent as
 * an FYI with "override". `status` reports the gate, the override and the latest refusals.
 *
 *   node framework/cli/dispatch-gate.mjs reentry [--build <id>] [--name <session>] [--brief <file>] [--json]   exit 0 ok · 3 refused
 *   node framework/cli/dispatch-gate.mjs status [--json]                         gate on, override, refusals (last 20)
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findBuild } from './model-gate.mjs';
import { loadStore } from './builds-store.mjs';
import { settingsFile } from './upgrade-policy.mjs';

export const SCHEMA = 'dispatch-tokens@1';
export const DISPATCH_TTL_MS = 24 * 3600e3;
export const OVERRIDE_SETTING = 'builds.dispatchGateOverride';
/** Statuses a build may start from: Queued, or Running/Waiting while its dispatch token is still unspent (the dispatcher's own launch). */
export const START_STATUSES = ['queued'];
const DISPATCHED_STATUSES = ['running', 'waiting'];
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export function dispatchDir(env = process.env) {
  if (env.AXF_DISPATCH_DIR) return env.AXF_DISPATCH_DIR;
  if (env.AXF_PIPELINE_DIR) return env.AXF_PIPELINE_DIR;
  const hub = join(env.AXHUB_PROJECTS_DIR || '/projects', 'amberx-axf', '_data');
  return existsSync(hub) ? join(hub, 'pipeline') : join(homedir(), '.axf', 'pipeline');
}
const fileOf = (env) => join(dispatchDir(env), 'dispatch.json');
const hash = (t) => createHash('sha256').update(String(t)).digest('hex');

function load(env) {
  try { const j = JSON.parse(readFileSync(fileOf(env), 'utf8')); return j && typeof j.tokens === 'object' && !Array.isArray(j.tokens) ? j : { $axf: SCHEMA, tokens: {} }; }
  catch { return { $axf: SCHEMA, tokens: {} }; }
}
function save(doc, env) {
  const f = fileOf(env); mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...doc, $axf: SCHEMA }, null, 1)}\n`, { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch { /* best effort */ }
  renameSync(tmp, f);
}
const prune = (doc, now) => { for (const [k, v] of Object.entries(doc.tokens)) if (!v || now - Date.parse(v.at || 0) > DISPATCH_TTL_MS * 2) delete doc.tokens[k]; return doc; };

/** The dispatcher's call: a fresh token for one build (replaces any earlier one for it). Returns the token (never stored). */
export function issue(build, { account = '', model = '', env = process.env, now = Date.now() } = {}) {
  if (!ID_RE.test(String(build))) throw Object.assign(new Error(`not a build id: ${build}`), { code: 2 });
  const token = `axd_${randomBytes(24).toString('hex')}`;
  const doc = prune(load(env), now);
  doc.tokens[build] = { hash: hash(token), account: String(account).slice(0, 40), model: String(model).slice(0, 20), at: new Date(now).toISOString(), used: '' };
  save(doc, env);
  return token;
}

/**
 * The build ID a launch names, whether or not the registry knows it: --build / AXF_BUILD_ID, a `# Build:` heading, the
 * "Continue build" line. A build-* session name alone is a build launch with no ID.
 */
export function claimedId({ build = '', brief = '' } = {}) {
  return String(build || '').trim()
    || (/^#\s*Build\s*:\s*([a-z0-9][a-z0-9._-]*)/im.exec(brief)?.[1] ?? '')
    || (/Continue build ".*?" \(([a-z0-9][a-z0-9._-]*)\)/.exec(brief)?.[1] ?? '');
}

/**
 * Pure: is this launch a build launch, and may it start? `b` = the orchestrator build it belongs to (or null),
 * `name` = the session name, `claimed` = the ID the launch names (claimedId), `rec` = the token record on file for that
 * build, `token` = what the launch carries, `override` = the owner-only override is on.
 */
export function verdict({ b = null, name = '', claimed = '', rec = null, token = '', now = Date.now(), override = false } = {}) {
  const v = rawVerdict({ b, name, claimed, rec, token, now });
  if (v.ok || !override) return v;
  return { ok: true, build: v.build, overridden: true, refusal: v.reason, why: `override on (${OVERRIDE_SETTING}): starting anyway; the gate said: ${v.why.replace(/^refused: /, '')}` };
}

function rawVerdict({ b, name, claimed, rec, token, now }) {
  const bare = String(name).replace(/^axf-/, '');
  const byName = /^build[-:]/.test(bare);
  if (!b && !byName && !claimed) return { ok: true, build: '', why: 'not a build: no dispatch needed' };
  const id = b?.id || claimed || bare.replace(/^build[-:]/, '');
  const how = b
    ? `Only the orchestrator starts builds. Queue it (Build orchestrator → Pending → Queue, or its pipeline-queue command: console API, MCP, or the orchestrator plugin CLI \`pipeline.mjs queue ${b.id}\`): the dispatcher starts it within a minute.`
    : 'Only the orchestrator starts builds. File it as an orchestrator build (its pipeline-request command: console API, MCP, or the orchestrator plugin CLI `pipeline.mjs request --title "…" --detail "…" --queue`): the dispatcher starts it within a minute.';
  const no = (reason, why) => ({ ok: false, build: id, reason, why: `refused: ${why} ${how}` });
  if (!b && !claimed) return no('no-id', `"${bare}" is a build launch outside the orchestrator: it has no orchestrator-issued ID.`);
  if (!b) return no('unknown-id', `"${id}" is a build launch outside the orchestrator: the ID is not in the orchestrator's registry.`);
  if (!token) return no('no-token', `${id} has no orchestrator dispatch token.`);
  if (!rec?.hash) return no('not-dispatched', `${id} was not dispatched by the orchestrator (no token on file).`);
  const a = Buffer.from(hash(token)); const c = Buffer.from(rec.hash);
  if (a.length !== c.length || !timingSafeEqual(a, c)) return no('wrong-token', `the dispatch token is not ${id}'s.`);
  if (rec.used) return no('token-used', `${id}'s dispatch token was already used (${rec.used}).`);
  if (now - Date.parse(rec.at || 0) > DISPATCH_TTL_MS) return no('token-expired', `${id}'s dispatch token expired.`);
  const st = String(b.status || '');
  if (!START_STATUSES.includes(st) && !DISPATCHED_STATUSES.includes(st)) return no('not-queued', `${id} is ${st || 'without a status'}, not Queued.`);
  return { ok: true, build: id, why: `${id}: dispatched by the orchestrator${rec.account ? ` on ${rec.account}` : ''}${rec.model ? ` (${rec.model})` : ''}` };
}

/**
 * Pure: the launcher's own re-entries (--queued slot waiter, --inner tmux run) come after `consume`. A build re-entry
 * needs the build in the registry, live (Queued / Running / Waiting) and its token spent by the dispatcher's launch.
 */
export function reentryVerdict({ b = null, name = '', claimed = '', rec = null, now = Date.now(), override = false } = {}) {
  const bare = String(name).replace(/^axf-/, '');
  const byName = /^build[-:]/.test(bare);
  let v;
  if (!b && !byName && !claimed) v = { ok: true, build: '', why: 'not a build: no dispatch needed' };
  else {
    const id = b?.id || claimed || bare.replace(/^build[-:]/, '');
    const no = (reason, why) => ({ ok: false, build: id, reason, why: `refused: ${why} Only the orchestrator starts builds: queue it and the dispatcher starts it.` });
    if (!b) v = no(claimed ? 'unknown-id' : 'no-id', `"${id}" re-enters the launcher without an orchestrator-issued ID.`);
    else if (!rec?.used) v = no('not-dispatched', `${id} re-enters the launcher but no dispatcher launch spent its token.`);
    else if (now - Date.parse(rec.used) > DISPATCH_TTL_MS * 2) v = no('token-expired', `${id}'s dispatch is too old to re-enter.`);
    else if (![...START_STATUSES, ...DISPATCHED_STATUSES].includes(String(b.status || ''))) v = no('not-queued', `${id} is ${b.status || 'without a status'}, not Queued or Running.`);
    else v = { ok: true, build: id, why: `${id}: re-entry of the dispatcher's launch` };
  }
  if (v.ok || !override) return v;
  return { ok: true, build: v.build, overridden: true, refusal: v.reason, why: `override on (${OVERRIDE_SETTING}): starting anyway; the gate said: ${v.why.replace(/^refused: /, '')}` };
}

/** The owner-only override (Claude settings, default off). AXF_DISPATCH_OVERRIDE=off forces it off; nothing in the environment turns it on. */
export function readOverride(env = process.env) {
  const f = settingsFile(env);
  if (String(env.AXF_DISPATCH_OVERRIDE ?? '').toLowerCase() === 'off') return { on: false, source: 'AXF_DISPATCH_OVERRIDE=off' };
  let v;
  try { if (existsSync(f)) v = JSON.parse(readFileSync(f, 'utf8'))?.values?.[OVERRIDE_SETTING]; } catch { v = undefined; }
  return v === true ? { on: true, source: `${OVERRIDE_SETTING} (${f})` } : { on: false, source: typeof v === 'boolean' ? `${OVERRIDE_SETTING} (${f})` : `${OVERRIDE_SETTING} default (off)` };
}

const refusalsFile = (env) => join(dispatchDir(env), 'dispatch-refusals.jsonl');
export function readRefusals(env = process.env, limit = 20) {
  let t = ''; try { t = readFileSync(refusalsFile(env), 'utf8'); } catch { return []; }
  return t.split('\n').filter(Boolean).slice(-limit).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).reverse();
}

/** A refusal (or an override start): one log line and an AmberX FYI (console alert). Never throws. */
export function record(v, { kind = 'launch', name = '', env = process.env, now = Date.now() } = {}) {
  if (v.ok && !v.overridden) return null;
  const row = { at: new Date(now).toISOString(), kind, build: v.build || '', name: String(name).slice(0, 80), reason: v.reason || v.refusal || '', overridden: !!v.overridden, why: String(v.why).slice(0, 600) };
  try { const f = refusalsFile(env); mkdirSync(dirname(f), { recursive: true }); appendFileSync(f, `${JSON.stringify(row)}\n`, { mode: 0o600 }); } catch { /* best effort */ }
  try { fyi(row, env); } catch { /* best effort */ }
  return row;
}

/** The AmberX FYI: a console alert (source pipeline, so it lands with the dispatcher's own). AXF_PIPELINE_CONSOLE=off: none. */
export function alertOf(row) {
  const id = row.build || row.name || 'unknown';
  return { source: 'pipeline', key: `pipeline:gate:${id}`, severity: row.overridden ? 'warning' : 'info', link: '#/build-orchestrator',
    title: row.overridden ? `Build started past the gate (override on): ${id}` : `Build launch refused: ${id}`,
    body: row.why, meta: { kind: 'gate', build: row.build, reason: row.reason, overridden: row.overridden } };
}
function fyi(row, env) {
  const name = env.AXF_PIPELINE_CONSOLE || 'axf-console';
  if (name === 'off' || env.AXF_DISPATCH_ALERTS === 'off') return;
  const cmd = `curl -s -m 20 -X POST -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:${env.AXF_CONSOLE_PORT || 7090}/api/alerts"`;
  const p = spawn('docker', ['exec', '-i', name, 'sh', '-c', cmd], { stdio: ['pipe', 'ignore', 'ignore'], detached: true });
  p.on('error', () => {}); p.stdin.on('error', () => {}); p.stdin.end(JSON.stringify(alertOf(row))); p.unref();
}

const storeOf = (store) => { if (store) return store; try { return loadStore(); } catch { return { builds: [] }; } };

/** The launcher's check. */
export function check({ build = '', name = '', brief = '', token = '', env = process.env, store = null, now = Date.now() } = {}) {
  const s = storeOf(store);
  const b = findBuild(s, { build, name, brief });
  const rec = b ? load(env).tokens[b.id] ?? null : null;
  return verdict({ b, name, claimed: claimedId({ build, name, brief }), rec, token, now, override: readOverride(env).on });
}

/** The launcher's re-entry check (--queued, --inner). */
export function reentry({ build = '', name = '', brief = '', env = process.env, store = null, now = Date.now() } = {}) {
  const s = storeOf(store);
  const b = findBuild(s, { build, name, brief });
  const rec = b ? load(env).tokens[b.id] ?? null : null;
  return reentryVerdict({ b, name, claimed: claimedId({ build, name, brief }), rec, now, override: readOverride(env).on });
}

/** The gate's state for the console, the CLI and voice. */
export function status(env = process.env) {
  const o = readOverride(env);
  const refusals = readRefusals(env);
  return { ok: true, gate: 'on', override: o.on, overrideSource: o.source, overrideSetting: OVERRIDE_SETTING, refusals, open: Object.values(load(env).tokens).filter((t) => t && !t.used).length,
    line: o.on ? `Build gate: OVERRIDE ON: builds may start without the orchestrator (${OVERRIDE_SETTING}).` : `Build gate: on: only orchestrator-issued, Queued builds start. ${refusals.length ? `${refusals.length} recent refusal${refusals.length === 1 ? '' : 's'}.` : 'No refusals.'}` };
}

/** The session really starts: the token is spent. */
export function consume(opts = {}) {
  const env = opts.env ?? process.env;
  const v = check(opts);
  if (!v.ok || !v.build) return v;
  const doc = load(env);
  if (doc.tokens[v.build]) { doc.tokens[v.build].used = new Date(opts.now ?? Date.now()).toISOString(); save(doc, env); }
  return { ...v, consumed: true };
}

async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] ?? '' : ''; };
  const [cmd, first] = args;
  const briefFile = opt('brief');
  const brief = briefFile && existsSync(briefFile) ? readFileSync(briefFile, 'utf8').slice(0, 64 * 1024) : '';
  const common = { build: opt('build') || process.env.AXF_BUILD_ID || '', name: opt('name'), brief, token: process.env.AXF_DISPATCH_TOKEN || '' };
  if (cmd === 'check' || cmd === 'consume' || cmd === 'reentry') {
    // a re-entry runs inside tmux, whose server environment can hold another build's AXF_BUILD_ID: name + brief only
    const r = cmd === 'check' ? check(common) : cmd === 'consume' ? consume(common) : reentry({ ...common, build: opt('build') });
    if (cmd !== 'consume') record(r, { kind: cmd === 'reentry' ? 'reentry' : 'launch', name: common.name || common.build });
    console.log(json ? JSON.stringify(r) : `${r.ok ? 'ok' : 'refused'}: ${r.why.replace(/^refused: /, '')}`);
    if (!r.ok) process.exitCode = 3;
    return;
  }
  if (cmd === 'status') { const st = status(); console.log(json ? JSON.stringify(st) : [st.line, ...st.refusals.slice(0, 5).map((r) => `  ${r.at} ${r.overridden ? 'override' : 'refused'} ${r.build || r.name} (${r.reason})`)].join('\n')); return; }
  if (cmd === 'issue') { console.log(issue(first, { account: opt('account'), model: opt('model') })); return; }
  if (cmd === 'list') {
    const rows = Object.entries(load(process.env).tokens).map(([b, v]) => ({ build: b, account: v.account, model: v.model, at: v.at, used: v.used }));
    console.log(json ? JSON.stringify({ ok: true, tokens: rows }) : rows.map((r) => `${r.build} ${r.account} ${r.model} ${r.at}${r.used ? ` used ${r.used}` : ' open'}`).join('\n') || 'no dispatch tokens');
    return;
  }
  console.error('usage: dispatch-gate.mjs check|consume|reentry [--build id] [--name n] [--brief f] | issue <build> --account a --model m | list | status'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`dispatch-gate: ${e.message}`); process.exitCode = e.code === 2 ? 2 : 1; });
}
