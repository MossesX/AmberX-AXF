#!/usr/bin/env node
/**
 * builds-reconcile — put GitHub's view of the work into the builds store (orch-live-sync s3, Brett Nov 3 2026).
 *
 * Reads open PRs, recently closed/merged PRs and claude/* branches of the repo, matches them to builds in every
 * profile (framework/plan/builds-reconcile-core.mjs), and with --apply writes what it is sure of in ONE store write
 * (so it goes live to main as one status commit, builds-live.mjs): blank branch / PR fields filled, steps a PR names
 * ticked (with the PR in the step note), merged PRs recorded (built → complete). What it can't place goes in the
 * report: orphan PRs and branches, and suggestions. The systems check shows the report as a banner item.
 *
 *   node framework/cli/builds-reconcile.mjs              dry run: what it would change (nothing written)
 *   … --apply                                           write the changes (live to main) and the report
 *   … --brief                                           one line per change (session start)
 *   … --json                                            the report as JSON
 *
 * Runs at every session start (the project's SessionStart hook) and every 10 minutes on the VPS (cron
 * axf-builds-reconcile, installed by deploy/install-console.sh), at most every AXF_RECONCILE_EVERY_MIN min (5; --force). Report: <hub data>/builds/reconcile.json (else
 * .axf-console/builds-reconcile.json in the checkout). GitHub: framework/cli/github.mjs (GitHub App token first).
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import * as merge from '../plan/builds-merge-core.mjs';
import { aliveIds, idlePlan, plan } from '../plan/builds-reconcile-core.mjs';
import { REPO_ROOT, persistRoot } from './persist.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { liveStatus, syncAll, install } from './builds-live.mjs';
import { createGitHub, parseRepo } from './github.mjs';
import { loadState as slotState, tmuxSessions } from './agent-slots.mjs';

export const reportFile = () => {
  const hub = persistRoot();
  return hub ? join(hub, 'builds', 'reconcile.json') : join(REPO_ROOT, '.axf-console', 'builds-reconcile.json');
};
const repoName = () => {
  if (process.env.AXF_GITHUB_REPO) return process.env.AXF_GITHUB_REPO;
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout?.trim() ?? '';
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] : 'MossesX/AmberX-AXF';
};
const git = (args) => { const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 }); return r.status === 0 ? r.stdout.trim() : ''; };

const PR_FIELDS = 'number headRefName title body state mergedAt updatedAt';
const QUERY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  open: pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} commits(last: 60) { nodes { commit { messageHeadline } } } } }
  done: pullRequests(states: [MERGED, CLOSED], first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } } } }`;

/**
 * GitHub's side in one GraphQL query (its own rate budget, so the REST-heavy console can't starve it): open PRs with
 * their commit subjects, the last 100 merged or closed PRs, and the claude/* branches (local git).
 */
export async function gather({ gh = createGitHub({ userAgent: 'axf-builds-reconcile' }), repo = repoName(), branches = true } = {}) {
  const r = parseRepo(repo); if (!r) throw new Error(`not a repo: ${repo}`);
  const [owner, name] = r.split('/');
  const d = await gh.json('POST', '/graphql', { query: QUERY, variables: { owner, name } });
  if (d?.errors?.length) throw new Error(`GitHub GraphQL: ${d.errors.map((e) => e.message).join('; ').slice(0, 300)}`);
  const repoData = d?.data?.repository ?? {};
  const prs = [...(repoData.open?.nodes ?? []), ...(repoData.done?.nodes ?? [])].map((p) => ({
    number: p.number, branch: p.headRefName ?? '', title: p.title ?? '', body: p.body ?? '',
    state: p.mergedAt ? 'merged' : p.state === 'OPEN' ? 'open' : 'closed', mergedAt: p.mergedAt ?? '', updatedAt: p.updatedAt ?? '',
    commits: (p.commits?.nodes ?? []).map((c) => c?.commit?.messageHeadline ?? ''),
  }));
  const out = { prs, branches: [] };
  if (!branches) return out;
  // claude/* branches: fetch their heads, count commits ahead of main (local git, no API calls per branch)
  git(['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/claude/*:refs/remotes/origin/claude/*']);
  const prBy = new Map(prs.filter((p) => p.state === 'open').map((p) => [p.branch, p.number]));
  for (const line of git(['for-each-ref', '--format=%(refname:strip=3) %(committerdate:iso-strict)', 'refs/remotes/origin/claude/']).split('\n').filter(Boolean)) {
    const [name, at] = line.split(' ');
    const full = `claude/${name.replace(/^claude\//, '')}`;
    const ahead = Number(git(['rev-list', '--count', `refs/remotes/origin/main..refs/remotes/origin/${full}`]) || 0);
    out.branches.push({ name: full, ahead, updatedAt: new Date(at).toISOString(), pr: prBy.get(full) ?? 0 });
  }
  return out;
}

