#!/usr/bin/env node
/**
 * Agent swarm CLI. Reads the active build profile's orchestrator tracker (orchestrator@1; AXF_ORCH_FILE overrides),
 * the roster (agents/roster.json) and the swarm state (data folder; AXF_SWARM_DIR overrides).
 *
 *   node apps/console-web/plugins/agent-swarm/swarm.mjs roster              the agents and their skills
 *   … plan <buildId>…                    split builds into jobs: agent, model, leases, waves (several builds share one lease table)
 *   … pack <buildId> <stepId>            one job's brief: shared prefix + skill, task, leases, snippets
 *   … state | cost                       everything the console shows | the cost meter (agent, build, job)
 *   … run <buildId> <stepId> [--dry-run] headless run of one job in its own worktree (swarm/<build>/<step>)
 *   … check <buildId> <stepId>           pre-push lease check of a job's worktree
 *   … merge <buildId> [--push]           batch merge of done, lease-clean jobs; Boss then ticks the tracker
 *   … fix <buildId> <stepId> [--dry-run] hand a merge conflict to the merge fixer
 *   --json on any command prints JSON (the console server uses this).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './web/swarm-core.mjs';
import { orchestratorPath } from '../../../../framework/cli/persist.mjs';
import { spawnSync } from 'node:child_process';
import { runJob, worktreeFor } from './runner.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const trackerFile = () => process.env.AXF_ORCH_FILE || orchestratorPath();
/** The checkout the swarm works on (AXF_SWARM_REPO overrides, for tests). */
export const repoRoot = () => process.env.AXF_SWARM_REPO || ROOT;
export const dataDir = () => process.env.AXF_SWARM_DIR || join(ROOT, '.axf-console/plugins/agent-swarm');

