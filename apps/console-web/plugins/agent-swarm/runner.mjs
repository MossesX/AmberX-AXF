#!/usr/bin/env node
/**
 * Headless runner: one `claude -p` per job, in its own git worktree, with the job's model, max turns, allowed tools
 * and token budget. Usage is followed live from stream-json; the run is killed when it goes over budget or over its
 * time limit. Returns a swarm-run@1 record with the agent's swarm-report@1.
 *
 * The Claude Code binary is AXF_CLAUDE_BIN, else `claude` on PATH.
 * Own login (build-own-login, Nov 5 2026): each run gets its own copy of the active Claude login
 * (deploy/claude-login.mjs, CLAUDE_CONFIG_DIR in <worktree>/.axf-claude/<run>), deleted when the run ends, so logging
 * the VPS out or switching accounts never touches a running job. AXF_OWN_LOGIN=off (or opts.ownLogin false) skips it.
 * Hard build limit (build-limit@1, Nov 12 2026): a real run waits at framework/cli/build-limit.mjs (`admit --mode run`)
 * until the VPS has a place, then starts `claude -p` in axf-builds.slice (systemd-run --scope) where the host has it.
 */
import { spawn as nodeSpawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import * as core from './web/swarm-core.mjs';

// The per-build login copy (deploy/claude-login.mjs). Missing (a checkout without deploy/) = the shared login, as before.
const loginMod = await import(new URL('../../../../deploy/claude-login.mjs', import.meta.url).href).catch(() => null);
/** Snapshot the login for one run: { env, release, who } or null (off, unavailable or no login to copy). */
export function ownLogin(dir, session, opts = {}) {
  if (!loginMod || !dir || opts.ownLogin === false || process.env.AXF_OWN_LOGIN === 'off') return null;
  try {
    const snap = loginMod.snapshot({ dir, session, account: opts.account || process.env.AXF_CLAUDE_ACCOUNT || 'active' });
    loginMod.watchCopy?.(snap.dir);   // a rotated token is saved back while the run works
    return { env: loginMod.childEnv(snap), who: loginMod.describe(snap), release: () => { try { loginMod.release({ dir, session }); } catch { /* gone */ } } };
  } catch (e) { process.stderr.write(`claude-login: ${e.message}; using the shared login\n`); return null; }
}

// The VPS's hard build limit and the builds slice. Missing (a checkout without it) = no gate, as before.
const limitMod = await import(new URL('../../../../framework/cli/build-limit.mjs', import.meta.url).href).catch(() => null);
/** Waits for a place under the hard limit: { ok } or { ok: false, why } after `waitMin` (default a day). */
export async function hardGate(job, opts = {}) {
  if (!limitMod || process.env.AXF_BUILD_LIMIT === 'off') return { ok: true };
  try {
    const r = await limitMod.admitWait({ mode: 'run', session: `swarm-${job.id}`, name: `swarm-${job.id}`, pid: process.pid, cwd: opts.cwd ?? process.cwd() },
      { pollMs: opts.gatePollMs ?? 10_000, timeoutMs: (opts.gateWaitMin ?? 1440) * 60_000, onWait: (x) => opts.onGateWait?.(x) });
    return r.ok ? { ok: true } : { ok: false, why: `not started: the VPS hard build limit stayed full (${r.live}/${r.max} builds running)` };
  } catch (e) { process.stderr.write(`build-limit: ${e.message}; starting\n`); return { ok: true }; }
}

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** A fresh worktree on branch swarm/<build>/<step> from `base`; reused when it's already there. */
export function worktreeFor(root, dir, job, base = 'HEAD') {
  const path = join(dir, 'worktrees', job.id.replace(/[^\w.-]/g, '_'));
  const branch = `swarm/${job.buildId}/${job.stepId}`;
  if (existsSync(path)) return { path, branch, reused: true };
  mkdirSync(join(dir, 'worktrees'), { recursive: true });
  const has = git(root, 'rev-parse', '--verify', '--quiet', branch).status === 0;
  const r = has ? git(root, 'worktree', 'add', path, branch) : git(root, 'worktree', 'add', '-b', branch, path, base);
  if (r.status !== 0) throw new Error(`worktree for ${job.id}: ${(r.stderr || r.stdout).trim()}`);
  return { path, branch, reused: false };
}

/**
 * Run one job. opts: { bin, cwd, spawn, timeoutMin, now, onLine }. Resolves to a swarm-run@1 record; never throws
 * for a failed run (the record says what went wrong).
 */
export async function runJob(job, agent, brief, opts = {}) {
  const gate = opts.spawn ? { ok: true } : await hardGate(job, opts); // a test's spawn stub runs nothing real
  return runJobNow(job, agent, brief, { ...opts, gateRefused: gate.ok ? '' : gate.why });
}

function runJobNow(job, agent, brief, opts = {}) {
  const now = opts.now ?? (() => new Date().toISOString());
  const spawn = opts.spawn ?? nodeSpawn;
  const bin = opts.bin ?? process.env.AXF_CLAUDE_BIN ?? 'claude';
  const timeoutMin = opts.timeoutMin ?? Math.max(10, 2 * (core.minutesOf(job.estimate) ?? 20));
  const startedAt = now();
  const tr = core.newTracker();
  return new Promise((done) => {
    let killed = ''; let child;
    // a test's spawn stub gets no login copy unless it asks for one (opts.ownLogin: true)
    const login = (opts.spawn && opts.ownLogin !== true) ? null : ownLogin(opts.cwd, `swarm-${job.id}`, opts);
    const finish = (exitCode, err = '') => {
      clearTimeout(timer); login?.release();
      const o = core.runOutcome(tr, { killed, exitCode: err ? 1 : exitCode });
      done(core.normRun({ kind: 'build', jobId: job.id, buildId: job.buildId, stepId: job.stepId, agent: agent.id, model: job.model, startedAt, endedAt: now(),
        status: o.status, reason: err || o.reason, report: o.report, usage: tr.usage, budgetTokens: core.budgetTokens(tr.usage), budget: job.budget, turns: tr.turns, reportedCost: tr.reportedCost, cwd: opts.cwd ?? '' }));
    };
    const kill = (why) => { if (killed) return; killed = why; try { child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5000).unref?.(); } catch { /* gone */ } };
    const timer = setTimeout(() => kill(`over the time limit (${timeoutMin} min)`), timeoutMin * 60_000);
    if (opts.gateRefused) { finish(1, opts.gateRefused); return; }
    const pre = (!opts.spawn && limitMod?.scopePrefix?.(`axf-swarm-${job.id}`)) || [];
    try { child = spawn(pre[0] ?? bin, [...pre.slice(1), ...(pre.length ? [bin] : []), ...core.claudeArgs(brief, job, agent)], { cwd: opts.cwd, env: { ...(login?.env ?? process.env), CLAUDE_CODE_ENTRYPOINT: 'axf-swarm' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { finish(1, e.message); return; }
    child.on('error', (e) => finish(1, e.code === 'ENOENT' ? `Claude Code not found (${bin}); set AXF_CLAUDE_BIN` : e.message));
    createInterface({ input: child.stdout }).on('line', (line) => {
      core.trackLine(tr, line, job.budget); opts.onLine?.(line, tr);
      if (tr.over && !tr.final) kill(`over the token budget (${core.budgetTokens(tr.usage)} > ${job.budget.tokens})`);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}