/** Build-log entries of this month and the last (the hub's changes folder), for their heartbeats. */
function recentChanges(now = new Date()) {
  const hub = persistRoot(); if (!hub) return [];
  const out = [];
  for (const d of [now, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))]) {
    const dir = join(hub, 'changes', String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'));
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) { try { out.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); } catch { /* skip a broken entry */ } }
  }
  return out;
}

/**
 * Which builds a live process works on here: agent-slots holders, axf-* tmux sessions, fresh build-log heartbeats.
 * null when tmux can't be asked (a container, a laptop): the idle rule then leaves every status alone.
 */
export function liveBuilds({ now = new Date() } = {}) {
  if (process.env.AXF_RECONCILE_IDLE === 'off') return null;
  const tmux = tmuxSessions(); if (!tmux) return null;
  const slots = slotState().running.filter((r) => r.state === 'running' || r.state === 'starting');
  return aliveIds({ sessions: [...tmux.keys()], slots, changes: recentChanges(now), now: now.toISOString() });
}

/** Apply a plan in one store write (live to main). Returns the changes the store saw. */
export function applyPlan(p, by = 'reconciler') {
  if (!p.changes.length) return { changes: [] };
  const r = withStore((s) => {
    const now = new Date().toISOString();
    for (const c of p.changes) {
      const b = s.builds.find((x) => x.id === c.id); if (!b) continue;
      // a new PR on the build: its merged time is that PR's (blank while open)
      if (c.set.pr && c.set.pr !== b.pr) b.mergedAt = '';
      for (const [k, v] of Object.entries(c.set)) b[k] = v;
      for (const id of c.steps) { const st = b.steps.find((x) => x.id === id); if (st && !st.done) { st.done = true; st.doneAt = now; if (!st.note) st.note = c.stepNotes[id] ?? ''; } }
      b.notes.push({ text: `Reconciler: ${c.why.join('; ')}`.slice(0, 2000), at: now });
      b.updatedAt = now;
      merge.settleStatus(b, now);
      if (c.steps.length && b.status === 'pending') b.status = 'running';
      if ((b.status === 'complete' || b.status === 'built') && !b.builtAt) b.builtAt = now;
    }
    return s;
  }, { by, action: 'reconcile', note: p.changes.map((c) => c.id).join(', ') });
  return { changes: r.changes };
}

export async function reconcile({ apply = false, gh, repo } = {}) {
  const at = new Date().toISOString();
  install(); // the merge driver for builds files, once per clone
  const pulled = apply ? syncAll() : { ok: true, skipped: 'dry run' };
  const store = loadStore();
  const builds = store.builds.filter((b) => !b.deleted);
  let gathered; let error = '';
  try { gathered = await gather({ gh, repo }); } catch (e) { error = String(e.message ?? e).slice(0, 300); gathered = { prs: [], branches: [] }; }
  const p = error ? { changes: [], suggestions: [], orphans: { prs: [], branches: [] } } : plan(builds, gathered.prs, gathered.branches, { now: at });
  // running = a live process runs it (zero tokens: tmux, agent slots and build-log heartbeats on this host)
  const alive = liveBuilds();
  const idle = idlePlan(builds, alive, { now: at, skip: p.changes.filter((c) => c.steps.length).map((c) => c.id) });
  for (const c of idle) {
    const same = p.changes.find((x) => x.id === c.id);
    if (same) { Object.assign(same.set, c.set); same.why.push(...c.why); } else p.changes.push(c);
  }
  const applied = apply && p.changes.length ? applyPlan(p) : { changes: [] };
  const profiles = [...new Set(builds.flatMap((b) => b.profiles))];
  const report = {
    $axf: 'builds-reconcile@1', at, repo: repo ?? repoName(), apply, error, pulled: pulled.ok ? (pulled.taken ?? []) : { error: pulled.error },
    profiles, prs: gathered.prs.length, branches: gathered.branches.length,
    changes: p.changes, suggestions: p.suggestions, orphans: p.orphans, live: liveStatus(), written: applied.changes.length,
    running: alive ? builds.filter((b) => b.status === 'running' && alive.has(b.id)).map((b) => b.id) : null,
  };
  if (apply) { try { mkdirSync(dirname(reportFile()), { recursive: true }); writeFileSync(reportFile(), `${JSON.stringify(report, null, 1)}\n`); } catch { /* report only */ } }
  return report;
}

