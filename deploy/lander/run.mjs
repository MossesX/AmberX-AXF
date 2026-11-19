#!/usr/bin/env node
/**
 * The lander (lander@1, Pipeline 2.0 part 2; Brett, Nov 18-19 2026: "absolutely no human intervention, ever").
 * Plain Node on the VPS host: git, the GitHub REST API and the builds store. It never calls a model; a code conflict,
 * red CI or failing build rules start a fix session (agent-job.mjs land-build), the only hand-off it makes.
 *
 * One tick (systemd axf-lander.timer, every minute; one at a time under its lock):
 *   the one build at `build-complete` (or already landing) → merging-pr → pr-pulling-main → running-ci → merging-main →
 *   landed, every status written to the builds store as it changes (lander-core.mjs has the rules, store.mjs the seam).
 *   Over the size cap the steps land as 2, 3 or more PRs, one at a time, in order. A failure is `failed` with attempt N
 *   and the next tick retries forward by itself (flaky re-run, split, fix session, pull main again), never a person.
 *   The gate's build rules run inside running-ci, once per green head, in a worktree of the PR branch: never at launch.
 *
 *   node deploy/lander/run.mjs tick [--dry-run] [--only <build>] [--json]   one tick
 *   … status [--json]                                       service, the build landing, the queue (merge-queue view rows)
 *   … queue [--json]                                        the merge queue: every build waiting to land (read-only)
 *   … config [--json]                                       the settings in force (deploy/lander/config.json + data folder)
 *   … pause [--by who] [--why …] | resume [--by who]        stop / start new work (what is in flight stays as it is)
 *   … run                                                   same as tick (the console's "run now")
 *   … fix <build> | retry <build>                           make a failed build's retry due now (no reset: attempts go on)
 *   … show <build>                                          one build: its queue row, status log and failure
 *   … settings | set <key> <value> [--by who]              the settings; set writes the data folder's config.json
 *   … run --request                                         ask the service for a tick (the console's way; the timer runs it)
 * Environment: AXF_LANDER_DIR (data folder: service heartbeat, control, GitHub cache; default
 * <AXF_CONSOLE_ROOT or /opt/axf>/.axf-console/lander), AXF_LAND_REPO (checkout to run git in), AXF_LAND_REPO_SLUG
 * (MossesX/AmberX-AXF), AXF_LAND_GITHUB_API, AXF_LANDER_SIZE_CAP (lines, overrides the config), AXF_LANDER_BUILD_RULES=off,
 * AXF_CREW_SAY=off.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './lander-core.mjs';
import * as G from './git.mjs';
import { makeStore, memoryStore } from './store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_REPO = resolve(HERE, '../..');
const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : v == null ? '' : String(v).slice(0, n));
const nowIso = () => new Date().toISOString();

export function settings() {
  const repo = env('AXF_LAND_REPO', SELF_REPO);
  return {
    repo,
    slug: env('AXF_LAND_REPO_SLUG', 'MossesX/AmberX-AXF'),
    dataDir: env('AXF_LANDER_DIR', join(env('AXF_CONSOLE_ROOT', '/opt/axf'), '.axf-console', 'lander')),
    api: env('AXF_LAND_GITHUB_API', 'https://api.github.com'),
    remote: 'origin', base: 'main',
  };
}

export const files = (s) => ({ service: join(s.dataDir, 'service.json'), control: join(s.dataDir, 'control.json'), config: join(s.dataDir, 'config.json'), lock: join(s.dataDir, 'lander.lock') });

/** The settings in force: deploy/lander/config.json (in the repo), the data folder's config.json on top, then env. */
export function readConfig(s) {
  const repoCfg = G.readJson(join(HERE, 'config.json'), {}) || {};
  const local = G.readJson(files(s).config, {}) || {};
  const cap = env('AXF_LANDER_SIZE_CAP', '');
  return L.normConfig({ ...repoCfg, ...local, ...(cap ? { sizeCapLines: cap } : {}) });
}
export const readControl = (s) => ({ paused: false, ...(G.readJson(files(s).control, {}) || {}) });

