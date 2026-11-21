/**
 * Host worker: agent-swarm job runner (host-service agent-swarm). Agent jobs (CI-fix jobs, scheduled and event jobs,
 * Breakroom Run) launch headless Claude sessions through deploy/claude-headless.sh and the agent-slots cap, as root,
 * from the checkout; that now happens here, so a job keeps running and scheduled jobs keep firing while the console is
 * down. The console keeps the UI and sends jobs over the socket (POST /v1/services/agent-swarm/actions/run-job).
 *
 * Each pass: `jobs.mjs due --run` (scheduled job types) and `jobs.mjs sweep` (finished runs onto the agents).
 * A run request has free inputs, which a sudo line can't carry, so the worker writes it to a spool folder in its data
 * dir and asks root to drain it (`axf-task jobs-drain`); the drain is this same file run by root with `--drain <dir>`:
 * it re-validates every request and calls jobs.mjs with an argument list (no shell). Shadow mode: report only.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const SELF = fileURLToPath(import.meta.url);
const ROOT = resolve(SELF, '../../../..');
const JOBS = join(ROOT, 'apps/console-web/plugins/agent-swarm/jobs.mjs'); // axf-plugin:agent-swarm
const ID = /^[A-Za-z0-9._-]{1,80}$/;
const INPUT_KEY = /^[a-z][a-zA-Z0-9]{0,29}$/;

/** A request as the console and the CLI send it, checked the same way the console route checks it. */
export function checkRequest(r) {
  if (!r || typeof r !== 'object') throw new Error('request must be an object');
  if (!['run', 'hire', 'event'].includes(r.op)) throw new Error(`unknown op ${r.op}`);
  if (typeof r.jobType !== 'string' || !ID.test(r.jobType)) throw new Error('a jobType is needed');
  const inputs = r.inputs || {};
  if (typeof inputs !== 'object' || Array.isArray(inputs) || Object.keys(inputs).length > 12) throw new Error('inputs must be an object (≤ 12)');
  for (const [k, v] of Object.entries(inputs)) if (!INPUT_KEY.test(k) || typeof v !== 'string' || v.length > 2000) throw new Error(`bad input ${k}`);
  if (r.agent !== undefined && r.agent !== '' && (typeof r.agent !== 'string' || !ID.test(r.agent))) throw new Error('bad agent');
  return { op: r.op, jobType: r.jobType, inputs, agent: r.agent || '', dry: r.dry === true };
}
export function argsFor(r) {
  const c = checkRequest(r);
  if (c.op === 'hire') return ['hire', c.jobType, '--json'];
  const a = c.op === 'event' ? ['event', c.jobType, '--run'] : ['run', c.jobType];
  for (const [k, v] of Object.entries(c.inputs)) a.push('--input', `${k}=${v}`);
  if (c.agent) a.push('--agent', c.agent);
  if (c.dry) a.push('--dry-run');
  a.push('--json');
  return a;
}

const task = (ctx, name, timeoutMs = 300000) => ctx.sudo([`${ctx.root}/deploy/host-services/bin/axf-task`, name], { timeoutMs });
const lastJson = (s) => { const l = String(s || '').trim().split('\n').filter(Boolean); for (let i = l.length - 1; i >= 0; i -= 1) { try { return JSON.parse(l[i]); } catch { /* not json */ } } return null; };
const spool = (ctx) => join(ctx.dataDir, 'requests');

async function submit(ctx, req) {
  const c = checkRequest(req);
  if (ctx.dryRun) return { dryRun: true, args: argsFor(c) };
  const dir = spool(ctx);
  mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  // axf-data: not data (a request spool: axf-host writes it, the root task reads and deletes it seconds later)
  writeFileSync(join(dir, `${id}.json.tmp`), JSON.stringify({ id, at: new Date().toISOString(), by: req.by || '', ...c }));
  renameSync(join(dir, `${id}.json.tmp`), join(dir, `${id}.json`));
  const r = await task(ctx, 'jobs-drain');
  const out = lastJson(r.stdout) || {};
  const mine = (out.results || []).find((x) => x.id === id);
  if (!r.ok && !mine) throw new Error(`jobs drain failed: ${(r.stderr || r.error).trim().slice(-300)}`);
  return mine ? mine.result : { ok: false, error: 'the request was not drained' };
}

export const intervalSec = 60;

export async function tick(ctx) {
  const effects = ['due', 'sweep'];
  if (ctx.dryRun) return { result: 'ok', message: 'would launch due jobs and sweep finished runs', effects };
  const due = await task(ctx, 'jobs-due');
  const sweep = await task(ctx, 'jobs-sweep');
  const d = lastJson(due.stdout);
  if (!due.ok || !sweep.ok) return { result: 'error', message: `${due.ok ? '' : `due: ${due.stderr.trim().slice(-200)} `}${sweep.ok ? '' : `sweep: ${sweep.stderr.trim().slice(-200)}`}`.trim(), effects };
  const n = Array.isArray(d?.launched) ? d.launched.length : Array.isArray(d?.due) ? d.due.length : 0;
  return { result: 'ok', message: `${n} due job(s) handled, runs swept`, effects };
}

export const actions = {
  'run-job': (a, ctx) => submit(ctx, { op: 'run', jobType: a.jobType, inputs: a.inputs ? JSON.parse(a.inputs) : {}, agent: a.agent, dry: a.dry, by: 'host-api' }),
  hire: (a, ctx) => submit(ctx, { op: 'hire', jobType: a.jobType }),
  event: (a, ctx) => submit(ctx, { op: 'event', jobType: a.name, inputs: a.inputs ? JSON.parse(a.inputs) : {} }),
  list: async (_a, ctx) => lastJson((await task(ctx, 'jobs-list', 90000)).stdout),
  sweep: async (_a, ctx) => (ctx.dryRun ? { dryRun: true } : lastJson((await task(ctx, 'jobs-sweep')).stdout)),
};

/** Root side (`axf-task jobs-drain`): run every spooled request once, oldest first, and print { results }. */
function drain(dir) {
  const results = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch { /* nothing spooled */ }
  for (const f of files.slice(0, 20)) {
    const p = join(dir, f);
    let req;
    try { req = JSON.parse(readFileSync(p, 'utf8')); } catch { rmSync(p, { force: true }); continue; }
    rmSync(p, { force: true });
    try {
      const out = execFileSync(process.execPath, [JOBS, ...argsFor(req)], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      results.push({ id: req.id, result: lastJson(out) ?? { ok: true, output: out.trim().slice(-600) } });
    } catch (e) { results.push({ id: req.id, result: { ok: false, error: String(e.stderr || e.message).trim().slice(-600) } }); }
  }
  console.log(JSON.stringify({ ok: true, results }));
}

if (process.argv[1] && resolve(process.argv[1]) === SELF && process.argv[2] === '--drain') drain(resolve(process.argv[3] || '.'));