export function readJson(f, fallback) { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } }
export function writeJson(f, data) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(data, null, 1)}\n`); renameSync(tmp, f);
}

export function loadRoster() { return core.normRoster(readJson(join(HERE, 'agents/roster.json'), { agents: [] })); }
export function loadSkills() {
  const dir = join(HERE, 'agents/skills');
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => { const s = core.parseSkill(readFileSync(join(dir, f), 'utf8')); return [s.id, s]; }));
}
export function loadTracker() { const f = trackerFile(); return existsSync(f) ? readJson(f, { builds: [] }) : { builds: [] }; }
export function findBuilds(ids) {
  const t = loadTracker();
  return ids.map((id) => { const b = (t.builds ?? []).find((x) => x.id === id); if (!b) throw new Error(`no build "${id}" in ${trackerFile()}`); return b; });
}

export function plan(ids, opts = {}) { return core.planJobs(findBuilds(ids), loadRoster(), opts); }

/** The persona block of the shared prefix (agents/persona.md), empty when there is none. */
export function loadPersona() { const f = join(HERE, 'agents/persona.md'); return existsSync(f) ? core.parseSkill(readFileSync(f, 'utf8')).body : ''; }
export const prefix = () => core.sharedPrefix({ persona: loadPersona() });

/** A job's brief: reads only its leased files that are plain paths (folders and globs are named, not read). */
export function pack(job, handoffs = []) {
  const snippets = [];
  for (const f of job.leases) {
    if (f.includes('*') || f.endsWith('/')) continue;
    const abs = resolve(repoRoot(), f);
    if (!abs.startsWith(`${repoRoot()}/`) || !existsSync(abs)) continue;
    snippets.push(core.extractSnippet(f, readFileSync(abs, 'utf8'), job.text));
  }
  return core.packJob(job, { prefix: prefix(), skill: loadSkills()[job.skill], snippets, handoffs });
}
/** Every run, newest last (swarm-run@1 records), in the data folder. */
export const runsFile = () => join(dataDir(), 'runs.json');
export const loadRuns = () => { const r = readJson(runsFile(), { runs: [] }); return Array.isArray(r.runs) ? r.runs : []; };
export function saveRun(run) { const runs = loadRuns(); runs.push(run); writeJson(runsFile(), { $axf: 'swarm-runs@1', runs: runs.slice(-5000) }); return run; }

/** Plan → pack → worktree → claude -p → record. `dry` returns the brief and the command instead of running. */
export async function run(buildId, ref, opts = {}) {
  const job = jobOf(plan([buildId]), ref);
  const agent = loadRoster().agents.find((a) => a.id === job.agent);
  const brief = pack(job, opts.handoffs);
  if (opts.dry) return { dry: true, job, brief, args: core.claudeArgs(brief, job, agent).map((a) => (a.length > 120 ? `${a.slice(0, 117)}…` : a)) };
  const wt = opts.cwd ? { path: opts.cwd, branch: '' } : worktreeFor(repoRoot(), dataDir(), job, opts.base);
  const rec = await runJob(job, agent, brief, { cwd: wt.path, bin: opts.bin, timeoutMin: opts.timeoutMin });
  const lease = core.leaseCheck(job, changedFiles(wt.path, opts.base));
  return saveRun({ ...rec, branch: wt.branch, worktree: wt.path, lease });
}

const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
/** Files a worktree changed since it branched (committed or not). */
export function changedFiles(cwd, base = 'HEAD') {
  const mb = git(cwd, 'merge-base', base === 'HEAD' ? 'HEAD@{upstream}' : base, 'HEAD');
  const from = mb.status === 0 ? mb.stdout.trim() : git(cwd, 'rev-list', '--max-parents=0', 'HEAD').stdout.trim().split('\n')[0];
  const a = git(cwd, 'diff', '--name-only', from).stdout; const u = git(cwd, 'ls-files', '--others', '--exclude-standard').stdout;
  return [...new Set(`${a}\n${u}`.split('\n').map((x) => x.trim()).filter(Boolean))];
}

/** Merge state per build (what's in, what conflicted), in the data folder. */
export const mergesFile = () => join(dataDir(), 'merges.json');

/**
 * Batch merge: every done, lease-clean job of the build, in wave order, into the build's merge branch (its own
 * worktree, so the main checkout is never touched). A conflict is aborted and handed to the merge fixer. Then
 * Boss writes the shared files: the tracker ticks and one note. --push pushes the merge branch.
 */
export function batchMerge(buildId, opts = {}) {
  const b = findBuilds([buildId])[0];
  const p = plan([buildId], { includeDone: true });
  const ms = readJson(mergesFile(), {}); const st = (ms[buildId] ??= { merged: [], conflicts: [] });
  const queue = core.mergeQueue(p, loadRuns(), st.merged);
  const branch = opts.into || b.branch || `swarm/${buildId}/merge`;
  const dir = join(dataDir(), 'worktrees', `_merge-${buildId}`);
  if (!existsSync(dir)) { const has = git(repoRoot(), 'rev-parse', '--verify', '--quiet', branch).status === 0; const r = has ? git(repoRoot(), 'worktree', 'add', dir, branch) : git(repoRoot(), 'worktree', 'add', '-b', branch, dir, opts.base || 'HEAD'); if (r.status) throw new Error(r.stderr.trim()); }
  const merged = []; const conflicts = []; const refused = [];
  for (const q of queue) {
    const lease = core.leaseCheck(q.job, changedFiles(q.run.worktree, branch));
    if (!lease.ok) { refused.push({ job: q.job.id, outside: lease.outside, shared: lease.shared }); continue; }
    const r = git(dir, 'merge', '--no-ff', '-m', `Swarm merge: ${q.job.id} (${q.job.agent})`, q.run.branch);
    if (r.status !== 0) {
      const files = git(dir, 'diff', '--name-only', '--diff-filter=U').stdout.split('\n').filter(Boolean);
      git(dir, 'merge', '--abort');
      const fix = core.fixerJob(q.job, files, loadRoster(), merged.map((m) => m.job.id).join(', '));
      conflicts.push({ job: q.job.id, files, fixer: fix.id }); continue;
    }
    merged.push(q); st.merged.push(q.job.id);
  }
  st.conflicts = conflicts; writeJson(mergesFile(), ms);
  let lines = [];
  if (merged.length && !opts.noShared) { const r = core.applyMerge(loadTracker(), buildId, merged, new Date().toISOString()); writeJson(trackerFile(), r.tracker); lines = r.lines; }
  if (opts.push && merged.length) { const r = git(dir, 'push', '-u', 'origin', branch); if (r.status) throw new Error(r.stderr.trim()); }
  return { branch, merged: merged.map((m) => m.job.id), conflicts, refused, notes: lines };
}

/** Hand a conflict to the merge fixer: its worktree holds the half-done merge, then the fixer runs there. */
export async function fix(buildId, stepId, opts = {}) {
  const ms = readJson(mergesFile(), {}); const c = ms[buildId]?.conflicts?.find((x) => x.job === `${buildId}.${stepId}`);
  if (!c) throw new Error(`no conflict recorded for ${buildId}.${stepId}`);
  const p = plan([buildId], { includeDone: true }); const job = jobOf(p, stepId);
  const fj = core.fixerJob(job, c.files, loadRoster());
  const b = findBuilds([buildId])[0]; const into = b.branch || `swarm/${buildId}/merge`;
  const wt = worktreeFor(repoRoot(), dataDir(), fj, into);
  const src = loadRuns().filter((r) => r.jobId === job.id).pop();
  git(wt.path, 'merge', '--no-commit', '--no-ff', src.branch);
  const agent = loadRoster().agents.find((a) => a.id === fj.agent);
  const brief = pack(fj, [src.report?.handoff ?? '']);
  if (opts.dry) return { dry: true, job: fj, brief };
  const rec = await runJob(fj, agent, brief, { cwd: wt.path, bin: opts.bin });
  return saveRun({ ...rec, branch: wt.branch, worktree: wt.path, lease: core.leaseCheck(fj, changedFiles(wt.path, into)) });
}
export const priceTable = () => core.prices(readJson(join(ROOT, 'framework/schemas/model-pricing.json'), {}));

/** Everything the console page shows, in one read. */
export function state() {
  const roster = loadRoster(); const sk = loadSkills(); const runs = loadRuns(); const table = priceTable();
  const tr = loadTracker();
  const builds = (tr.builds ?? []).filter((b) => !['complete', 'archived'].includes(b.status) && !b.hidden).map((b) => ({ id: b.id, title: b.title, status: b.status, open: (b.steps ?? []).filter((x) => !x.done && !x.skip).length }));
  return { roster, skills: Object.fromEntries(Object.entries(sk).map(([k, v]) => [k, { id: v.id, title: v.title, body: v.body }])), problems: core.checkRoster(roster, sk),
    runs: runs.slice(-300), meter: core.meter(runs, table), prices: table, builds, tracker: trackerFile() };
}
export function jobOf(p, ref) { const j = p.jobs.find((x) => x.id === ref || x.stepId === ref); if (!j) throw new Error(`no open job "${ref}"`); return j; }

function planText(p) {
  const out = [];
  p.waves.forEach((w, i) => { out.push(`Wave ${i + 1}:`); for (const id of w) { const j = p.jobs.find((x) => x.id === id); out.push(`  ${j.id.padEnd(28)} ${j.agent.padEnd(6)} ${j.model.padEnd(7)} ${String(j.budget.tokens).padStart(7)} tok · ${j.leases.join(', ') || '(no files)'}`); } });
  return [...out, ...p.warnings.map((w) => `! ${w}`)].join('\n') || 'Nothing to plan.';
}

export async function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  const out = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const [cmd = 'roster', ...rest] = args;
  if (cmd === 'roster') {
    const r = loadRoster(); const sk = loadSkills(); const problems = core.checkRoster(r, sk);
    return out({ ok: true, roster: r, skills: sk, problems }, [...r.agents.map((a) => `${a.id.padEnd(6)} ${a.name.padEnd(12)} ${a.skill.padEnd(17)} ${a.models.join('/')}`), ...problems.map((p) => `! ${p}`)].join('\n'));
  }
  if (cmd === 'state') return out({ ok: true, state: state() }, JSON.stringify(state(), null, 1));
  if (cmd === 'cost') {
    const m = state().meter; const row = (k, v) => `${k.padEnd(28)} ${String(v.runs).padStart(4)} runs ${core.fmtTokens(v.tokens).padStart(7)} tok ${core.fmtUsd(v.usd).padStart(8)}`;
    return out({ ok: true, meter: m }, [row('TOTAL', m.total), '— by agent', ...Object.entries(m.byAgent).map(([k, v]) => row(k, v)), '— by build', ...Object.entries(m.byBuild).map(([k, v]) => row(k, v)), '— by job', ...Object.entries(m.byJob).map(([k, v]) => row(k, v))].join('\n'));
  }
  if (cmd === 'plan') { if (!rest.length) throw new Error('plan needs a build id'); const p = plan(rest); return out({ ok: true, plan: p }, planText(p)); }
  if (cmd === 'pack') { const [b, ref] = rest; const j = jobOf(plan([b]), ref); const p = pack(j); return out({ ok: true, job: j, brief: p }, `${p.system}\n\n=====\n${p.prompt}\n\n(~${p.tokens.system} + ${p.tokens.prompt} tokens)`); }
  if (cmd === 'run') {
    const [b, ref] = rest.filter((a) => !a.startsWith('--')); const r = await run(b, ref, { dry: args.includes('--dry-run') });
    return out({ ok: true, run: r }, r.dry ? `would run: claude ${r.args.join(' ')}` : `${r.jobId} ${r.status}${r.reason ? ` (${r.reason})` : ''} · ${r.budgetTokens}/${r.budget.tokens} tokens · ${r.turns} turns${r.report ? `\n${r.report.summary}` : ''}`);
  }
  if (cmd === 'check') { const [b, ref] = rest; const r = loadRuns().filter((x) => x.jobId === `${b}.${ref}`).pop(); if (!r) throw new Error('no run for that job yet'); const j = jobOf(plan([b], { includeDone: true }), ref); const l = core.leaseCheck(j, changedFiles(r.worktree)); return out({ ok: l.ok, lease: l }, l.ok ? 'lease clean' : `outside the lease: ${l.outside.join(', ') || '-'} · shared: ${l.shared.join(', ') || '-'}`); }
  if (cmd === 'merge') { const r = batchMerge(rest[0], { push: args.includes('--push') }); return out({ ok: true, ...r }, `merged ${r.merged.length} into ${r.branch}${r.conflicts.length ? ` · ${r.conflicts.length} conflict(s) → merge fixer` : ''}${r.refused.length ? ` · ${r.refused.length} refused (lease)` : ''}${r.notes.length ? `\nNotes for shared files:\n${r.notes.join('\n')}` : ''}`); }
  if (cmd === 'fix') { const [b, ref] = rest.filter((a) => !a.startsWith('--')); const r = await fix(b, ref, { dry: args.includes('--dry-run') }); return out({ ok: true, run: r }, r.dry ? r.brief.prompt : `${r.jobId} ${r.status}`); }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: e.message })); else console.error(e.message);
    process.exitCode = 1;
  });
}
