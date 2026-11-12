#!/usr/bin/env node
/**
 * retry-runner: the Node IO side of retry-ladder@1 (framework/core/retry-ladder.mjs). Failed calls are retried
 * different ways (a ladder of fixes per failure kind, each once) and every attempt lands in the ledger the Auto-fixes
 * view reads. Python twin: framework/python/axf_server/retry.py (same ledger folder, same records).
 *
 *   node framework/cli/retry-runner.mjs [list] [--json]          open and recent jobs (count, what each is trying now)
 *   … show <id> [--json]                                          one job with every attempt
 *   … dismiss <id>                                                hide a job that gave up (it stays on disk)
 *   … run --title "<what>" [--detach] [--timeout <s>] -- <cmd…>   run a command through the ladder; --detach returns at
 *                                                                 once and the retry carries on without the caller
 *
 * Ledger: <dir>/jobs/<id>.json, one file per job (writers never share a file). <dir> = AXF_RETRY_DIR, else the
 * project's shared data folder /auto-fixes (persistRoot), else <repo>/.axf-console/auto-fixes.
 *
 * In code:  runWithFixes({ title, source, call: async (ctx) => …, ok?: (r) => err|null, fixes: { <fixId>: async (ctx, job) => … } })
 *           runWithFixesSync(… the same with sync functions; delays block)   — for sync code such as the builds store
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import * as ladder from '../core/retry-ladder.mjs';
import { REPO_ROOT, persistRoot } from './persist.mjs';

export function ledgerDir() {
  if (process.env.AXF_RETRY_DIR) return process.env.AXF_RETRY_DIR;
  const root = persistRoot();
  return root ? join(root, 'auto-fixes') : join(REPO_ROOT, '.axf-console', 'auto-fixes');
}
const jobFile = (id) => join(ledgerDir(), 'jobs', `${id}.json`);
const ID = /^[a-z0-9-]{4,80}$/;
const iso = () => new Date().toISOString();
const newId = () => `${iso().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${randomBytes(3).toString('hex')}`;

export function saveJob(job) {
  const f = jobFile(job.id); mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(job), { mode: 0o600 }); renameSync(tmp, f);
}
export function readJob(id) {
  if (!ID.test(String(id))) return null;
  try { const j = JSON.parse(readFileSync(jobFile(id), 'utf8')); return j?.$axf === ladder.FORMAT ? j : null; } catch { return null; }
}
export function listJobs() {
  let names = []; try { names = readdirSync(join(ledgerDir(), 'jobs')).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => readJob(n.slice(0, -5))).filter(Boolean);
}
export function dismissJob(id) { const j = readJob(id); if (!j) return false; saveJob({ ...j, status: 'dismissed', updatedAt: iso() }); return true; }

const sleepSync = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scale = () => { const v = Number(process.env.AXF_RETRY_DELAY_SCALE); return Number.isFinite(v) && v >= 0 ? v : 1; };

/** The built-in fixes every runner has: waits, and the longer timeout. Anything else needs a handler from the caller. */
function builtin(fix, ctx) {
  if (fix === 'wait' || fix === 'retry' || fix === 'backoff') return true;
  if (fix === 'longer-timeout') { ctx.timeoutMs = (Number(ctx.timeoutMs) || 30000) * 3; return true; }
  return false;
}

function settle(job, fix, ctx, ran) {
  // ran: undefined (no handler), true, or an Error
  if (ran === undefined) return builtin(fix, ctx) ? job : ladder.fixUnavailable(job, fix, 'no automatic fix for this here', iso());
  if (ran instanceof Error) return ladder.fixUnavailable(job, fix, String(ran.message || ran).slice(0, 200), iso());
  return job;
}

export async function runWithFixes({ title, source = '', call, ok, fixes = {}, ctx = {}, id = newId(), onChange }) {
  let job = ladder.newJob({ id, title, source, now: iso() }); let result;
  const save = (j) => { saveJob(j); try { onChange?.(j); } catch { /* never stops a retry */ } };
  for (;;) {
    let err = null;
    try { result = await call(ctx); err = ok ? ok(result) : null; } catch (e) { err = e; result = undefined; }
    if (!err) { if (job.attempts.length) { job = ladder.onSuccess(job, iso()); save(job); } return { job, result }; }
    const r = ladder.onFailure(job, toErr(err), iso()); job = r.job;
    if (!r.next) { if (job.attempts.length || job.status === 'gave-up') save(job); return { job, result, error: err }; }
    save(job);
    await sleep((r.next.delayMs ?? 0) * scale());
    let ran; const h = fixes[r.next.fix];
    if (h) { try { await h(ctx, job); ran = true; } catch (e) { ran = e instanceof Error ? e : new Error(String(e)); } }
    const after = settle(job, r.next.fix, ctx, ran); if (after !== job) { job = after; save(job); }
  }
}

