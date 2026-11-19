#!/usr/bin/env node
/**
 * Build rules runner (build-rules@1, framework/spec/BUILD-RULES.md): the VPS enforcing the rules it owns.
 *
 * For one build at one phase it takes the enabled rules of that phase from the store (the live store, the repo seed as
 * fallback), runs each rule's check, and when a `vps` rule fails runs its autofix and checks again. Every result is one
 * build-rule-run@1 line in the store folder's runs.jsonl (the rule's run history) and one gate History line
 * (gate-history@1, kind build-rule). Phases: before (dispatcher, before launch), after (the build's end hook) and gate
 * (the landing verdict: every enabled rule of phase gate, session rules included, checked; only vps rules are fixed).
 *
 * A check is a command line (run under the heavy lock, fixer run-ci-checks), a checker id that names a fixer
 * (`fixer:<id>`, `store:home-card`, `store:builds-live`), or none, in which case the rule's autofix fixer checks.
 * A rule with no runnable check is `skipped` with the reason (its checker runs elsewhere, e.g. gate:ui-review).
 *
 *   node apps/console-web/plugins/gate/build-rules-runner.mjs run --build <id> --phase before|after|gate
 *        [--rule id[,id]] [--root <worktree>] [--commit] [--dry-run] [--no-history] [--json]
 * --root runs the checks and fixers in the build's worktree; --commit commits what the fixers wrote there on the build's
 * branch ("Build rules: VPS fixes …") and pushes it, so a fix reaches the PR (never on main).
 *   node apps/console-web/plugins/gate/build-rules-runner.mjs runs [--rule id] [--build id] [--limit n] [--json]
 * Exit: 0 every rule passed, was fixed or skipped · 1 a rule failed · 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as BR from '../../../../framework/core/build-rules.mjs';
import { createStore } from './gate-store.mjs';
import { record } from './history.mjs';

export const RUN_FRAME = 'build-rule-run@1';
export const RUN_PHASES = Object.freeze(['before', 'after', 'gate']);
export const RESULTS = Object.freeze(['pass', 'fixed', 'fail', 'skipped']);
export const RUNS_FILE = 'runs.jsonl';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

/** Fixer ids the store may name that live under another module name. */
export const FIXER_ALIASES = Object.freeze({ tracker: 'tracker-threads', 'builds-live-link': 'pr-open-link' });
/** Checker ids answered by a fixer's check. */
export const CHECKER_FIXERS = Object.freeze({ 'store:home-card': 'home-card', 'store:builds-live': 'pr-open-link' });

const fixerFile = (id) => join(HERE, 'fixers', `${FIXER_ALIASES[id] || id}.mjs`);
/** The fixer module for an id, or null when no module exists for it yet. */
export async function loadFixer(id) {
  if (!id || !/^[a-z0-9-]+$/.test(id)) return null;
  const f = fixerFile(id);
  return existsSync(f) ? import(pathToFileURL(f).href) : null;
}

/** How a rule is checked: { kind: 'command' | 'fixer' | 'none', fixer?, why? }. */
export function checkerOf(rule) {
  const c = String(rule.check || '').trim();
  if (c && BR.checkKind(rule) === 'command') return { kind: 'command' };
  if (c.startsWith('fixer:')) return { kind: 'fixer', fixer: c.slice(6) };
  if (CHECKER_FIXERS[c]) return { kind: 'fixer', fixer: CHECKER_FIXERS[c] };
  if (!c && rule.autofix) return { kind: 'fixer', fixer: rule.autofix };
  return { kind: 'none', why: c ? `checker ${c} runs in its own place` : 'no check' };
}

/**
 * Command checks never run at launch or at a build's end hook (Pipeline 2.0, Nov 19 2026): a `before` / `after` vps
 * rule whose check is a command line (`builds-store.mjs verify`, a CI check) runs at the gate instead, which the lander
 * runs once per green PR head inside its running-ci step. At launch it ran on every dispatcher tick, from old worktrees,
 * in heavy slots. Fixers (home card, help stub, THREADS row) stay in their phase: they shape what the session builds.
 */