function text(r, brief) {
  const L = [];
  if (r.error) L.push(`GitHub not read: ${r.error}`);
  for (const c of r.changes) L.push(`${r.apply ? 'fixed' : 'would fix'} ${c.id}: ${c.why.join('; ')}`);
  if (!brief) for (const s of r.suggestions) L.push(`check ${s.build ?? s.builds?.join('/') ?? ''}: ${s.why}`);
  if (r.orphans.prs.length) L.push(`orphan PRs (no build): ${r.orphans.prs.map((p) => `#${p.number}`).join(' ')}`);
  if (r.orphans.branches.length) L.push(`orphan branches (no PR, no build): ${r.orphans.branches.map((b) => b.branch).join(' ')}`);
  if (r.live.queued) L.push(`live: ${r.live.queued} change(s) not on main yet${r.live.error ? ` (${r.live.error})` : ''}`);
  return L.join('\n') || `in sync: ${r.prs} PRs, ${r.branches} branches checked`;
}

/*
 * Throttle (urgent-console-perf, Nov 4 2026): every session start and the 10-min cron used to run a full reconcile
 * (GitHub reads + a store write), and many sessions starting together hit GitHub's rate limit and held the store lock.
 * An --apply run is skipped when the last report is younger than AXF_RECONCILE_EVERY_MIN minutes (default 5) or another
 * reconcile is running; the last report is printed instead. --force always runs. Never called in a request path.
 */
export const everyMin = () => { const n = Number(process.env.AXF_RECONCILE_EVERY_MIN); return Number.isFinite(n) && n >= 0 ? n : 5; };
export function recentReport(now = Date.now(), file = reportFile()) {
  try {
    const r = JSON.parse(readFileSync(file, 'utf8'));
    const age = (now - Date.parse(r.at)) / 60000;
    return r.apply && age >= 0 && age < everyMin() ? r : null;
  } catch { return null; }
}
const runLock = () => `${reportFile()}.running`;
function takeRunLock() {
  const l = runLock();
  try { if (Date.now() - statSync(l).mtimeMs > 10 * 60000) rmSync(l, { force: true }); } catch { /* none */ }
  try { mkdirSync(dirname(l), { recursive: true }); closeSync(openSync(l, 'wx')); return () => rmSync(l, { force: true }); } catch { return null; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const recent = apply && !argv.includes('--force') ? recentReport() : null;
  const release = apply && !recent ? takeRunLock() : () => {};
  if (recent || !release) {
    const r = recent ?? (() => { try { return JSON.parse(readFileSync(reportFile(), 'utf8')); } catch { return null; } })();
    const why = recent ? `reconciled ${Math.round((Date.now() - Date.parse(recent.at)) / 60000)} min ago (runs at most every ${everyMin()} min; --force to run now)` : 'another reconcile is running';
    if (argv.includes('--json')) console.log(JSON.stringify({ ...(r ?? {}), skipped: why }));
    else console.log(r ? `${text(r, argv.includes('--brief'))}\n(skipped: ${why})` : `skipped: ${why}`);
  } else reconcile({ apply }).finally(release).then((r) => {
    console.log(argv.includes('--json') ? JSON.stringify(r) : text(r, argv.includes('--brief')));
  }).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
