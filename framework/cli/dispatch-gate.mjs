#!/usr/bin/env node
/**
 * dispatch-gate — one way to start a build: the orchestrator (Brett, Nov 9 2026: "We need to make sure there's only one
 * way to start builds. It can't be two. It needs to be one. It has to be the orchestrator. The orchestrator has to take
 * the build from the queue and then start them. Not the build manager.").
 *
 * The orchestrator's dispatcher (apps/console-web/plugins/build-orchestrator/pipeline.mjs tick) issues a one-build
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
 * The file holds only a hash of each token. There is no switch to turn this off.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBuild } from './model-gate.mjs';
import { loadStore } from './builds-store.mjs';

export const SCHEMA = 'dispatch-tokens@1';
export const DISPATCH_TTL_MS = 24 * 3600e3;
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
 * Pure: is this launch a build launch, and may it start? `b` = the orchestrator build it belongs to (or null),
 * `name` = the session name, `rec` = the token record on file for that build, `token` = what the launch carries.
 */
export function verdict({ b = null, name = '', rec = null, token = '', now = Date.now() } = {}) {
  const bare = String(name).replace(/^axf-/, '');
  const byName = /^build[-:]/.test(bare);
  if (!b && !byName) return { ok: true, build: '', why: 'not a build: no dispatch needed' };
  const id = b?.id || bare.replace(/^build[-:]/, '');
  const how = b
    ? `Only the orchestrator starts builds. Queue it (Build orchestrator → Pipeline → Queue, Build manager → Send to queue, or \`node apps/console-web/plugins/build-orchestrator/pipeline.mjs queue ${b.id}\`): the dispatcher starts it within a minute.`
    : 'Only the orchestrator starts builds. File it as an orchestrator build (`node apps/console-web/plugins/build-orchestrator/pipeline.mjs request --title "…" --detail "…" --queue`): the dispatcher starts it within a minute.';
  if (!b) return { ok: false, build: id, why: `refused: "${bare}" is a build launch outside the orchestrator. ${how}` };
  if (!token) return { ok: false, build: id, why: `refused: ${id} has no orchestrator dispatch token. ${how}` };
  if (!rec?.hash) return { ok: false, build: id, why: `refused: ${id} was not dispatched by the orchestrator (no token on file). ${how}` };
  const a = Buffer.from(hash(token)); const c = Buffer.from(rec.hash);
  if (a.length !== c.length || !timingSafeEqual(a, c)) return { ok: false, build: id, why: `refused: the dispatch token is not ${id}'s. ${how}` };
  if (rec.used) return { ok: false, build: id, why: `refused: ${id}'s dispatch token was already used (${rec.used}). ${how}` };
  if (now - Date.parse(rec.at || 0) > DISPATCH_TTL_MS) return { ok: false, build: id, why: `refused: ${id}'s dispatch token expired. ${how}` };
  return { ok: true, build: id, why: `${id}: dispatched by the orchestrator${rec.account ? ` on ${rec.account}` : ''}${rec.model ? ` (${rec.model})` : ''}` };
}

/** The launcher's check. */
export function check({ build = '', name = '', brief = '', token = '', env = process.env, store = null, now = Date.now() } = {}) {
  let s = store; if (!s) { try { s = loadStore(); } catch { s = { builds: [] }; } }
  const b = findBuild(s, { build, name, brief });
  const rec = b ? load(env).tokens[b.id] ?? null : null;
  return verdict({ b, name, rec, token, now });
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
  if (cmd === 'check' || cmd === 'consume') {
    const r = cmd === 'check' ? check(common) : consume(common);
    console.log(json ? JSON.stringify(r) : `${r.ok ? 'ok' : 'refused'}: ${r.why.replace(/^refused: /, '')}`);
    if (!r.ok) process.exitCode = 3;
    return;
  }
  if (cmd === 'issue') { console.log(issue(first, { account: opt('account'), model: opt('model') })); return; }
  if (cmd === 'list') {
    const rows = Object.entries(load(process.env).tokens).map(([b, v]) => ({ build: b, account: v.account, model: v.model, at: v.at, used: v.used }));
    console.log(json ? JSON.stringify({ ok: true, tokens: rows }) : rows.map((r) => `${r.build} ${r.account} ${r.model} ${r.at}${r.used ? ` used ${r.used}` : ' open'}`).join('\n') || 'no dispatch tokens');
    return;
  }
  console.error('usage: dispatch-gate.mjs check|consume [--build id] [--name n] [--brief f] | issue <build> --account a --model m | list'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(`dispatch-gate: ${e.message}`); process.exitCode = e.code === 2 ? 2 : 1; });
}