export const DEFERRED_PHASES = Object.freeze(['before', 'after']);
export const deferredToGate = (r) => DEFERRED_PHASES.includes(r.phase) && r.doer === 'vps' && checkerOf(r).kind === 'command';

/**
 * The rules a phase runs: enabled, that phase; before / after take vps rules only (command checks left to the gate),
 * the gate takes every doer plus the deferred command checks.
 */
export function rulesFor(store, phase, only = []) {
  return BR.normStore(store).rules.filter((r) => r.enabled && (!only.length || only.includes(r.id)) && (phase === 'gate'
    ? r.phase === 'gate' || deferredToGate(r)
    : r.phase === phase && r.doer === 'vps' && !deferredToGate(r)));
}

async function runCheck(rule, ctx, dryRun) {
  const how = checkerOf(rule);
  if (how.kind === 'none') return { ok: true, skipped: true, detail: how.why };
  if (how.kind === 'command') {
    if (dryRun) return { ok: true, skipped: true, detail: `would run ${rule.check}` };
    const ci = await import(pathToFileURL(join(HERE, 'fixers', 'run-ci-checks.mjs')).href);
    const r = ci.runOne(ctx, rule);
    return { ok: r.ok, detail: r.ok ? `${rule.check}: passed` : `${rule.check}: exit ${r.code}\n${r.tail}` };
  }
  const fx = await loadFixer(how.fixer);
  if (!fx) return { ok: true, skipped: true, detail: `no fixer module for ${how.fixer} yet` };
  const r = await fx.check({ ...ctx, rules: undefined }, { dryRun });
  return { ok: r.ok, detail: r.detail, missing: r.missing };
}

/**
 * Run one rule → build-rule-run@1. Pure of IO except what its check / fixer does. A failing vps rule with an autofix is
 * fixed (dry run: planned) and checked again; the result is pass, fixed, fail or skipped.
 */
export async function runRule(rule, ctx = {}, { dryRun = false, phase = rule.phase, at = new Date().toISOString(), by = 'vps' } = {}) {
  const base = { $axf: RUN_FRAME, at, by, build: String(ctx.build?.id || ''), phase, id: rule.id, doer: rule.doer, dryRun };
  let check;
  try { check = await runCheck(rule, ctx, dryRun); } catch (e) { check = { ok: false, detail: `check threw: ${String(e.message || e).slice(0, 300)}` }; }
  if (check.skipped) return { ...base, result: 'skipped', detail: check.detail };
  if (check.ok) return { ...base, result: 'pass', detail: check.detail };
  if (rule.doer !== 'vps' || !rule.autofix) return { ...base, result: 'fail', detail: check.detail, fixable: false };
  const fx = await loadFixer(rule.autofix);
  if (!fx) return { ...base, result: 'fail', detail: `${check.detail}; no fixer module for ${rule.autofix}`, fixable: false };
  let fix;
  try { fix = await fx.fix(ctx, { dryRun }); } catch (e) { fix = { ok: false, unfixable: `fixer threw: ${String(e.message || e).slice(0, 300)}` }; }
  const fixPart = { fixer: rule.autofix, ok: fix.ok, detail: fix.detail || fix.unfixable || '', changed: fix.changed || [], planned: fix.planned || [] };
  if (dryRun) return { ...base, result: 'fail', detail: check.detail, fix: fixPart, fixable: fix.ok };
  if (!fix.ok) return { ...base, result: 'fail', detail: `${check.detail}; ${fix.unfixable || fix.detail}`, fix: fixPart, fixable: false };
  let again;
  try { again = await runCheck(rule, ctx, false); } catch (e) { again = { ok: false, detail: String(e.message || e) }; }
  return { ...base, result: again.ok ? 'fixed' : 'fail', detail: again.ok ? `fixed: ${fix.detail}` : `still failing after ${rule.autofix}: ${again.detail}`, fix: fixPart, fixable: again.ok };
}

