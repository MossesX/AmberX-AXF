/**
 * Fixer `run-ci-checks` (build rules whose `check` is a command: check-theme, check-controls, check-toolbars, …).
 * Runs each enabled rule's check command at the build's worktree under the VPS heavy lock
 * (`framework/cli/agent-slots.mjs heavy -- sh -c <cmd>`, so only a few run at once) and collects pass / fail per rule.
 * Nothing is changed, so a check and a fix are the same run; a dry run lists the commands without running them.
 *
 * ctx.rules = build-rule@1 list (default: the live store's enabled rules with a command check, any doer);
 * ctx.phase limits them to one phase; ctx.skipPhase leaves out the rules of a phase the runner already checks one by one. AXF_RUN_CI_DIRECT=1 runs without the heavy lock (tests).
 *
 * CLI: node apps/console-web/plugins/gate/fixers/run-ci-checks.mjs [check|fix] [--dry-run] [--json]
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, result, rootOf } from './lib.mjs';

export const id = 'run-ci-checks';
export const TIMEOUT_MS = 10 * 60 * 1000;

async function rulesOf(ctx) {
  if (Array.isArray(ctx.rules)) return ctx.rules;
  const BR = await import(pathToFileURL(join(rootOf(ctx), 'framework/core/build-rules.mjs')).href);
  return BR.load({ seed: BR.seedPath(rootOf(ctx)) }).store.rules;
}

/** The rules this run covers: enabled, a command check, the phase when given. */
export async function commandRules(ctx = {}) {
  const BR = await import(pathToFileURL(join(rootOf(ctx), 'framework/core/build-rules.mjs')).href);
  return (await rulesOf(ctx)).filter((r) => r.enabled !== false && BR.checkKind(r) === 'command' && (!ctx.phase || r.phase === ctx.phase) && (!ctx.skipPhase || r.phase !== ctx.skipPhase));
}

/** Run one command line; → { id, cmd, ok, code, ms, tail }. */
export function runOne(ctx, rule) {
  const cwd = ctx.cwd || rootOf(ctx);
  const direct = process.env.AXF_RUN_CI_DIRECT === '1' || ctx.direct;
  const argv = direct ? ['sh', ['-c', rule.check]] : [process.execPath, [join(rootOf(ctx), 'framework/cli/agent-slots.mjs'), 'heavy', '--', 'sh', '-c', rule.check]];
  const t0 = Date.now();
  const r = spawnSync(argv[0], argv[1], { cwd, encoding: 'utf8', timeout: ctx.timeoutMs || TIMEOUT_MS, env: { ...process.env, ...(ctx.env || {}) } });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return { id: rule.id, cmd: rule.check, ok: r.status === 0, code: r.status ?? -1, ms: Date.now() - t0, tail: out.split('\n').slice(-6).join('\n').slice(-600) };
}

export async function check(ctx = {}, { dryRun = false } = {}) {
  const rules = await commandRules(ctx);
  if (dryRun) return result(id, { ok: true, dryRun, planned: rules.map((r) => `${r.id}: ${r.check}`), detail: `would run ${rules.length} check command(s)` });
  const seen = new Map(); // one run per distinct command, shared by every rule that names it
  const runs = rules.map((r) => { if (!seen.has(r.check)) seen.set(r.check, runOne(ctx, r)); return { ...seen.get(r.check), id: r.id }; });
  const failed = runs.filter((x) => !x.ok);
  return result(id, { ok: !failed.length, runs, missing: failed.map((x) => `${x.id}: ${x.cmd} (exit ${x.code})`), detail: `${runs.length - failed.length}/${runs.length} check command(s) passed` });
}

/** Nothing to repair: a fix is the same run (the runner re-checks after the rule's own fixer). */
export const fix = (ctx = {}, opts = {}) => check(ctx, opts);

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await cli({ check: (c) => check(c, { dryRun: process.argv.includes('--dry-run') }), fix });