export function runWithFixesSync({ title, source = '', call, ok, fixes = {}, ctx = {}, id = newId(), onChange }) {
  let job = ladder.newJob({ id, title, source, now: iso() }); let result;
  const save = (j) => { try { saveJob(j); onChange?.(j); } catch { /* the ledger never stops a retry */ } };
  for (;;) {
    let err = null;
    try { result = call(ctx); err = ok ? ok(result) : null; } catch (e) { err = e; result = undefined; }
    if (!err) { if (job.attempts.length) { job = ladder.onSuccess(job, iso()); save(job); } return { job, result }; }
    const r = ladder.onFailure(job, toErr(err), iso()); job = r.job;
    if (!r.next) { if (job.attempts.length || job.status === 'gave-up') save(job); return { job, result, error: err }; }
    save(job);
    sleepSync((r.next.delayMs ?? 0) * scale());
    let ran; const h = fixes[r.next.fix];
    if (h) { try { h(ctx, job); ran = true; } catch (e) { ran = e instanceof Error ? e : new Error(String(e)); } }
    const after = settle(job, r.next.fix, ctx, ran); if (after !== job) { job = after; save(job); }
  }
}

/** An Error (or anything thrown) as { code, status, message } for classify(). */
export function toErr(e) {
  if (e && typeof e === 'object' && !(e instanceof Error)) return e;
  if (e instanceof Error) return { code: e.code ?? e.name, status: e.status ?? 0, message: e.message };
  return { message: String(e) };
}

// ------------------------------------------------------------------ CLI
async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const cmd = args[0] ?? 'list';
  const out = (v, text) => console.log(json ? JSON.stringify(v, null, 1) : text);
  if (cmd === 'list') {
    const v = ladder.view(listJobs());
    return out(v, [`Auto-fixes: ${v.count} open (${v.retrying} retrying, ${v.gaveUp} gave up) · ${ledgerDir()}`, ...v.rows.map((r) => `  ${r.status.padEnd(9)} ${r.id}  ${r.title}: ${r.now} · ${r.attempts} attempt(s)${r.missing.length ? ` · missing: ${r.missing.join('; ')}` : ''}`)].join('\n'));
  }
  if (cmd === 'show') {
    const j = readJob(args[1]); if (!j) { console.error(`no job ${args[1]}`); process.exit(1); }
    return out(j, [`${j.title} [${j.status}] ${ladder.stepText(j)}`, ...j.attempts.map((a) => `  ${a.n}. ${a.at} ${ladder.logLine(j, a)}${a.ok ? ' → worked' : ''}`), j.fyi ? `FYI: ${j.fyi}` : ''].filter(Boolean).join('\n'));
  }
  if (cmd === 'dismiss') { const ok = dismissJob(args[1]); out({ ok }, ok ? `dismissed ${args[1]}` : `no job ${args[1]}`); return process.exit(ok ? 0 : 1); }
  if (cmd === 'run') {
    const sep = args.indexOf('--'); if (sep < 0 || sep === args.length - 1) { console.error('usage: run --title "<what>" [--detach] [--timeout <s>] -- <cmd…>'); process.exit(2); }
    const opt = (k) => { const i = args.indexOf(k); return i >= 0 && i < sep ? args[i + 1] : undefined; };
    const cmdv = args.slice(sep + 1); const title = opt('--title') || cmdv.join(' ').slice(0, 80);
    if (args.slice(0, sep).includes('--detach')) {
      const id = newId(); const rest = args.filter((a) => a !== '--detach');
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...rest.slice(0, sep - 1), '--id', id, ...rest.slice(sep - 1)], { detached: true, stdio: 'ignore', env: process.env });
      child.unref(); return out({ ok: true, id, detached: true }, `retrying in the background: ${id} (retry-runner show ${id})`);
    }
    const { job } = await runWithFixes({
      id: opt('--id') || newId(), title, source: 'cli', ctx: { timeoutMs: (Number(opt('--timeout')) || 600) * 1000 },
      call: (ctx) => { const p = spawnSync(cmdv[0], cmdv.slice(1), { stdio: ['ignore', 'inherit', 'pipe'], timeout: ctx.timeoutMs, encoding: 'utf8' }); if (p.error?.code === 'ETIMEDOUT' || p.signal === 'SIGTERM') throw Object.assign(new Error(`timed out after ${ctx.timeoutMs} ms`), { code: 'timeout' }); if (p.status !== 0) throw new Error((p.stderr || `exit ${p.status}`).trim().slice(-300)); return p.status; },
    });
    out(job, `${title}: ${ladder.stepText(job)}${job.fyi ? `\n${job.fyi}` : ''}`); return process.exit(job.status === 'fixed' || job.status === 'retrying' ? 0 : 1);
  }
  console.error('usage: retry-runner.mjs [list|show <id>|dismiss <id>|run … -- <cmd…>] [--json]'); process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