/** Where run lines go: the build rules store folder. */
export const runsFile = (dir = BR.storeDir()) => join(dir, RUNS_FILE);

/** Append run lines to runs.jsonl and the gate History. */
export function writeRuns(runs, { dir = BR.storeDir(), gate = null } = {}) {
  if (!runs.length) return;
  mkdirSync(dir, { recursive: true });
  appendFileSync(runsFile(dir), runs.map((r) => `${JSON.stringify(r)}\n`).join(''));
  const g = gate || createStore();
  for (const r of runs) {
    try { record(g, { at: r.at, by: r.by, kind: 'build-rule', action: r.result, id: r.id, after: { build: r.build, phase: r.phase, result: r.result, detail: String(r.detail).slice(0, 400), ...(r.fix ? { fixer: r.fix.fixer, changed: r.fix.changed } : {}) }, reason: { title: `${r.id}: ${r.result}${r.build ? ` (${r.build})` : ''}`, description: String(r.detail).slice(0, 600) } }); }
    catch { /* the gate's data folder is unavailable: runs.jsonl still has it */ }
  }
}

/** Run lines newest first, filtered by rule, build, result, since; at most `limit`. */
export function readRuns({ dir = BR.storeDir(), rule = '', build = '', result = '', since = '', limit = 100 } = {}) {
  let lines = [];
  try { lines = readFileSync(runsFile(dir), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* none yet */ }
  return lines.filter((r) => (!rule || r.id === rule) && (!build || r.build === build) && (!result || r.result === result) && (!since || r.at >= since)).reverse().slice(0, Math.max(1, Math.min(2000, Number(limit) || 100)));
}

/** Plugin folders a branch changes against main (git, in `cwd`); null when git can't tell. */
export function touchedPlugins(branch, cwd = ROOT) {
  if (!branch) return null;
  const r = spawnSync('git', ['diff', '--name-only', `origin/main...origin/${branch}`], { cwd, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) return null;
  return [...new Set(r.stdout.split('\n').map((l) => l.match(/^apps\/console-web\/plugins\/([^/_][^/]*)\//)?.[1]).filter(Boolean))].sort();
}

/** A build's record from the builds store (read only), for the fixers' context: plugins = the folders its branch touches. */
export function buildContext(id, extra = {}) {
  let rec = {};
  try {
    const f = process.env.AXF_BUILDS_STORE || join(ROOT, '_claude/builds/store.json');
    const s = JSON.parse(readFileSync(f, 'utf8'));
    rec = (s.builds || []).find((b) => b.id === id) || {};
  } catch { /* no store */ }
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== ''));
  const b = { id, title: rec.title || '', branch: rec.branch || '', pr: rec.pr || '', text: rec.detail || '', status: rec.status || '', mergedAt: rec.mergedAt || '', ...clean };
  if (!Array.isArray(b.plugins)) b.plugins = touchedPlugins(b.branch) ?? [];
  return b;
}

/**
 * Run a phase for a build → { $axf: 'build-rules-run@1', build, phase, ok, counts, runs }. `ok` is false when any rule
 * ends `fail`. Options: rules (ids), dryRun, history (default true; never in a dry run), dir / seed (the store),
 * store (a store object instead of loading), ctx (extra fixer context: root, cwd, plugins, env), gate (a gate store).
 */
export async function runPhase(buildId, phase, { rules = [], dryRun = false, history: writeHistory = true, dir = BR.storeDir(), seed = BR.seedPath(), store = null, ctx = {}, gate = null, by = 'vps', at } = {}) {
  if (!RUN_PHASES.includes(phase)) throw Object.assign(new Error(`phase is one of ${RUN_PHASES.join(', ')}`), { code: 'invalid' });
  const s = store || BR.load({ dir, seed }).store;
  const build = ctx.build || buildContext(buildId);
  const fctx = { ...ctx, skipPhase: phase, build: { ...build, id: buildId || build.id } };
  const list = rulesFor(s, phase, rules);
  const runs = [];
  for (const r of list) runs.push(await runRule(r, fctx, { dryRun, phase, by, at: at || new Date().toISOString() }));
  if (writeHistory && !dryRun) writeRuns(runs, { dir, gate });
  const counts = Object.fromEntries(RESULTS.map((k) => [k, runs.filter((x) => x.result === k).length]));
  return { $axf: 'build-rules-run@1', build: buildId, phase, dryRun, ok: counts.fail === 0, counts, runs };
}

/** Commit and push what fixers wrote in a worktree (its own branch only, never main) → { sha, files } or { skipped }. */
export function commitFixes(root, runs, { by = 'vps' } = {}) {
  const files = [...new Set(runs.flatMap((r) => (r.fix?.changed || []).map((c) => String(c).split(' (')[0])).filter((f) => f && !/^(PR|linked) /.test(f)))];
  if (!files.length) return { skipped: 'nothing changed' };
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60000 });
  const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim();
  if (!branch || branch === 'HEAD' || branch === 'main') return { skipped: `not on a build branch (${branch || 'none'})` };
  const add = git(['add', '--', ...files]);
  if (add.status !== 0) return { skipped: `git add failed: ${add.stderr.trim().slice(-200)}` };
  const ids = [...new Set(runs.filter((r) => r.fix?.changed?.length).map((r) => r.id))];
  const c = git(['commit', '-q', '-m', `Build rules: VPS fixes (${ids.join(', ')})\n\nWritten by the gate's build rules runner (${by}), not by the build session.`]);
  if (c.status !== 0) return { skipped: `git commit: ${(c.stderr || c.stdout).trim().slice(-200)}` };
  const push = git(['push', '-q', 'origin', 'HEAD']);
  return { sha: (git(['rev-parse', 'HEAD']).stdout || '').trim(), files, branch, pushed: push.status === 0, ...(push.status !== 0 ? { pushError: push.stderr.trim().slice(-200) } : {}) };
}

async function main(argv) {
  process.umask(0o002); // the shared store folder is group-written (the console, the dispatcher and the lander)
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] || '' : ''; };
  const json = argv.includes('--json');
  if (argv[0] === 'runs') {
    const runs = readRuns({ rule: flag('--rule'), build: flag('--build'), result: flag('--result'), limit: flag('--limit') || 50 });
    console.log(json ? JSON.stringify({ runs }, null, 2) : runs.map((r) => `${r.at} ${r.result.padEnd(7)} ${r.id} ${r.build} ${r.phase}`).join('\n') || 'no runs yet');
    return 0;
  }
  if (argv[0] !== 'run' || !RUN_PHASES.includes(flag('--phase'))) { console.error('usage: build-rules-runner.mjs run --build <id> --phase before|after|gate [--rule a,b] [--dry-run] [--no-history] [--json] | runs [--rule id]'); return 2; }
  const root = flag('--root');
  const ctx = root ? { root, cwd: root } : {};
  const out = await runPhase(flag('--build'), flag('--phase'), { rules: flag('--rule').split(',').filter(Boolean), dryRun: argv.includes('--dry-run'), history: !argv.includes('--no-history'), by: flag('--by') || 'vps', ctx });
  if (root && argv.includes('--commit') && !out.dryRun) out.commit = commitFixes(root, out.runs, { by: flag('--by') || 'vps' });
  if (json) console.log(JSON.stringify(out, null, 2));
  else { console.log(`${out.ok ? 'ok' : 'FAIL'} ${out.phase} ${out.build}: ${Object.entries(out.counts).map(([k, v]) => `${v} ${k}`).join(', ')}`); for (const r of out.runs) console.log(`  ${r.result.padEnd(7)} ${r.id}: ${String(r.detail).split('\n')[0].slice(0, 160)}`); }
  return out.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv.slice(2));