/** The one lock: a second tick while one runs does nothing (a holder older than 30 minutes is stale). */
export function takeLock(f) {
  try {
    G.writeJson(`${f}.probe`, {}); rmSync(`${f}.probe`, { force: true });
    try { const st = statSync(f); if (Date.now() - st.mtimeMs > 30 * 60e3) rmSync(f, { force: true }); } catch { /* none */ }
    const fd = openSync(f, 'wx'); closeSync(fd);
    return { ok: true, release: () => rmSync(f, { force: true }) };
  } catch { return { ok: false, release: () => {} }; }
}

/** A section event in the crew's group chat (framework/cli/crew-say.mjs, child process). Never fails the tick. */
export function crewSay(repo, event, text, ref = '') {
  if (process.env.AXF_CREW_SAY === 'off') return false;
  const cli = join(repo, 'framework/cli/crew-say.mjs');
  if (!existsSync(cli)) return false;
  return spawnSync(process.execPath, [cli, 'landing', event, str(text, 600), ...(ref ? ['--ref', ref] : [])], { cwd: repo, encoding: 'utf8', timeout: 30000 }).status === 0;
}

/**
 * The gate's build rules (build-rules@1, phase gate) for one head: the runner of the plugin that provides
 * service:axf.build-rules@1 (found by capability, never by folder name), in a worktree of the PR branch, --commit.
 * → { ok, failing, fixed, commit } | null (no provider, switched off, no answer: nothing blocks on it).
 */
export function buildRulesProvider(repo) {
  const base = join(repo, 'apps/console-web/plugins');
  let dirs = []; try { dirs = readdirSync(base).sort(); } catch { return ''; }
  for (const d of dirs) {
    const m = G.readJson(join(base, d, 'plugin.json'), null);
    if (m && Array.isArray(m.provides) && m.provides.includes('service:axf.build-rules@1') && existsSync(join(base, d, 'build-rules-runner.mjs'))) return join(base, d, 'build-rules-runner.mjs');
  }
  return '';
}
export function defaultBuildRules(s) {
  return ({ id, root }) => {
    if (process.env.AXF_LANDER_BUILD_RULES === 'off') return null;
    const runner = buildRulesProvider(s.repo);
    if (!runner) return null;
    const r = spawnSync(process.execPath, [runner, 'run', '--build', id, '--phase', 'gate', '--by', 'lander', '--json', ...(root ? ['--root', root, '--commit'] : [])], { cwd: s.repo, encoding: 'utf8', timeout: 20 * 60e3 });
    let out = null; try { out = JSON.parse(r.stdout); } catch { return null; }
    const runs = Array.isArray(out?.runs) ? out.runs : [];
    return { ok: !!out.ok, failing: runs.filter((x) => x.result === 'fail').map((x) => x.id), fixed: runs.filter((x) => x.result === 'fixed').map((x) => x.id), ...(out.commit?.sha ? { commit: out.commit.sha } : {}) };
  };
}

/** Build rules in a temporary worktree of the PR branch; a fixer's commit is pushed (a new head: CI runs again). */
export function rulesOnBranch({ s, git, b, branch, buildRules }) {
  const dir = mkdtempSync(join(tmpdir(), 'axf-lander-rules-')); const wt = join(dir, 'wt');
  try {
    if (git(['worktree', 'add', '-q', '-B', `lander-rules/${b.id}`, wt, `${s.remote}/${branch}`]).code) return null;
    const before = git(['rev-parse', 'HEAD'], { cwd: wt }).out;
    const r = buildRules({ id: b.id, root: wt });
    if (!r) return null;
    const after = git(['rev-parse', 'HEAD'], { cwd: wt }).out;
    if (after && after !== before) {
      const p = git(['push', '-q', s.remote, `HEAD:refs/heads/${branch}`], { cwd: wt, timeout: 90000 });
      if (!p.code) { git(['fetch', '-q', s.remote, `+refs/heads/${branch}:refs/remotes/${s.remote}/${branch}`]); return { ...r, pushed: after }; }
    }
    return r;
  } finally { git(['worktree', 'remove', '--force', wt]); git(['branch', '-D', `lander-rules/${b.id}`]); rmSync(dir, { recursive: true, force: true }); }
}

