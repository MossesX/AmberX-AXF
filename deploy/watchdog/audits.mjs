#!/usr/bin/env node
/**
 * Pipeline 2.0 watchdog, the store audits (pipeline-watchdog@2). Brett, Nov 19 2026: `builds-store.mjs verify`, the
 * model-gate audit and the build-origin check used to run as build rules (one-builds-store, model-upgrade-approval,
 * fable-auto-upgrade, build-origin-verbatim) before every dispatch, in each build's worktree, fired by the old pipeline
 * tick through the gate's build-rules-runner. With old builds piling up they ran over and over from stale worktrees and
 * hogged the box. Now they run here, and only here:
 *
 *   - every 30 minutes (cron axf-watchdog-audits), under one flock: ONE audit at a time, one after the other
 *   - low priority: nice 19 + ionice idle, each with a timeout
 *   - never in heavy build slots: skipped while an agent-slots heavy step holds the lock or the load is high,
 *     re-checked before each audit (the next round tries again)
 *   - never from an old worktree: only from the console's main checkout (not a linked worktree, on main)
 *
 * The rules keep their place in Build rules; their `check` becomes `watchdog:<audit>` (a checker id, so the
 * build-rules-runner skips it: "runs in its own place"). `handoff` makes that edit on the live rules store once.
 *
 *   node deploy/watchdog/audits.mjs run [--force] [--json]   one round (the cron line); --force ignores load / heavy
 *   node deploy/watchdog/audits.mjs status [--json]          the last result of each audit
 *   node deploy/watchdog/audits.mjs handoff [--json]         point the four build rules' checks at the watchdog
 * State: <watchdog dir>/audits.json; every run a line in actions.jsonl (by: watchdog).
 */
import { statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO, files, logAction, readJson, sendAlert, writeJson } from './layer2.mjs';

const SELF = fileURLToPath(import.meta.url);

export const AUDITS = Object.freeze([
  { id: 'verify', cmd: ['node', 'framework/cli/builds-store.mjs', 'verify'], rules: ['one-builds-store'] },
  { id: 'model-gate', cmd: ['node', 'framework/cli/model-gate.mjs', 'audit'], rules: ['model-upgrade-approval', 'fable-auto-upgrade'] },
  { id: 'build-origin', cmd: ['node', 'framework/cli/build-origin.mjs', 'missing'], rules: ['build-origin-verbatim'] },
]);
export const checkerOf = (id) => `watchdog:${id}`;
export const TIMEOUT_MS = 10 * 60_000;
/** Load per core above which the box is busy building: audits wait for the next round. */
export const LOAD_PER_CORE = 0.7;

const stateFile = (env) => join(files(env).dir, 'audits.json');

/** Only the main checkout: a linked worktree has a `.git` file; the branch must be main. */
export function mainCheckout(dir = REPO) {
  try { if (!statSync(join(dir, '.git')).isDirectory()) return { ok: false, why: `${dir} is a linked worktree` }; } catch { return { ok: false, why: `${dir} is not a git checkout` }; }
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8', timeout: 15000 });
  const branch = String(r.stdout || '').trim();
  return branch === 'main' ? { ok: true } : { ok: false, why: `${dir} is on ${branch || 'no branch'}, not main` };
}

/** Busy = a heavy step holds the agent-slots lock, or the load is over LOAD_PER_CORE per core. */
export function busy(env = process.env) {
  if (env.AXF_WATCHDOG2_BUSY != null) return env.AXF_WATCHDOG2_BUSY ? { busy: true, why: env.AXF_WATCHDOG2_BUSY } : { busy: false };
  const r = spawnSync('node', ['framework/cli/agent-slots.mjs', 'status', '--json'], { cwd: REPO, encoding: 'utf8', timeout: 30000 });
  try { const s = JSON.parse(r.stdout); if ((s.heavy?.used ?? 0) > 0) return { busy: true, why: `${s.heavy.used} heavy step(s) running` }; } catch { /* no slots state: load decides */ }
  const per = loadavg()[0] / Math.max(1, cpus().length);
  return per > LOAD_PER_CORE ? { busy: true, why: `load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores` } : { busy: false };
}

function runOne(a, env) {
  const started = Date.now();
  const has = (c) => spawnSync('sh', ['-c', `command -v ${c}`], { encoding: 'utf8' }).status === 0;
  const prefix = [...(has('ionice') ? ['ionice', '-c3'] : []), ...(has('nice') ? ['nice', '-n', '19'] : [])];
  const argv = env.AXF_WATCHDOG2_AUDIT_CMD ? ['sh', '-c', env.AXF_WATCHDOG2_AUDIT_CMD.replaceAll('{id}', a.id)] : [...prefix, ...a.cmd];
  const r = spawnSync(argv[0], argv.slice(1), { cwd: REPO, env: { ...env, AXF_ACTOR: 'watchdog', AXF_BUILDS_LIVE: '0' }, encoding: 'utf8', timeout: TIMEOUT_MS });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { id: a.id, ok: r.status === 0, code: r.status ?? (r.error ? -1 : null), at: new Date().toISOString(), ms: Date.now() - started, tail: out.slice(-800) };
}

