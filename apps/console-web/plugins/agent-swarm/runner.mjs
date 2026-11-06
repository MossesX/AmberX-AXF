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
export function runJob(job, agent, brief, opts = {}) {
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
    try { child = spawn(bin, core.claudeArgs(brief, job, agent), { cwd: opts.cwd, env: { ...(login?.env ?? process.env), CLAUDE_CODE_ENTRYPOINT: 'axf-swarm' }, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { finish(1, e.message); return; }
    child.on('error', (e) => finish(1, e.code === 'ENOENT' ? `Claude Code not found (${bin}); set AXF_CLAUDE_BIN` : e.message));
    createInterface({ input: child.stdout }).on('line', (line) => {
      core.trackLine(tr, line, job.budget); opts.onLine?.(line, tr);
      if (tr.over && !tr.final) kill(`over the token budget (${core.budgetTokens(tr.usage)} > ${job.budget.tokens})`);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}