export function defaultAgentJob(s) {
  return (job) => {
    const args = [join(s.repo, 'framework/cli/agent-job.mjs'), job.type, ...Object.entries(job.input).flatMap(([k, v]) => ['--input', `${k}=${v}`]), '--json'];
    const r = spawnSync('node', args, { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch { /* plain text */ }
    return { exit: r.status ?? 1, session: str(out.session, 120), why: r.status === 0 ? '' : str(out.error || r.stdout || r.stderr, 200) };
  };
}

// ------------------------------------------------------------------ one tick

/** The PR branch of the group in flight (or the next one): lander/<build>[-k], k = PRs opened so far + 1. */
const branchFor = (b, opened) => L.groupBranch(b.id, opened);
const openedCount = (b) => { const l = L.landingOf(b); return l.merged.length + l.closed.length; };

/**
 * One tick. Everything injectable for tests: s (settings), git, gh, store ({ read, write }), cfg, now, agentJob,
 * buildRules, say (crew chat). → { at, build, status, actions: [text], waiting: text, error }
 */
export async function tick({ s = settings(), git = G.makeGit(s.repo), gh = G.makeGitHub(s), store, cfg = readConfig(s), now = nowIso, agentJob = defaultAgentJob(s), buildRules = defaultBuildRules(s), say = (ev, text, ref) => crewSay(s.repo, ev, text, ref), dry = false, only = '', log = () => {} } = {}) {
  const at = now();
  const out = { $axf: 'lander-tick@1', at, build: '', status: '', actions: [], waiting: '', error: '', others: [] };
  if (!cfg.enabled) { out.waiting = 'the lander is switched off (config enabled: false)'; return out; }
  const ctl = readControl(s);
  if (ctl.paused) { out.waiting = 'paused'; return out; }
  if (ctl.runRequested && !dry) G.writeJson(files(s).control, { ...ctl, runRequested: '' });
  store ??= dry ? memoryStore((await makeStore()).read()) : await makeStore({ by: 'lander', repo: s.repo });
  const all = store.read();
  const pick = L.pickBuild(only ? all.filter((b) => b.id === only) : all);
  out.others = pick.others;
  if (pick.others.length) log(`more than one build waits to land (${pick.others.join(', ')}): one at a time, ${pick.build.id} first`);
  let b = pick.build;
  if (!b) { out.waiting = 'nothing to land'; return out; }
  out.build = b.id;
  const f = git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  if (f.code) log(`fetch: ${f.err.slice(-200)}`);

  const act = (text) => { out.actions.push(text); log(L.say(b, text)); };
  /** Write a change; a write the store refuses or drops stops the tick (said, never silent). */
  const write = (ch) => {
    if (dry && store.list === undefined) return true;
    const r = store.write(b.id, ch);
    if (r.build) b = r.build;
    if (!r.ok) { out.error = `store: ${r.why || 'write refused'}`; log(L.say(b, out.error)); return false; }
    return true;
  };
  /** A failure: status failed, attempt N, the failure record; posted once attempts pile up. */
  const fail = (kind, ctx) => {
    const g = L.groupState(b);
    const fr = L.failure(b, kind, { at, status: L.failedIn(b), groupSize: g.inFlight?.steps.length || 1, reruns: ctx.head && b.landing?.reruns?.head === ctx.head ? Number(b.landing.reruns.n) || 0 : 0, ...ctx }, cfg);
    act(`failed in ${fr.failure.status}, attempt ${fr.attempt}: ${fr.failure.why} (next: ${fr.failure.retry} at ${fr.failure.notBefore})`);
    write({ status: 'failed', attempt: fr.attempt, failure: fr.failure, note: `Lander: failed in ${fr.failure.status}, attempt ${fr.attempt}: ${fr.failure.why}` });
    if (!dry && L.shouldNotify(fr.attempt, cfg)) say('failed', `${b.id}: failed, attempt ${fr.attempt} (${fr.failure.kind} in ${fr.failure.status}). The lander retries by itself: ${fr.failure.retry}.`, b.id);
    return 'stop';
  };
  const prOf = async (n) => { try { return await gh('GET', `/repos/${s.slug}/pulls/${n}`); } catch (e) { log(`PR #${n}: ${e.message}`); return null; } };

  // ---------------------------------------------------------------- the phases
  const phases = {
    /** merging-pr: the next group's step branches into one PR; each step in-pr with its prNumber. */
    async 'merging-pr'() {
      const g = L.groupState(b);
      if (g.inFlight) return 'pr-pulling-main';
      if (!g.waiting.length) {
        if (!write({ status: 'landed', note: `Lander: landed (${L.landingOf(b).merged.map((n) => `#${n}`).join(', ')}).` })) return 'stop';
        act('landed'); if (!dry) say('done', `${b.id} landed: ${L.landingOf(b).merged.map((n) => `#${n}`).join(', ')} on main.`, b.id);
        return 'stop';
      }
      const branchOf = (st) => L.stepBranch(b, st);
      const sizes = {};
      for (const st of g.waiting) sizes[st.id] = Math.max(0, G.diffLines({ s, git, br: branchOf(st) }));
      const split = L.landingOf(b).split;
      const groups = L.groupSteps(g.waiting, sizes, cfg.sizeCapLines, { split, branchOf });
      const steps = groups[0];
      const k = openedCount(b) + 1; const branch = branchFor(b, k);
      const total = openedCount(b) + groups.length;
      if (b.status !== 'merging-pr' && !write({ status: 'merging-pr', group: k > 1, note: `Lander: PR ${k} of ${total} (${steps.map((x) => x.id).join(', ')}${split ? ', split after a failure' : ''})` })) return 'stop';
      act(`merging ${steps.length} step branch(es) into ${branch} (${steps.reduce((t, x) => t + sizes[x.id], 0)} lines; cap ${cfg.sizeCapLines}; ${groups.length} PR(s) left)`);
      const c = G.combineSteps({ s, git, branch, branches: steps.map(branchOf), dry, log });
      if (c.conflicts) return fail('clash-steps', { why: `${c.between.join(' and ')} conflict in code (${c.conflicts.slice(0, 4).join(', ')})`, groupSize: steps.length });
      if (!c.ok) return fail('infra', { why: c.error });
      let pr = null;
      try {
        const open = await gh('GET', `/repos/${s.slug}/pulls?state=open&head=${encodeURIComponent(`${s.slug.split('/')[0]}:${branch}`)}`);
        pr = Array.isArray(open) && open[0] ? open[0] : null;
        if (!pr && !dry) {
          const title = `${str(b.title || b.id, 100)}${total > 1 ? ` (part ${k} of ${total})` : ''}`;
          const body = [`Build \`${b.id}\`: ${steps.length} step(s) in one PR, opened by the lander (deploy/lander/run.mjs). It pulls main, runs CI once and merges by itself.`, '', ...steps.map((x) => `- ${x.id}: ${str(x.title || x.text, 120)} (\`${branchOf(x)}\`)`)].join('\n');
          pr = await gh('POST', `/repos/${s.slug}/pulls`, { title, head: branch, base: s.base, body });
        }
      } catch (e) { return fail('infra', { why: `opening the PR: ${e.message}` }); }
      const n = Number(pr?.number) || 0;
      if (!n) return dry ? 'stop' : fail('infra', { why: 'the PR has no number' });
      if (!write({ pr: String(n), steps: steps.map((x) => ({ id: x.id, status: 'in-pr', prNumber: n })) })) return 'stop';
      act(`PR #${n} opened: ${steps.map((x) => x.id).join(', ')} added`);
      return 'pr-pulling-main';
    },

    /** pr-pulling-main: main into the one PR. */
    async 'pr-pulling-main'() {
      const g = L.groupState(b); if (!g.inFlight) return 'merging-pr';
      if (b.status !== 'pr-pulling-main' && !write({ status: 'pr-pulling-main' })) return 'stop';
      const branch = branchFor(b, openedCount(b) + 1);
      const pr = await prOf(g.inFlight.pr);
      const r = G.pullMain({ s, git, branch, force: pr?.mergeable === false, dry, log });
      if (r.conflicts) return fail('clash-main', { why: `merging main into ${branch} conflicts in code (${r.conflicts.slice(0, 4).join(', ')})`, pr: g.inFlight.pr });
      if (!r.ok) return fail('infra', { why: r.error, pr: g.inFlight.pr });
      act(r.merged ? `main merged into PR #${g.inFlight.pr} (${str(r.sha, 9)})` : `PR #${g.inFlight.pr} already has main's code`);
      return 'running-ci';
    },

    /** running-ci: CI once on the head, then the gate's build rules on the same head. */
    async 'running-ci'() {
      const g = L.groupState(b); if (!g.inFlight) return 'merging-pr';
      if (b.status !== 'running-ci' && !write({ status: 'running-ci' })) return 'stop';
      const branch = branchFor(b, openedCount(b) + 1);
      const head = git(['rev-parse', `${s.remote}/${branch}`]).out;
      if (!head) return fail('infra', { why: `${branch} is not on GitHub` });
      let runs = [];
      try { runs = (await gh('GET', `/repos/${s.slug}/commits/${head}/check-runs?per_page=100`))?.check_runs || []; } catch (e) { out.waiting = `CI can't be read (${e.message})`; return 'stop'; }
      const since = b.statusAt || at;
      // light PR checks only (ci-scope: a PR while the old merge queue's repo variable is on): the one CI run must be the
      // full one, so it is dispatched once per head (workflow_dispatch is always full) and only the full run counts
      if (L.lightOnly(runs)) {
        if (b.landing?.fullKick?.head !== head && !dry) {
          try { await gh('POST', `/repos/${s.slug}/actions/workflows/${cfg.workflow}/dispatches`, { ref: branch }); write({ landing: { fullKick: { head, at } } }); act(`only light PR checks on ${head.slice(0, 9)}: started the full CI run`); } catch (e) { log(`dispatch: ${e.message}`); }
        }
        if (L.ciTimedOut(since, at, cfg)) return fail('ci-timeout', { why: `no full CI run after ${cfg.ciTimeoutMin} min`, head, pr: g.inFlight.pr });
        out.waiting = 'waiting for the full CI run'; return 'stop';
      }
      const ci = L.ciOf(runs);
      if (ci.ci === 'none') {
        const kick = b.landing?.ciKick;
        if (kick?.head !== head && L.ciKickDue(since, at, cfg) && !dry) {
          try { await gh('POST', `/repos/${s.slug}/actions/workflows/${cfg.workflow}/dispatches`, { ref: branch }); write({ landing: { ciKick: { head, at } } }); act(`no CI on ${head.slice(0, 9)}: started it`); } catch (e) { log(`dispatch: ${e.message}`); }
        }
        out.waiting = 'CI has not started on the head'; return 'stop';
      }
      if (ci.ci === 'running') {
        if (L.ciTimedOut(since, at, cfg)) return fail('ci-timeout', { why: `CI still running after ${cfg.ciTimeoutMin} min`, head, pr: g.inFlight.pr });
        out.waiting = 'CI is running'; return 'stop';
      }
      if (ci.ci === 'failure') return fail('ci-red', { why: `CI is red on ${head.slice(0, 9)} (${ci.failing.slice(0, 3).join(', ') || 'checks failed'})`, head, pr: g.inFlight.pr, failing: ci.failing, runIds: ci.runIds });
      // green: the build rules at the gate, once per head (a fixer's commit is a new head: CI again)
      let rules = b.landing?.rules?.head === head ? b.landing.rules : null;
      if (!rules && !dry) {
        const r = rulesOnBranch({ s, git, b, branch, buildRules });
        rules = r ? { head, ok: r.ok, failing: r.failing || [], fixed: r.fixed || [], at } : { head, ok: true, failing: [], skipped: true, at };
        write({ landing: { rules } });
        if (r?.pushed) { act(`build rules fixed ${r.fixed.join(', ') || 'files'} and pushed ${r.pushed.slice(0, 9)}: CI runs again`); out.waiting = 'CI is running on the rules fix'; return 'stop'; }
      }
      if (rules && !rules.ok) return fail('rules', { why: `build rules fail at the gate (${rules.failing.slice(0, 4).join(', ')})`, head, pr: g.inFlight.pr, failing: rules.failing });
      act(`CI green on ${head.slice(0, 9)}${rules?.skipped ? '' : ', build rules pass'}`);
      return 'merging-main';
    },

    /** merging-main: the one merge, sha pinned; then the next group or landed. */
    async 'merging-main'() {
      const g = L.groupState(b); if (!g.inFlight) return 'merging-pr';
      if (b.status !== 'merging-main' && !write({ status: 'merging-main' })) return 'stop';
      const branch = branchFor(b, openedCount(b) + 1);
      const head = git(['rev-parse', `${s.remote}/${branch}`]).out;
      if (dry) { out.waiting = `would merge PR #${g.inFlight.pr} at ${head.slice(0, 9)}`; return 'stop'; }
      const pr = await prOf(g.inFlight.pr);
      if (pr?.merged_at || pr?.merged) { /* merged already (a tick that died after the merge) */ }
      else if (pr?.state === 'closed') return fail('merge', { why: `PR #${g.inFlight.pr} was closed without merging`, head, pr: g.inFlight.pr });
      else {
        try { await gh('PUT', `/repos/${s.slug}/pulls/${g.inFlight.pr}/merge`, { merge_method: cfg.mergeMethod, sha: head, commit_title: `Merge pull request #${g.inFlight.pr} from ${branch} (lander: ${b.id})`.slice(0, 250) }); }
        catch (e) { return fail(e.status === 405 || e.status === 409 ? 'merge' : 'infra', { why: `merging PR #${g.inFlight.pr}: ${e.message}`, head, pr: g.inFlight.pr }); }
      }
      const merged = [...L.landingOf(b).merged, g.inFlight.pr];
      if (!write({ landing: { merged, reruns: null, rules: null, ciKick: null, fullKick: null }, failure: null })) return 'stop';
      act(`PR #${g.inFlight.pr} merged into main`);
      git(['push', '-q', s.remote, '--delete', branch]);
      const left = L.groupState(b).waiting.length;
      if (!left) {
        if (!write({ status: 'landed', note: `Lander: landed (${merged.map((n) => `#${n}`).join(', ')}).` })) return 'stop';
        act('landed'); say('done', `${b.id} landed: ${merged.map((n) => `#${n}`).join(', ')} on main.`, b.id);
        return 'stop';
      }
      return 'merging-pr';
    },
  };

  /** A failed build whose retry is due: carry the retry out and continue forward. */
  const retry = async () => {
    const fr = b.failure || {};
    if (!L.retryDue(b, at)) { out.waiting = `failed, attempt ${b.attempt || 1}: ${fr.retry || 'retry'} at ${fr.notBefore}`; return 'stop'; }
    const g = L.groupState(b);
    const branch = branchFor(b, openedCount(b) + 1);
    if (fr.retry === 'rerun') {
      if (!dry) for (const id of fr.runIds || []) { try { await gh('POST', `/repos/${s.slug}/actions/runs/${id}/rerun-failed-jobs`); } catch (e) { log(`rerun ${id}: ${e.message}`); } }
      if (!fr.runIds?.length && !dry) { try { await gh('POST', `/repos/${s.slug}/actions/workflows/${cfg.workflow}/dispatches`, { ref: branch }); } catch (e) { log(`dispatch: ${e.message}`); } }
      const n = b.landing?.reruns?.head === fr.head ? b.landing.reruns.n + 1 : 1;
      if (!write({ status: 'running-ci', landing: { reruns: { head: fr.head, n } }, note: `Lander: attempt ${b.attempt}: re-running the failed CI jobs on ${str(fr.head, 9)} (flaky check)` })) return 'stop';
      act(`attempt ${b.attempt}: re-ran the failed CI jobs`); out.waiting = 'CI is re-running'; return 'stop';
    }
    if (fr.retry === 'split') {
      if (g.inFlight && !dry) { try { await gh('PATCH', `/repos/${s.slug}/pulls/${g.inFlight.pr}`, { state: 'closed' }); } catch (e) { log(`close #${g.inFlight.pr}: ${e.message}`); } }
      const closed = g.inFlight ? [...L.landingOf(b).closed, g.inFlight.pr] : L.landingOf(b).closed;
      if (!write({ status: 'merging-pr', landing: { split: true, closed, reruns: null, rules: null, ciKick: null, fullKick: null }, note: `Lander: attempt ${b.attempt}: split${g.inFlight ? ` PR #${g.inFlight.pr}` : ''}; its steps land one PR each` })) return 'stop';
      act(`attempt ${b.attempt}: split${g.inFlight ? ` PR #${g.inFlight.pr}` : ''} into one PR per step`); return 'merging-pr';
    }
    if (fr.retry === 'fix') {
      const head = git(['rev-parse', `${s.remote}/${branch}`]).out;
      if (fr.fix?.at) {
        if (head && head !== fr.fix.head) { if (!write({ status: 'running-ci', note: `Lander: the fix pushed ${head.slice(0, 9)}; CI runs on it` })) return 'stop'; act(`the fix pushed ${head.slice(0, 9)}`); return 'running-ci'; }
        if (L.fixTimedOut(fr.fix, at, cfg)) return fail('fix-timeout', { why: `the fix session (${fr.fix.session || 'agent'}) pushed nothing in ${cfg.fixTimeoutMin} min`, head, pr: g.inFlight?.pr });
        out.waiting = `a fix session works on ${branch}`; return 'stop';
      }
      if (dry) { out.waiting = `would start a fix session on ${branch}`; return 'stop'; }
      const job = agentJob(L.fixJob(b, fr, branch));
      write({ failure: { ...fr, fix: { at, head, session: job.session || '', exit: job.exit, why: job.why || '' } } });
      act(job.exit === 0 ? `attempt ${b.attempt}: fix session ${job.session || 'started'} on ${branch}` : `attempt ${b.attempt}: the fix session did not start (${job.why}); tries again after the timeout`);
      out.waiting = 'a fix session works on it'; return 'stop';
    }
    const to = L.retryStatus(fr);
    if (!write({ status: to, note: `Lander: attempt ${b.attempt}: retrying ${to}` })) return 'stop';
    act(`attempt ${b.attempt}: retrying ${to}`);
    return to;
  };

  try {
    let next = b.status === 'failed' ? await retry() : b.status === 'build-complete' ? 'merging-pr' : b.status;
    for (let i = 0; i < 12 && next && next !== 'stop'; i++) {
      const fn = phases[next];
      if (!fn) break;
      next = await fn();
    }
  } catch (e) { out.error = str(e.stack || e.message, 600); log(L.say(b, `tick failed: ${e.message}`)); }
  try { gh.save?.(); } catch { /* cache only */ }
  out.status = b.status;
  return out;
}

// ------------------------------------------------------------------ CLI

/** Status for the console (gate plugin's Auto-lander tab and systems check): service, the build landing, the queue. */
export async function status(s = settings(), { store } = {}) {
  store ??= await makeStore({ repo: s.repo });
  const svc = G.readJson(files(s).service, {}) || {};
  const ctl = readControl(s);
  const rows = L.queueRows(store.read());
  const current = rows.find((r) => L.LANDING.includes(r.status === 'failed' ? r.failure?.status : r.status)) || null;
  const cfg = readConfig(s);
  return {
    ok: true, $axf: 'lander-status@1',
    service: { lastTick: svc.at || '', result: svc.result || '', build: svc.build || '', error: svc.error || '', paused: ctl.paused === true, pausedAt: ctl.pausedAt || '', pausedBy: ctl.pausedBy || '' },
    current: current?.build || '', queue: rows.map((r) => r.build), builds: rows,
    failing: rows.filter((r) => r.status === 'failed' && r.attempt >= cfg.notifyAfterAttempts).map((r) => ({ build: r.build, attempt: r.attempt, kind: r.failure?.kind || '', why: r.failure?.why || '', since: r.statusAt, pr: r.prs.at(-1)?.pr || null })),
    escalations: [], settings: cfg,
  };
}

export async function main(argv) {
  const [cmd = 'status', ...rest] = argv;
  const flag = (k) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] || '' : ''; };
  const json = rest.includes('--json');
  const s = settings();
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  if (cmd === 'run' && rest.includes('--request')) {
    G.writeJson(files(s).control, { ...readControl(s), runRequested: nowIso(), runRequestedBy: flag('--by') || 'cli' });
    return print({ ok: true, requested: true }, 'a tick is requested (the timer runs one within a minute)');
  }
  if (cmd === 'tick' || cmd === 'run') {
    const lock = takeLock(files(s).lock);
    if (!lock.ok) return print({ ok: true, skipped: 'another tick holds the lock' }, 'another tick is running');
    try {
      const r = await tick({ dry: rest.includes('--dry-run'), only: flag('--only'), log: (l) => { if (!json) console.log(`[lander] ${l}`); } });
      if (!rest.includes('--dry-run')) G.writeJson(files(s).service, { $axf: 'lander-service@1', at: r.at, result: r.error ? 'error' : r.actions.length ? 'worked' : 'idle', build: r.build, status: r.status, waiting: r.waiting, error: r.error });
      return print({ ok: !r.error, ...r }, `${r.at} ${r.build || '-'} ${r.status || ''} ${r.actions.length ? r.actions.join(' · ') : r.waiting}${r.error ? ` ERROR ${r.error}` : ''}`);
    } finally { lock.release(); }
  }
  if (cmd === 'status') { const st = await status(s); return print(st, `lander: ${st.service.paused ? 'paused' : 'on'}, last tick ${st.service.lastTick || 'never'}; landing ${st.current || 'nothing'}; ${st.queue.length} in the queue`); }
  if (cmd === 'queue') { const st = await status(s); return print({ ok: true, rows: st.builds }, st.builds.map((r) => `${r.status.padEnd(16)} ${r.build}${r.attempt ? ` (attempt ${r.attempt})` : ''}${r.prs.length ? ` ${r.prs.map((p) => `#${p.pr}`).join(' ')}` : ''}`).join('\n') || 'nothing waits to land'); }
  if (cmd === 'show') {
    const id = rest.find((x) => !x.startsWith('--'));
    const b = (await makeStore({ repo: s.repo })).read().find((x) => x.id === id);
    if (!b) { process.exitCode = 2; return print({ ok: false, error: `no build ${id || '<build>'}` }, `no build ${id || '<build>'}`); }
    const row = L.queueRows([b])[0] || null;
    return print({ ok: true, build: id, row, status: b.status, attempt: b.attempt || 0, failure: b.failure || null, statusLog: b.statusLog || [], landing: L.landingOf(b) }, `${id}: ${b.status}${b.attempt ? ` (attempt ${b.attempt})` : ''}\n${(b.statusLog || []).map((x) => `  ${x.at} ${x.status} by ${x.by}${x.note ? ` · ${x.note}` : ''}`).join('\n')}`);
  }
  if (cmd === 'set') {
    const [k, v] = rest.filter((x) => !x.startsWith('--') && x !== flag('--by'));
    if (!k || !(k in L.DEFAULTS) || v === undefined) { process.exitCode = 2; return print({ ok: false, error: `set <${Object.keys(L.DEFAULTS).join('|')}> <value>` }, `usage: set <key> <value>; keys: ${Object.keys(L.DEFAULTS).join(', ')}`); }
    const cur = G.readJson(files(s).config, {}) || {};
    G.writeJson(files(s).config, { ...cur, [k]: v, updatedAt: nowIso(), updatedBy: flag('--by') || 'cli' });
    return print({ ok: true, key: k, value: readConfig(s)[k], settings: readConfig(s) }, `${k} = ${readConfig(s)[k]}`);
  }
  if (cmd === 'config' || cmd === 'settings') { const c = readConfig(s); return print({ ok: true, settings: c }, Object.entries(c).map(([k, v]) => `${k} = ${v}`).join('\n')); }
  if (cmd === 'pause' || cmd === 'resume') {
    const c = { ...readControl(s), paused: cmd === 'pause', [`${cmd}dBy`]: flag('--by') || 'cli', [`${cmd}dAt`]: nowIso(), ...(cmd === 'pause' ? { why: flag('--why') } : {}) };
    G.writeJson(files(s).control, c);
    return print({ ok: true, paused: c.paused }, `lander ${c.paused ? 'paused' : 'resumed'}`);
  }
  if (cmd === 'fix' || cmd === 'retry') {
    const id = rest.find((x) => !x.startsWith('--'));
    const store = await makeStore({ repo: s.repo });
    const b = store.read().find((x) => x.id === id);
    if (!b || b.status !== 'failed') return print({ ok: false, error: `${id || '<build>'} is not failed` }, `${id || '<build>'} is not failed`);
    const r = store.write(b.id, { failure: { ...b.failure, notBefore: nowIso() } });
    return print({ ok: r.ok, build: id }, r.ok ? `${id}: the retry is due now (attempt ${(b.attempt || 0) + 1} on the next tick)` : r.why);
  }
  console.error('usage: run.mjs tick [--dry-run] [--only <build>] | status | queue | config | pause | resume | fix <build> [--json]');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
