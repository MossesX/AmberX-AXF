#!/usr/bin/env node
/**
 * builds-reconcile — put GitHub's view of the work into the builds store (orch-live-sync s3, Brett Nov 3 2026).
 *
 * Reads open PRs, recently closed/merged PRs and claude/* branches of the repo, matches them to builds in every
 * profile (framework/plan/builds-reconcile-core.mjs), and with --apply writes what it is sure of in ONE store write
 * (so it goes live to main as one status commit, builds-live.mjs): blank branch / PR fields filled, steps a PR names
 * ticked (with the PR in the step note), merged PRs recorded (built → complete). What it can't place goes in the
 * report: orphan PRs and branches, and suggestions. The systems check shows the report as a banner item.
 * Parallel steps (fill every slot, BUILD-PARALLEL): a step claimed by a step session that is no longer alive (no tmux
 * session axf-<build>--<step>, no agent slot holding it) is reset to ready, its worktree and branch kept for the retry;
 * step branches (`<build-branch>--<step>`) are never matched as builds or orphans; and a build counts as built only when
 * every step branch has merged back (a merged one is deleted), else it stays running with a note.
 *
 * Status comes from the builds store only (Nov 28 2026: the database once the store is on it; there is no status file
 * and main's copy of the store is never read for a status, builds-live.mjs pullFrom). The store is read at the start of
 * the pass and again inside the one write, and what GitHub took seconds to answer is applied to the build as it is then:
 *   - a status the pass worked out is written only while the build still has the status the pass read (a build Brett
 *     or the dispatcher moved meanwhile keeps that move; its ticks and PR fields still come in);
 *   - Brett's stops stick (build-pipeline@1 stopOf: hold, cancel, unqueue). A stopped build is never set running,
 *     queued, landing or built here and its stop is never cleared; the report lists them as `stopsKept`;
 *   - a build deleted meanwhile is left alone;
 *   - nothing is sent back to the Queue while a build the requeue would move is stopped.
 *
 *   node framework/cli/builds-reconcile.mjs              dry run: what it would change (nothing written)
 *   … --apply                                           write the changes (live to main) and the report; Pending builds
 *                                                       parked after a finished phase go back to the Queue (pipeline.mjs
 *                                                       requeue-stuck; AXF_RECONCILE_REQUEUE=off skips it)
 *   … --brief                                           one line per change (session start)
 *   … --json                                            the report as JSON
 *
 * Runs at every session start (the project's SessionStart hook) and every 10 minutes on the VPS (cron
 * axf-builds-reconcile, installed by deploy/install-console.sh), at most every AXF_RECONCILE_EVERY_MIN min (5; --force). Report: <hub data>/builds/reconcile.json (else
 * .axf-console/builds-reconcile.json in the checkout). GitHub: the token broker's token (framework/cli/github-token.mjs
 * token, as the lander takes it), never a `gh` login left on the host. Git always runs in the checkout (git -C), wherever
 * cron starts it. A run that fails still writes its report (`error`), so the systems check shows it, not only the log.
 *
 * Pipeline 2.0 builds that are landing: a PR merged or closed by hand is recorded by the lander's own rule
 * (deploy/lander/run.mjs syncPrs: merged = the merge is recorded and the build goes on; closed = it stops once), so a
 * hand merge never leaves a build "failed" with a note only. Skipped where the lander is not installed.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '../plan/builds-store-core.mjs';
import * as merge from '../plan/builds-merge-core.mjs';
import { aliveIds, idlePlan, plan } from '../plan/builds-reconcile-core.mjs';
import { STOP_LABEL, claimLive, isParallelStep, releaseStep, stepBranch, stopOf } from '../core/build-pipeline.mjs';
import { REPO_ROOT, persistRoot } from './persist.mjs';
import { loadStore, withStore } from './builds-store.mjs';
import { liveStatus, syncAll, install } from './builds-live.mjs';
import { createGitHub, githubToken, parseRepo } from './github.mjs';
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
/** git in the checkout, wherever the process was started (`-C`). → { ok, out, err } */
export function gitIn(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
  return { ok: r.status === 0, out: r.status === 0 ? r.stdout.trim() : '', err: r.status === 0 ? '' : String(r.stderr || r.error?.message || `git exit ${r.status}`).trim().slice(-300) };
}
const git = (args) => gitIn(REPO_ROOT, args).out;