/** One round: each audit in turn, the box checked before each one. */
export function runRound({ env = process.env, force = false } = {}) {
  const state = readJson(stateFile(env), { $axf: 'watchdog-audits@1', audits: {} }) ?? { audits: {} };
  const home = env.AXF_WATCHDOG2_ANY_CHECKOUT === '1' ? { ok: true } : mainCheckout();
  const result = { at: new Date().toISOString(), ran: [], skipped: [] };
  if (!home.ok) { result.skipped.push({ id: '*', why: home.why }); logAction(env, { action: 'audits-skip', note: `Watchdog: audits not run: ${home.why} (main checkout only)` }); writeJson(stateFile(env), { ...state, last: result }); return result; }
  for (const a of AUDITS) {
    const b = force ? { busy: false } : busy(env);
    if (b.busy) { result.skipped.push({ id: a.id, why: b.why }); continue; }
    const r = runOne(a, env);
    const prev = state.audits[a.id];
    state.audits[a.id] = r;
    result.ran.push(r);
    logAction(env, { action: 'audit', audit: a.id, ok: r.ok, note: `Watchdog: audit ${a.id} ${r.ok ? 'passed' : `failed (exit ${r.code})`} in ${Math.round(r.ms / 1000)} s.` });
    // a new failure (or a different one) is one FYI; the same failure again is not
    if (!r.ok && (!prev || prev.ok || prev.tail !== r.tail)) sendAlert({ source: 'watchdog', key: `watchdog:audit:${a.id}`, severity: 'warning', title: `Watchdog audit ${a.id} failed`, body: `${a.cmd.join(' ')} exited ${r.code}.\n${r.tail.slice(-600)}`, link: 'build-orchestrator.focus:watchdog', meta: { audit: a.id } }, env);
  }
  if (result.skipped.length) logAction(env, { action: 'audits-skip', note: `Watchdog: audit(s) ${result.skipped.map((s) => s.id).join(', ')} waited for the next round: ${result.skipped[0].why}.` });
  writeJson(stateFile(env), { ...state, last: result });
  return result;
}

export const status = (env = process.env) => readJson(stateFile(env), { audits: {} }) ?? { audits: {} };

// the gate's build rules API; the marked line goes with the gate plugin (then handoff has nothing to point)
let gateRulesApi = '';
gateRulesApi = '../../apps/console-web/plugins/gate/build-rules-api.mjs'; // axf-plugin:gate

/** Point the build rules at the watchdog in the live rules store (idempotent; each edit has its reason). */
export async function handoff({ env = process.env } = {}) {
  if (!gateRulesApi) return [{ id: 'build-rules', ok: true, already: true, why: 'no gate plugin here: nothing to point' }];
  const { createBuildRulesOps } = await import(gateRulesApi);
  const ops = createBuildRulesOps({});
  const done = [];
  for (const a of AUDITS) for (const id of a.rules) {
    const cur = ops.build_rules_get({ id });
    const rule = cur?.rule ?? cur?.item ?? cur;
    if (!cur?.ok) { done.push({ id, ok: false, why: cur?.message || 'not found' }); continue; }
    if (rule?.check === checkerOf(a.id)) { done.push({ id, ok: true, already: true }); continue; }
    const r = ops.build_rules_edit({ id, check: checkerOf(a.id), by: 'watchdog', reason: { title: `Build rule ${id}: check moves to the watchdog`, description: `${a.cmd.join(' ')} now runs in the Pipeline 2.0 watchdog every 30 minutes (one at a time, low priority, main checkout only), not before every dispatch in build worktrees.` } });
    done.push({ id, ok: !!r?.ok, why: r?.ok ? '' : r?.message || 'edit failed' });
    if (r?.ok) logAction(env, { action: 'rule-handoff', rule: id, note: `Watchdog: build rule ${id} check is now ${checkerOf(a.id)} (runs in the watchdog's 30-minute audits).` });
  }
  return done;
}

async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0] || 'status'; const json = argv.includes('--json');
  const out = (v, t) => console.log(json ? JSON.stringify(v, null, 1) : t);
  if (cmd === 'run') { const r = runRound({ force: argv.includes('--force') }); return out(r, `${r.at} ran ${r.ran.map((x) => `${x.id}:${x.ok ? 'ok' : `exit ${x.code}`}`).join(' ') || 'none'}${r.skipped.length ? ` · skipped ${r.skipped.map((s) => s.id).join(',')} (${r.skipped[0].why})` : ''}`); }
  if (cmd === 'status') { const s = status(); return out(s, AUDITS.map((a) => { const r = s.audits?.[a.id]; return `${a.id}: ${r ? `${r.ok ? 'ok' : `failed exit ${r.code}`} at ${r.at}` : 'never run'}`; }).join('\n')); }
  if (cmd === 'handoff') { const r = await handoff(); if (r.some((x) => !x.ok)) process.exitCode = 1; return out(r, r.map((x) => `${x.id}: ${x.ok ? (x.already ? 'already the watchdog' : 'moved to the watchdog') : `not moved: ${x.why}`}`).join('\n')); }
  console.error('usage: audits.mjs run [--force]|status|handoff [--json]'); process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) main().catch((e) => { console.error(`watchdog audits: ${e.message || e}`); process.exitCode = 1; });