/**
 * The reconciler's GitHub token: the token broker's (github-token.mjs token: the app's installation token, else the
 * saved one), the same source the lander uses. Only when the broker has none does the old order apply (environment,
 * `gh auth token`): a stale `gh` login on the host answered 401 on every cron run.
 */
export function reconcileToken({ root = REPO_ROOT, env = process.env } = {}) {
  const r = spawnSync(process.execPath, [join(root, 'framework', 'cli', 'github-token.mjs'), 'token'], { encoding: 'utf8', timeout: 30000, env, stdio: ['ignore', 'pipe', 'ignore'] });
  const t = r.status === 0 ? String(r.stdout || '').trim() : '';
  return t || githubToken();
}

const PR_FIELDS = 'number headRefName title body state mergedAt updatedAt';
const QUERY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
  open: pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} commits(last: 60) { nodes { commit { messageHeadline } } } } }
  done: pullRequests(states: [MERGED, CLOSED], first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FIELDS} } } } }`;

/**
 * GitHub's side in one GraphQL query (its own rate budget, so the REST-heavy console can't starve it): open PRs with
 * their commit subjects, the last 100 merged or closed PRs, and the claude/* branches (local git).
 */
export async function gather({ gh = createGitHub({ token: reconcileToken, userAgent: 'axf-builds-reconcile' }), repo = repoName(), branches = true, root = REPO_ROOT } = {}) {
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
  const out = { prs, branches: [], gitError: '' };
  if (!branches) return out;
  // claude/* branches: fetch their heads, count commits ahead of main (local git, no API calls per branch)
  const git = (args) => gitIn(root, args).out;
  const fetched = gitIn(root, ['fetch', '-q', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/claude/*:refs/remotes/origin/claude/*']);
  if (!fetched.ok) out.gitError = `git fetch in ${root}: ${fetched.err}`;
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

// ------------------------------------------------------------------ parallel steps (BUILD-PARALLEL)

/**
 * Step branches of done parallel steps still on the remote, per build: Map(buildId → [{ step, branch }]). A merged step
 * branch is deleted; the branch of a step re-run in the build's own session after a conflict (parallel: never) is kept
 * on purpose and does not count.
 */
export function stepBranchesOf(builds, branches) {
  const names = new Set((branches ?? []).map((b) => b.name ?? b));
  const out = new Map();
  for (const b of builds) for (const st of (b.steps ?? []).filter((x) => x.done && isParallelStep(x))) {
    const br = stepBranch(b, st, { parallel: true });
    if (names.has(br)) { if (!out.has(b.id)) out.set(b.id, []); out.get(b.id).push({ step: st.id, branch: br }); }
  }
  return out;
}
/** Branch names that are some build's step branch (kept out of the build / orphan matching). */
export const isStepBranch = (builds, name) => builds.some((b) => String(name).startsWith(`${stepBranch(b, null)}--`) && (b.steps ?? []).some((st) => `${stepBranch(b, null)}--${st.id}` === name));

const GRACE_MS = 10 * 60e3;
/**
 * Step claims whose session is gone: [{ id, step, runId, why }]. `alive(b, step)` answers true / false, or null when it
 * can't tell (then nothing is reset). The build's own in-memory claim (main:…) is never stored, so never seen here.
 */
export function stepResetPlan(builds, alive, { now = Date.now(), graceMs = GRACE_MS } = {}) {
  const out = [];
  for (const b of builds) for (const st of b.steps ?? []) {
    const c = st.claim;
    if (!c?.runId || st.done || st.skip || String(c.runId).startsWith('main:')) continue;
    if (claimLive(c, now) && now - Date.parse(c.at || 0) < graceMs) continue;
    const a = alive(b, st);
    if (a === null || a === true) continue;
    out.push({ id: b.id, step: st.id, runId: c.runId, why: `${st.id}: step session ${c.runId} is not alive: back to ready (worktree and branch kept)` });
  }
  return out;
}
/** Is a step's session alive here? tmux axf-<slug>--<step>[--agent] or an agent slot holding build + step; null = can't tell. */
export function stepAlive(sessions, slots) {
  if (!sessions) return () => null;
  const names = [...sessions];
  return (b, st) => {
    const slug = String(b.id).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, Math.max(1, 46 - st.id.length));
    if (names.some((n) => n === `axf-${slug}--${st.id}` || n.startsWith(`axf-${slug}--${st.id}--`) || n.startsWith(`axf-${slug}--${st.id}-`))) return true;
    return (slots ?? []).some((r) => r.build === b.id && r.step === st.id && (r.state === 'running' || r.state === 'starting'));
  };
}

/** The fields of a build that say where it rests; a pass may not move them on a stopped build. */
const REST_FIELDS = ['status', 'builtAt', 'statusAt', 'statusBy'];
const STOP_PIPELINE = ['stop', 'heldAt', 'heldBy', 'heldWhy', 'queuedAt', 'queuedBy', 'session', 'slot', 'dispatchedAt'];
/**
 * Brett's stop on a build stands (build-pipeline@1: hold, cancel and unqueue are terminal until Brett). `was` is the
 * build as the store held it before the pass touched it, `b` the same build after: when `was` is stopped, its status,
 * the stop record, the hold fields and the launch fields are put back on `b` (in place); ticked steps, PR fields and
 * notes stay. → why the pass was corrected, or '' when it had not tried to move the build.
 */
export function keepStopOn(was, b) {
  const stop = stopOf(was);
  if (!stop || !b) return '';
  const wp = was.pipeline ?? {}; const np = b.pipeline ?? {};
  const same = (x, y) => JSON.stringify(x ?? '') === JSON.stringify(y ?? '');
  const moved = REST_FIELDS.filter((k) => !same(was[k], b[k])); const lifted = STOP_PIPELINE.filter((k) => !same(wp[k], np[k]));
  if (!moved.length && !lifted.length) return '';
  const to = b.status;
  for (const k of REST_FIELDS) { if (was[k] === undefined) delete b[k]; else b[k] = was[k]; }
  if (was.pipeline || b.pipeline) { b.pipeline = { ...np }; for (const k of STOP_PIPELINE) { if (wp[k] === undefined) delete b.pipeline[k]; else b.pipeline[k] = wp[k]; } }
  return `${STOP_LABEL[stop.kind].toLowerCase()}${stop.by ? ` (${stop.by})` : ''}: ${to !== was.status ? `not moved to ${to}` : 'the stop stays'}, only Brett lifts that`;
}

/**
 * Apply a plan in one store write (live to main). The store is read again inside the write, so every rule looks at the
 * build as it is now: a deleted build is skipped, a status worked out from a status the build no longer has
 * (`p.seen`: id → the status the pass read) is not written, and a stopped build keeps its stop (keepStopOn).
 * Returns { changes: what the store saw, kept: [{ id, why }] stops that stood, stale: [{ id, read, now, not }] }.
 */
export function applyPlan(p, by = 'reconciler') {
  if (!p.changes.length && !(p.stepResets ?? []).length) return { changes: [], kept: [], stale: [] };
  let kept = []; let stale = [];
  const r = withStore((s) => {
    const now = new Date().toISOString();
    kept = []; stale = []; // the write may run again on a conflict: only the last run counts
    const ids = new Set([...p.changes.map((c) => c.id), ...(p.stepResets ?? []).map((x) => x.id)]);
    const was = new Map(s.builds.filter((b) => ids.has(b.id)).map((b) => [b.id, JSON.parse(JSON.stringify(b))]));
    for (const c of p.changes) {
      const b = s.builds.find((x) => x.id === c.id); if (!b || b.deleted) continue;
      const set = { ...c.set };
      // the status was worked out from the one the pass read: the build has another now, so that answer is stale
      const read = p.seen?.get?.(c.id);
      if ('status' in set && read !== undefined && read !== b.status) { stale.push({ id: c.id, read, now: b.status, not: set.status }); delete set.status; }
      if (!Object.keys(set).length && !c.steps.length) continue;
      // a new PR on the build: its merged time is that PR's (blank while open)
      if (set.pr && set.pr !== b.pr) b.mergedAt = '';
      for (const [k, v] of Object.entries(set)) b[k] = v;
      for (const id of c.steps) { const st = b.steps.find((x) => x.id === id); if (st && !st.done) { st.done = true; st.doneAt = now; if (!st.note) st.note = c.stepNotes[id] ?? ''; } }
      { const text = `Reconciler: ${c.why.join('; ')}`.slice(0, 2000); if (b.notes.at(-1)?.text !== text) b.notes.push({ text, at: now }); } // the same finding twice in a row is one note
      b.updatedAt = now;
      merge.settleStatus(b, now);
      if (c.steps.length && (b.status === 'pending' || b.status === 'queued')) b.status = 'running';
      // built only once every step branch is merged back
      const open = p.stepBranches?.get?.(b.id) ?? [];
      if ((b.status === 'complete' || b.status === 'built') && open.length) { b.status = 'running'; b.notes.push({ text: `Reconciler: every step is done but ${open.map((x) => x.branch).join(', ')} not merged back yet: stays running until the dispatcher merges ${open.length === 1 ? 'it' : 'them'}.`, at: now }); }
      if ((b.status === 'complete' || b.status === 'built') && !b.builtAt) b.builtAt = now;
    }
    for (const r of p.stepResets ?? []) {
      const b = s.builds.find((x) => x.id === r.id); if (!b || b.deleted) continue;
      const rel = releaseStep(b, r.step, { runId: r.runId, now, note: `Reconciler: ${r.why}` });
      if (rel.ok && rel.released) { Object.assign(b, rel.build); b.notes.push({ text: `Reconciler: ${r.why}`, at: now }); b.updatedAt = now; }
    }
    // Brett's stops stick: whatever the rules above made of a held, cancelled or unqueued build, it rests where he put it
    for (const [id, old] of was) {
      const b = s.builds.find((x) => x.id === id); const why = keepStopOn(old, b);
      if (!why) continue;
      kept.push({ id, why });
      // nothing else came in (no tick, no PR field): the build is written back exactly as it was, so a pass that
      // repeats every few minutes leaves no trail of notes on it; the report says it each time
      const bare = (x) => JSON.stringify({ ...x, notes: null, updatedAt: null });
      if (bare(b) === bare(old)) { for (const k of Object.keys(b)) delete b[k]; Object.assign(b, old); continue; }
      const text = `Reconciler: left ${why}.`.slice(0, 2000);
      if (!b.notes.slice(-2).some((n) => n.text === text)) b.notes.push({ text, at: now });
    }
    return s;
  }, { by, action: 'reconcile', note: [...p.changes.map((c) => c.id), ...(p.stepResets ?? []).map((r) => `${r.id}/${r.step}`)].join(', ') });
  return { changes: r.changes, kept, stale };
}

/**
 * Pending builds parked after a finished phase (the old exit rule) go back to the Queue: the build orchestrator's
 * requeue-stuck (pipeline.mjs requeueStuck), dry run unless --apply. Null when the plugin isn't installed.
 */
async function requeueParked(apply) {
  const f = join(REPO_ROOT, 'apps/console-web/plugins/build-orchestrator/pipeline.mjs');  // axf-plugin:build-orchestrator
  if (process.env.AXF_RECONCILE_REQUEUE === 'off' || !existsSync(f)) return null;
  try {
    const m = await import(f);
    const dry = m.requeueStuck({ apply: false, by: 'reconciler' });
    const held = stoppedAmong(dry.found, loadStore().builds);
    // the requeue moves every build it finds: with a stopped one among them nothing is moved (Brett's stop stands)
    if (!apply || !dry.found.length || held.length) return { found: dry.found.filter((x) => !held.includes(x.id)), moved: [], ...(held.length ? { stopped: held } : {}) };
    const r = m.requeueStuck({ apply: true, by: 'reconciler' });
    return { found: r.found, moved: r.moved };
  } catch (e) { return { found: [], moved: [], error: String(e.message ?? e).slice(0, 300) }; }
}
/** The ids among `found` ([{ id }]) whose build is stopped in `builds` (hold, cancel, unqueue). Pure. */
export function stoppedAmong(found, builds) {
  const by = new Map((builds ?? []).map((b) => [b.id, b]));
  return (found ?? []).map((x) => x.id).filter((id) => !!stopOf(by.get(id)));
}

/**
 * Landing Pipeline 2.0 builds whose PR GitHub shows merged or closed: the lander's rule records it (deploy/lander
 * syncPrs). Only asked when the gathered PRs say there is something to record. → { asked: [build], actions, error,
 * skipped } | null (nothing to do, or no lander here).
 */
export async function syncLanding(builds, prs, { apply = false, root = REPO_ROOT, lander } = {}) {
  const state = new Map((prs || []).map((p) => [Number(p.number), p.state]));
  const stuck = (builds || []).filter((b) => b.flow === 'pipeline-2' && !['landed', 'complete'].includes(b.status))
    .filter((b) => { const merged = new Set(b.landing?.merged || []); const closed = new Set(b.landing?.closed || []); return (b.steps || []).some((s) => s.status === 'in-pr' && s.prNumber && !merged.has(s.prNumber) && !closed.has(s.prNumber) && ['merged', 'closed'].includes(state.get(Number(s.prNumber)))); })
    .map((b) => b.id);
  if (!stuck.length) return null;
  if (!apply) return { asked: stuck, actions: [], error: '', skipped: 'dry run' };
  const f = join(root, 'deploy', 'lander', 'run.mjs');
  if (!lander && !existsSync(f)) return null;
  try { const m = lander || await import(f); const r = await m.syncPrs(); return { asked: stuck, actions: r.actions || [], error: r.error || '', skipped: r.skipped || '' }; }
  catch (e) { return { asked: stuck, actions: [], error: String(e.message ?? e).slice(0, 300), skipped: '' }; }
}

export async function reconcile({ apply = false, gh, repo } = {}) {
  const at = new Date().toISOString();
  install(); // the merge driver for builds files, once per clone
  const pulled = apply ? syncAll() : { ok: true, skipped: 'dry run' };
  const store = loadStore();
  const builds = store.builds.filter((b) => !b.deleted);
  let gathered; let error = '';
  try { gathered = await gather({ gh, repo }); } catch (e) { error = String(e.message ?? e).slice(0, 300); gathered = { prs: [], branches: [] }; }
  // step branches belong to their build's steps, never to the build / orphan matching
  const stepBr = stepBranchesOf(builds, gathered.branches);
  const plainBranches = gathered.branches.filter((b) => !isStepBranch(builds, b.name));
  const plainPrs = gathered.prs.filter((x) => !isStepBranch(builds, x.branch));
  const p = error ? { changes: [], suggestions: [], orphans: { prs: [], branches: [] } } : plan(builds, plainPrs, plainBranches, { now: at });
  p.seen = new Map(builds.map((b) => [b.id, b.status])); // the status each answer below was worked out from
  p.stepBranches = error ? new Map() : stepBr;
  for (const [id, list] of p.stepBranches) {
    const b = builds.find((x) => x.id === id);
    if (!b || !['built', 'complete'].includes(b.status) || p.changes.some((c) => c.id === id)) continue;
    p.changes.push({ id, set: { status: 'running' }, steps: [], stepNotes: {}, why: [`step branch${list.length === 1 ? '' : 'es'} ${list.map((x) => x.branch).join(', ')} not merged back: not built yet`] });
  }
  // running = a live process runs it (zero tokens: tmux, agent slots and build-log heartbeats on this host)
  const alive = liveBuilds();
  // parallel step sessions that died: their steps go back to ready
  let tmuxNow = null; try { tmuxNow = process.env.AXF_RECONCILE_IDLE === 'off' ? null : tmuxSessions(); } catch { tmuxNow = null; }
  p.stepResets = stepResetPlan(builds, stepAlive(tmuxNow ? [...tmuxNow.keys()] : null, (() => { try { return slotState().running; } catch { return []; } })()));
  const idle = idlePlan(builds, alive, { now: at, skip: p.changes.filter((c) => c.steps.length).map((c) => c.id) });
  for (const c of idle) {
    const same = p.changes.find((x) => x.id === c.id);
    if (same) { Object.assign(same.set, c.set); same.why.push(...c.why); } else p.changes.push(c);
  }
  const applied = apply && (p.changes.length || p.stepResets.length) ? applyPlan(p) : { changes: [], kept: [], stale: [] };
  const requeued = await requeueParked(apply);
  const landing = error ? null : await syncLanding(builds, gathered.prs, { apply });
  const profiles = [...new Set(builds.flatMap((b) => b.profiles))];
  const report = {
    $axf: 'builds-reconcile@1', at, repo: repo ?? repoName(), apply, error: [error, gathered.gitError, landing?.error ? `lander: ${landing.error}` : ''].filter(Boolean).join('; '), pulled: pulled.ok ? (pulled.taken ?? []) : { error: pulled.error },
    profiles, prs: gathered.prs.length, branches: gathered.branches.length,
    changes: p.changes, suggestions: p.suggestions, orphans: p.orphans, live: liveStatus(), written: applied.changes.length,
    stopsKept: applied.kept ?? [], staleSkipped: applied.stale ?? [],
    stepResets: p.stepResets, stepBranches: [...p.stepBranches.entries()].map(([id, list]) => ({ id, steps: list })),
    requeued, landing,
    running: alive ? builds.filter((b) => b.status === 'running' && alive.has(b.id)).map((b) => b.id) : null,
  };
  if (apply) writeReport(report);
  return report;
}
function writeReport(report) { try { mkdirSync(dirname(reportFile()), { recursive: true }); writeFileSync(reportFile(), `${JSON.stringify(report, null, 1)}\n`); } catch { /* report only */ } }

/**
 * The report of a run that crashed: the same shape with `error`, so the systems check (which reads the report) shows
 * the failure instead of the last good run. Pure.
 */
export function failedReport(e, { at = new Date().toISOString(), apply = true, repo = '' } = {}) {
  return { $axf: 'builds-reconcile@1', at, repo, apply, error: `the reconcile run failed: ${String(e?.message ?? e).slice(0, 300)}`, pulled: [], profiles: [], prs: 0, branches: 0, changes: [], suggestions: [], orphans: { prs: [], branches: [] }, live: { queued: 0 }, written: 0, requeued: null, landing: null, running: null, failed: true };
}

function text(r, brief) {
  const L = [];
  if (r.error) L.push(r.failed ? r.error : `Not read: ${r.error}`);
  for (const a of r.landing?.actions ?? []) L.push(`lander: ${a}`);
  if (r.landing?.skipped && r.landing.asked?.length) L.push(`lander: ${r.landing.asked.join(', ')} has a PR GitHub shows merged or closed (${r.landing.skipped})`);
  const keptIds = new Set((r.stopsKept ?? []).map((x) => x.id));
  for (const c of r.changes) if (!keptIds.has(c.id)) L.push(`${r.apply ? 'fixed' : 'would fix'} ${c.id}: ${c.why.join('; ')}`);
  for (const x of r.stopsKept ?? []) L.push(`left ${x.id}: ${x.why}`);
  for (const x of r.staleSkipped ?? []) L.push(`left ${x.id}: it went ${x.read} → ${x.now} during the pass, not set ${x.not}`);
  for (const x of r.stepResets ?? []) L.push(`${r.apply ? 'reset' : 'would reset'} ${x.id}/${x.step}: ${x.why}`);
  if (!brief) for (const s of r.suggestions) L.push(`check ${s.build ?? s.builds?.join('/') ?? ''}: ${s.why}`);
  if (r.orphans.prs.length) L.push(`orphan PRs (no build): ${r.orphans.prs.map((p) => `#${p.number}`).join(' ')}`);
  if (r.orphans.branches.length) L.push(`orphan branches (no PR, no build): ${r.orphans.branches.map((b) => b.branch).join(' ')}`);
  for (const f of r.requeued?.found ?? []) L.push(`${r.apply && r.requeued.moved.includes(f.id) ? 'requeued' : 'would requeue'} ${f.id}: ${f.why}`);
  if (r.requeued?.stopped?.length) L.push(`not requeued: ${r.requeued.stopped.join(', ')} stopped by Brett (hold, cancel or unqueue stands)`);
  if (r.requeued?.error) L.push(`requeue-stuck: ${r.requeued.error}`);
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
  }).catch((e) => {
    if (apply) writeReport(failedReport(e, { repo: (() => { try { return repoName(); } catch { return ''; } })() }));
    console.error(e.message); process.exitCode = 1;
  });
}
