#!/usr/bin/env node
/**
 * The lander (lander@1, Pipeline 2.0 part 2; Brett, Nov 18-19 2026).
 * Plain Node on the VPS host: git, the GitHub REST API and the builds store. It never calls a model; a code conflict,
 * red CI or failing build rules start a fix session on the model the triage gate assigns (fix-session.mjs), the only
 * hand-off it makes.
 *
 * One tick (systemd axf-lander.timer, every minute; one at a time under its lock):
 *   the one build at `build-complete` (or already landing) → merging-pr → pr-pulling-main → running-ci → merging-main →
 *   landed, every status written to the builds store as it changes (lander-core.mjs has the rules, store.mjs the seam).
 *   Over the size cap the steps land as 2, 3 or more PRs, one at a time, in order.
 *   First thing in every tick, for every build with a PR in flight: what GitHub says about that PR. Merged by hand =
 *   the merge is recorded and the build goes on (to the next PR, or landed once CI is green on the merge). Closed
 *   without merging = the build stops once, until the PR is reopened or the build is re-sent.
 *   A failure is `failed` with the landing run's own attempt N; the next tick retries forward by itself (flaky re-run,
 *   fix session, split, pull main again). The ladder has a top: after maxFixes fix sessions on a PR or maxAttempts
 *   failures the build stops and waits for Brett (the systems check shows it, with the exact failing check).
 *   CI is green only when every check run on the head (all pages) ended `success` and every required check reported.
 *   The gate's build rules run inside running-ci, once per green head, in a worktree of the PR branch; rules that
 *   could not run are a failure, never a pass.
 *   An emergency build is picked first (front of the line). No build merges on a stale head: main and the PR head are
 *   read from GitHub again right before the merge, and when main has code the green head lacks, the newest main is
 *   pulled into the PR and CI runs again on that head first.
 *   After `landed` the build's merged step branches and worktrees are removed.
 *
 *   node deploy/lander/run.mjs tick [--dry-run] [--only <build>] [--json]   one tick
 *   … status [--json]                                       service, the build landing, the queue (merge-queue view rows)
 *   … queue [--json]                                        the merge queue: every build waiting to land (read-only)
 *   … config [--json]                                       the settings in force (deploy/lander/config.json + data folder)
 *   … pause [--by who] [--why …] | resume [--by who]        stop / start new work (what is in flight stays as it is)
 *   … run                                                   same as tick (the console's "run now")
 *   … retry <build> | fix <build> [--by who]                a failed build's retry is due now; a stopped build is re-sent
 *                                                           (a new landing run: the attempt count starts again)
 *   … show <build>                                          one build: its queue row, status log and failure
 *   … sync-prs                                              only read every PR in flight (merged or closed by hand?) and record it
 *   … accept <build> --by <who> --why "<what was checked>"  a PR merged by hand whose CI the lander can't find green:
 *                                                           a person vouches for it (noted on the build), and it lands
 *   … settings | set <key> <value> [--by who]              the settings; set writes the data folder's config.json
 *   … run --request                                         ask the service for a tick (the console's way; the timer runs it)
 * Environment: AXF_LANDER_DIR (data folder: service heartbeat, control, GitHub cache, fix briefs; default
 * <AXF_CONSOLE_ROOT or /opt/axf>/.axf-console/lander), AXF_LAND_REPO (checkout to run git in), AXF_LAND_REPO_SLUG
 * (MossesX/AmberX-AXF), AXF_LAND_GITHUB_API, AXF_LANDER_SIZE_CAP (lines, overrides the config), AXF_LANDER_BUILD_RULES=off,
 * AXF_LANDER_FIX_LAUNCHER, AXF_CREW_SAY=off.
 */
import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './lander-core.mjs';
import * as G from './git.mjs';
import { makeStore, memoryStore } from './store.mjs';
import { FIX_MODEL, defaultFixSession, fixWorktree } from './fix-session.mjs';
import { crewSay } from '../../framework/cli/crew-say.mjs';

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

const LOCK_MAX_MS = 30 * 60e3;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
/**
 * The one lock: a second tick while one runs does nothing. The lock holds its tick's pid: a holder that is gone (a
 * killed tick) is dropped at once; a holder that still runs is left alone, however old; a lock that names no pid goes
 * after 30 minutes.
 */
export function takeLock(f) {
  try {
    G.writeJson(`${f}.probe`, {}); rmSync(`${f}.probe`, { force: true });
    try {
      const st = statSync(f);
      let pid = 0; try { pid = Number(JSON.parse(readFileSync(f, 'utf8')).pid) || 0; } catch { /* an old lock: no pid in it */ }
      if (pid ? !alive(pid) : Date.now() - st.mtimeMs > LOCK_MAX_MS) rmSync(f, { force: true });
    } catch { /* none */ }
    const fd = openSync(f, 'wx');
    try { writeSync(fd, JSON.stringify({ pid: process.pid, at: nowIso() })); } finally { closeSync(fd); }
    return { ok: true, release: () => rmSync(f, { force: true }) };
  } catch { return { ok: false, release: () => {} }; }
}

/** A "landing" section event in the crew's group chat, posted from the checkout's crew plugin. Never fails the tick. */
export function sayLanding(repo, event, text, ref = '') {
  return crewSay('landing', event, str(text, 600), { ref, root: repo }).posted;
}

/** How often the build rules run on one head when they could not run (a crash, a timeout, no JSON): once more, then it fails. */
const RULES_TRIES = 2;
const lastLines = (text, n = 6) => String(text || '').trim().split('\n').filter((l) => l.trim()).slice(-n).join(' | ').slice(-600);

/**
 * The gate's build rules (build-rules@1, phase gate) for one head: the runner of the plugin that provides
 * service:axf.build-rules@1 (found by capability, never by folder name), in a worktree of the PR branch, --commit.
 * Three answers, and the gate fails closed:
 *   { ok, failing, fixed, detail, commit }   the rules ran: pass or fail
 *   { skipped: why }                         no provider installed, or switched off (AXF_LANDER_BUILD_RULES=off): the only skips
 *   { error: why, tail }                     they could not run (crash, timeout, no JSON): never a pass
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
/** The runner's answer → one of the three. Pure. `r` = { status, signal, error, stdout, stderr } of the child. */
export function readRulesAnswer(r, { timeoutMin = 20 } = {}) {
  const tail = lastLines(`${r?.stderr || ''}\n${r?.stdout || ''}`);
  if (r?.error?.code === 'ETIMEDOUT' || r?.signal === 'SIGTERM') return { error: `the rules runner timed out after ${timeoutMin} min`, tail };
  if (r?.error) return { error: `the rules runner did not start: ${str(r.error.message, 160)}`, tail };
  let out = null; try { out = JSON.parse(r?.stdout); } catch { return { error: `the rules runner printed no JSON (exit ${r?.status ?? 'none'})`, tail }; }
  if (!out || typeof out !== 'object' || typeof out.ok !== 'boolean' || !Array.isArray(out.runs)) return { error: `the rules runner's answer has no verdict (exit ${r?.status ?? 'none'})`, tail };
  const failed = out.runs.filter((x) => x?.result === 'fail');
  // a verdict of "not ok" with no failing rule named is still a fail: the gate never opens on a half answer
  return { ok: out.ok === true, failing: failed.map((x) => str(x.id, 120)), fixed: out.runs.filter((x) => x?.result === 'fixed').map((x) => str(x.id, 120)), detail: failed.map((x) => `${x.id}: ${str(x.detail, 500)}`).join('\n'), ...(out.commit?.sha ? { commit: out.commit.sha } : {}) };
}
export function defaultBuildRules(s) {
  return ({ id, root }) => {
    if (process.env.AXF_LANDER_BUILD_RULES === 'off') return { skipped: 'switched off (AXF_LANDER_BUILD_RULES=off)' };
    const runner = buildRulesProvider(s.repo);
    if (!runner) return { skipped: 'no build-rules provider installed' };
    const r = spawnSync(process.execPath, [runner, 'run', '--build', id, '--phase', 'gate', '--by', 'lander', '--json', ...(root ? ['--root', root, '--commit'] : [])], { cwd: s.repo, encoding: 'utf8', timeout: 20 * 60e3, maxBuffer: 64 << 20 });
    return readRulesAnswer(r);
  };
}

/**
 * Build rules in a temporary worktree of the PR branch; a fixer's commit is pushed (a new head: CI runs again).
 * Always one of the three answers: a worktree that can't be made, or a runner that answers nothing, is `error`.
 */
export function rulesOnBranch({ s, git, b, branch, buildRules }) {
  const dir = mkdtempSync(join(tmpdir(), 'axf-lander-rules-')); const wt = join(dir, 'wt');
  try {
    const w = git(['worktree', 'add', '-q', '-B', `lander-rules/${b.id}`, wt, `${s.remote}/${branch}`]);
    if (w.code) return { error: `no worktree of ${branch} for the rules: ${w.err.slice(-160)}`, tail: '' };
    const before = git(['rev-parse', 'HEAD'], { cwd: wt }).out;
    let r; try { r = buildRules({ id: b.id, root: wt }); } catch (e) { r = { error: `the rules runner threw: ${str(e.message, 160)}`, tail: '' }; }
    if (!r || typeof r !== 'object' || (!r.skipped && !r.error && typeof r.ok !== 'boolean')) return { error: 'the rules runner gave no answer', tail: '' };
    if (r.skipped || r.error) return r;
    const after = git(['rev-parse', 'HEAD'], { cwd: wt }).out;
    if (after && after !== before) {
      const p = git(['push', '-q', s.remote, `HEAD:refs/heads/${branch}`], { cwd: wt, timeout: 90000 });
      if (!p.code) { git(['fetch', '-q', s.remote, `+refs/heads/${branch}:refs/remotes/${s.remote}/${branch}`]); return { ...r, pushed: after }; }
    }
    return r;
  } finally { git(['worktree', 'remove', '--force', wt]); git(['branch', '-D', `lander-rules/${b.id}`]); rmSync(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------ one tick

/** The PR branch of the group in flight (or the next one): lander/<build>[-k], k = PRs opened so far + 1. */
const branchFor = (b, opened) => L.groupBranch(b.id, opened);
const openedCount = (b) => { const l = L.landingOf(b); return l.merged.length + l.closed.length; };
/** What a new head starts without: the CI and rules records of the old one. */
const NEW_HEAD = Object.freeze({ reruns: null, rules: null, ciKick: null, fullKick: null, green: null });

/**
 * One tick. Everything injectable for tests: s (settings), git, gh, store ({ read, write }), cfg, now, fixSession,
 * buildRules, say (crew chat). `syncOnly`: nothing is worked on; every build with a PR in flight only hears what
 * GitHub says about that PR (syncPrs). → { at, build, status, actions: [text], waiting: text, error }
 */
export async function tick({ s = settings(), git = G.makeGit(s.repo), gh = G.makeGitHub(s), store, cfg = readConfig(s), now = nowIso, fixSession = defaultFixSession(s), buildRules = defaultBuildRules(s), say = (ev, text, ref) => sayLanding(s.repo, ev, text, ref), dry = false, only = '', syncOnly = false, log = () => {} } = {}) {
  const at = now();
  const out = { $axf: 'lander-tick@1', at, build: '', status: '', actions: [], waiting: '', error: '', others: [] };
  if (!cfg.enabled) { out.waiting = 'the lander is switched off (config enabled: false)'; return out; }
  const ctl = readControl(s);
  // paused = no new work; recording what GitHub already did to a PR (syncOnly) is not work
  if (ctl.paused && !syncOnly) { out.waiting = 'paused'; return out; }
  if (ctl.runRequested && !dry && !syncOnly) G.writeJson(files(s).control, { ...ctl, runRequested: '' });
  store ??= dry ? memoryStore((await makeStore()).read()) : await makeStore({ by: 'lander', repo: s.repo });
  const all = store.read();
  const scope = only ? all.filter((b) => b.id === only) : all;
  const pick = L.pickBuild(scope);
  out.others = pick.others;
  if (pick.others.length) log(`more than one build waits to land (${pick.others.join(', ')}): one at a time, ${pick.build.id} first${L.isEmergency(pick.build) ? ' (emergency build: front of the line)' : ''}`);
  if (!pick.build) { out.waiting = 'nothing to land'; return out; }
  out.build = pick.build.id;
  const f = git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  if (f.code) log(`fetch: ${f.err.slice(-200)}`);

  const prOf = async (n) => { try { return await gh('GET', `/repos/${s.slug}/pulls/${n}`); } catch (e) { log(`PR #${n}: ${e.message}`); return null; } };
  /** Every check run on a commit: all pages, never the first hundred only. */
  const checksOf = async (sha) => {
    const runs = [];
    for (let page = 1; page <= 50; page++) {
      const r = await gh('GET', `/repos/${s.slug}/commits/${sha}/check-runs?per_page=100&page=${page}`);
      const list = Array.isArray(r?.check_runs) ? r.check_runs : [];
      runs.push(...list);
      if (list.length < 100 || runs.length >= (Number(r?.total_count) || Infinity)) break;
    }
    return runs;
  };
  /** The tail of the failing jobs' logs (the fix brief, the one-step rule). '' when GitHub does not hand it over. */
  const logOf = async (jobIds) => {
    const parts = [];
    for (const id of (jobIds || []).slice(0, 2)) { const t = gh.text ? await gh.text(`/repos/${s.slug}/actions/jobs/${id}/logs`, L.LOG_TAIL) : ''; if (t) parts.push(t); }
    return parts.join('\n').slice(-L.LOG_TAIL);
  };
  /**
   * What GitHub says about CI on a PR someone merged by hand: the full run on its head, else on the merge commit, else
   * on main's newest commit when that holds the merge (main is green again with the merged code in it). Light PR checks
   * alone are not CI.
   */
  const handCi = async (head, mergeSha) => {
    const seen = [];
    const mainHead = git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${s.base}`]).out;
    const onMain = mergeSha && mainHead && mainHead !== mergeSha && git(['merge-base', '--is-ancestor', mergeSha, mainHead]).code === 0;
    for (const sha of [...new Set([head, mergeSha, onMain ? mainHead : ''].filter(Boolean))]) {
      try {
        const runs = await checksOf(sha);
        const c = L.lightOnly(runs) ? 'none' : L.ciOf(runs, { required: cfg.requiredChecks }).ci;
        if (c === 'success') return 'success';
        seen.push(c);
      } catch (e) { log(`CI on ${sha.slice(0, 9)}: ${e.message}`); seen.push('unknown'); }
    }
    return seen.includes('running') || seen.includes('missing') ? 'running' : seen.includes('failure') ? 'failure' : seen.includes('unknown') ? 'unknown' : 'none';
  };
  /** Does main hold code the PR branch lacks (it moved since the branch last took it in)? Status-only commits don't count. */
  const mainMoved = (branch) => G.codeBehind({ s, git, br: branch });

  /** One build: the picked one goes through its phases; any other one (`syncOnly`) only hears what GitHub says about its PR. */
  const run = async (b0, { syncOnly = false } = {}) => {
    let b = b0;
    const act = (text) => { out.actions.push(syncOnly ? `${b.id}: ${text}` : text); log(L.say(b, text)); };
    /** Write a change; a write the store refuses or drops stops the tick (said, never silent). */
    const write = (change) => {
      if (dry && store.list === undefined) return true;
      // a stopped build that goes on (its PR was merged or reopened by hand, CI went green on a hand merge) is a reset
      // with its reason: the only way the store lets a build out of `failed` at the attempt ceiling
      const ch = L.isHeld(b) && change.status && change.status !== 'failed' && change.note ? { ...L.RESET, ...change } : change;
      const r = store.write(b.id, ch);
      if (r.build) b = r.build;
      if (!r.ok) { out.error = `store: ${r.why || 'write refused'}`; log(L.say(b, out.error)); return false; }
      return true;
    };
    const rerunsOn = (head) => (head && b.landing?.reruns?.head === head ? Number(b.landing.reruns.n) || 0 : 0);
    /** A failure: status failed, the landing run's attempt N, the failure record; posted once attempts pile up or it stops. */
    const fail = (kind, ctx = {}) => {
      const g = L.groupState(b);
      const pr = ctx.pr ?? g.inFlight?.pr ?? 0;
      const fr = L.failure(b, kind, { at, status: L.failedIn(b), groupSize: g.inFlight?.steps.length || 1, reruns: rerunsOn(ctx.head), fixes: L.fixesOf(b, pr), ...ctx, pr }, cfg);
      const held = fr.failure.retry === 'hold';
      const next = held ? `stopped (${fr.failure.stopped}): needs Brett` : `next: ${fr.failure.retry} at ${fr.failure.notBefore}`;
      act(`failed in ${fr.failure.status}, attempt ${fr.attempt}: ${fr.failure.why} (${next})`);
      // the build's `attempt` carries the landing run's count while landing: the store's attempt ceiling reads it there
      write({ status: 'failed', attempt: fr.attempt, failure: fr.failure, landing: { attempt: fr.attempt }, note: `Lander: failed in ${fr.failure.status}, attempt ${fr.attempt}: ${fr.failure.why}${held ? ` Stopped (${fr.failure.stopped}): needs Brett. Start it again: node deploy/lander/run.mjs retry ${b.id}` : ''}` });
      if (!dry && held) say('failed', `${b.id}: stopped after attempt ${fr.attempt} (${fr.failure.kind} in ${fr.failure.status}): ${fr.failure.stopped}. ${fr.failure.why} Needs Brett; start it again with: lander retry ${b.id}.`, b.id);
      else if (!dry && L.shouldNotify(fr.attempt, cfg)) say('failed', `${b.id}: failed, attempt ${fr.attempt} of ${cfg.maxAttempts} (${fr.failure.kind} in ${fr.failure.status}). The lander retries by itself: ${fr.failure.retry}.`, b.id);
      return 'stop';
    };

    /** landed: the evidence, then the clean-up (step branches and worktrees that are on main, the fix worktree). */
    const land = async () => {
      const merged = L.landingOf(b).merged;
      const m = b.landing?.lastMerge;
      if (m?.byHand && m.ci !== 'success' && !dry) {
        const ci = await handCi(m.head, m.sha);
        if (ci !== m.ci && !write({ landing: { lastMerge: { ...m, ci } } })) return 'stop';
        // CI still running on a hand merge is waited for, but never for ever: past the CI timeout it is "not green"
        if (ci === 'running' && !L.ciTimedOut(m.at, at, cfg)) { out.waiting = `PR #${m.pr} was merged by hand: waiting for CI on it`; return 'stop'; }
        if (ci !== 'success') return fail('hand-merge', { status: 'merging-pr', pr: m.pr, head: m.head, why: `PR #${m.pr} was merged by hand and CI is ${ci === 'failure' ? 'red' : ci === 'running' ? `not finished after ${cfg.ciTimeoutMin} min` : 'not there'} on it (${str(m.head || m.sha, 9)}): main may be red, and the build is not landed until CI is green on that merge, or on main with it in. If Brett has checked main himself: node deploy/lander/run.mjs accept ${b.id} --by <who> --why "<what was checked>".` });
      }
      if (!write({ status: 'landed', failure: null, ...L.landedEvidence(b, at), note: `Lander: landed (${merged.map((n) => `#${n}`).join(', ')}).` })) return 'stop';
      act('landed');
      if (!dry) {
        if (cfg.cleanup) {
          const c = G.cleanupLanded({ s, git, branches: L.landSteps(b).map((st) => L.stepBranch(b, st)), extra: [fixWorktree(b.id)], log });
          if (c.branches.length || c.worktrees.length) act(`cleaned up: ${c.branches.length} step branch(es), ${c.worktrees.length} worktree(s)`);
          for (const k of c.kept) log(L.say(b, `kept ${k.branch}: ${k.why}`));
        }
        say('done', `${b.id} landed: ${merged.map((n) => `#${n}`).join(', ')} on main.`, b.id);
      }
      return 'stop';
    };

    /**
     * GitHub's word on the PR in flight, first thing in every tick: a PR someone merged by hand is recorded as merged
     * (sha, head, what its CI says) and the build goes on; a PR closed without merging stops the build once, until it
     * is reopened or re-sent. → the phase to go on in, or '' (the PR is open: nothing to say).
     */
    const syncPr = async () => {
      const g = L.groupState(b); if (!g.inFlight || dry) return '';
      const n = g.inFlight.pr;
      const pr = await prOf(n); if (!pr) return '';
      const closedHold = L.isHeld(b) && b.failure?.kind === 'pr-closed' && Number(b.failure.pr) === n;
      if (pr.merged || pr.merged_at) {
        const head = str(pr.head?.sha, 64); const sha = str(pr.merge_commit_sha, 64) || head;
        // the lander's own merge (a tick that died right after it): the head it merged is the head it found green
        const own = L.failedIn(b) === 'merging-main' && !!head && b.landing?.green?.head === head;
        const ci = own ? 'success' : await handCi(head, sha);
        const lastMerge = { pr: n, sha, head, at: str(pr.merged_at, 40) || at, ...(own ? {} : { byHand: true, ci, by: str(pr.merged_by?.login, 80) }) };
        if (!write({ status: 'merging-pr', group: true, failure: null, landing: { merged: [...new Set([...L.landingOf(b).merged, n])], lastMerge, ...NEW_HEAD, mainPull: null, fixes: null }, note: own ? `Lander: PR #${n} is merged (${sha.slice(0, 9)}).` : `Lander: PR #${n} was merged by hand${lastMerge.by ? ` by ${lastMerge.by}` : ''} (${sha.slice(0, 9)}, CI ${ci}): recorded, the build goes on.` })) return 'stop';
        act(own ? `PR #${n} is merged` : `PR #${n} was merged by hand (${sha.slice(0, 9)}, CI ${ci}): recorded`);
        git(['push', '-q', s.remote, '--delete', branchFor(b, openedCount(b))]);
        return 'merging-pr';
      }
      if (pr.state === 'closed') {
        // the lander closes a PR itself when it splits: that retry records it
        if (closedHold || b.failure?.retry === 'split') return '';
        return fail('pr-closed', { pr: n, why: `PR #${n} was closed without merging. Reopen it and the lander goes on; or re-send the build (lander retry ${b.id}) and a new PR is opened.` });
      }
      if (closedHold) {
        if (!write({ status: 'pr-pulling-main', failure: null, landing: { attempt: 0, fixes: null, ...NEW_HEAD }, note: `Lander: PR #${n} was reopened: the build goes on.` })) return 'stop';
        act(`PR #${n} was reopened: going on`);
        return 'pr-pulling-main';
      }
      return '';
    };

    /** A stopped build: nothing is retried. A hand merge that waits for green CI is read again (CI may have been re-run). */
    const held = async () => {
      const fr = b.failure || {}; const m = b.landing?.lastMerge;
      if (fr.kind === 'hand-merge' && m?.byHand && !dry) {
        const ci = await handCi(m.head, m.sha);
        if (ci === 'success') {
          if (!write({ status: 'merging-pr', failure: null, landing: { lastMerge: { ...m, ci } }, note: `Lander: CI is green on the hand-merged PR #${m.pr}.` })) return 'stop';
          act(`CI is green on the hand-merged PR #${m.pr}`);
          return 'merging-pr';
        }
      }
      out.waiting = `stopped, needs Brett (${fr.stopped || fr.kind}): ${str(fr.why, 300)} Start it again: node deploy/lander/run.mjs retry ${b.id}`;
      return 'stop';
    };

    // ---------------------------------------------------------------- the phases
    const phases = {
      /** merging-pr: the next group's step branches into one PR; each step in-pr with its prNumber. */
      async 'merging-pr'() {
        const g = L.groupState(b);
        if (g.inFlight) return 'pr-pulling-main';
        if (!g.waiting.length) return land();
        const branchOf = (st) => L.stepBranch(b, st);
        const sizes = {};
        for (const st of g.waiting) sizes[st.id] = Math.max(0, G.diffLines({ s, git, br: branchOf(st) }));
        const split = L.landingOf(b).split;
        const groups = L.groupSteps(g.waiting, sizes, cfg.sizeCapLines, { split, branchOf });
        const steps = groups[0];
        const k = openedCount(b) + 1; const branch = branchFor(b, k);
        const total = openedCount(b) + groups.length;
        // a landing run starts at build-complete with its own attempt count: what the dispatcher counted before is not the lander's
        const fresh = b.status === 'build-complete' ? { landing: { attempt: 0, fixes: null, ...NEW_HEAD } } : {};
        if (b.status !== 'merging-pr' && !write({ status: 'merging-pr', group: k > 1, ...fresh, note: `Lander: PR ${k} of ${total} (${steps.map((x) => x.id).join(', ')}${split ? ', split after a failure' : ''})` })) return 'stop';
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
        try { runs = await checksOf(head); } catch (e) { out.waiting = `CI can't be read (${e.message})`; return 'stop'; }
        // the CI clocks start at the status change, or at the last pull of main into the PR (a new head: CI starts over)
        const since = [b.statusAt, b.landing?.mainPull?.at].filter(Boolean).sort().pop() || at;
        const startFull = async (why) => {
          if (b.landing?.fullKick?.head === head || dry) return;
          try { await gh('POST', `/repos/${s.slug}/actions/workflows/${cfg.workflow}/dispatches`, { ref: branch }); write({ landing: { fullKick: { head, at } } }); act(`${why} on ${head.slice(0, 9)}: started the full CI run`); } catch (e) { log(`dispatch: ${e.message}`); }
        };
        // light PR checks only (ci-scope: a PR while the old merge queue's repo variable is on): the one CI run must be the
        // full one, so it is dispatched once per head (workflow_dispatch is always full) and only the full run counts
        if (L.lightOnly(runs)) {
          await startFull('only light PR checks');
          if (L.ciTimedOut(since, at, cfg)) return fail('ci-timeout', { why: `no full CI run after ${cfg.ciTimeoutMin} min`, head, pr: g.inFlight.pr });
          out.waiting = 'waiting for the full CI run'; return 'stop';
        }
        const ci = L.ciOf(runs, { required: cfg.requiredChecks });
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
        if (ci.ci === 'failure') {
          const ctx = { why: `CI is red on ${head.slice(0, 9)} (${ci.failing.slice(0, 3).join(', ') || 'checks failed'})`, head, pr: g.inFlight.pr, failing: ci.failing, runIds: ci.runIds, jobIds: ci.jobIds };
          // re-runs and fix sessions used up on a PR of several steps: it splits only when the failing log names one step's files
          if (g.inFlight.steps.length > 1 && rerunsOn(head) >= cfg.flakyReruns && L.fixesOf(b, g.inFlight.pr) >= cfg.maxFixes && !dry) {
            ctx.log = await logOf(ci.jobIds);
            const filesByStep = Object.fromEntries(g.inFlight.steps.map((st) => [st.id, G.changedFiles({ s, git, br: L.stepBranch(b, st) })]));
            ctx.tiedStep = L.tiedStep(ctx.log, filesByStep);
          }
          return fail('ci-red', ctx);
        }
        // nothing red, nothing running, but a required check has not reported on this head: not green yet
        if (ci.ci === 'missing') {
          if (L.ciKickDue(since, at, cfg)) await startFull(`required checks have not reported (${ci.missing.slice(0, 3).join(', ')})`);
          if (L.ciTimedOut(since, at, cfg)) return fail('ci-timeout', { why: `required checks never reported in ${cfg.ciTimeoutMin} min: ${ci.missing.join(', ')}`, head, pr: g.inFlight.pr, failing: ci.missing });
          out.waiting = `waiting for required checks: ${ci.missing.join(', ')}`; return 'stop';
        }
        // green, but on which main? Right before any merge the PR must hold main's newest code: main moved while CI ran
        // (an emergency build cut in and landed, or anything else merged), so the newest main goes into the PR and CI
        // runs again on that head. A code conflict is a clash-main failure: a Fable fix session resolves it, then CI.
        if (!dry && mainMoved(branch)) {
          const r = G.pullMain({ s, git, branch, dry, log });
          if (r.conflicts) return fail('clash-main', { why: `main moved before the merge and conflicts with ${branch} in code (${r.conflicts.slice(0, 4).join(', ')})`, head, pr: g.inFlight.pr });
          if (!r.ok) return fail('infra', { why: r.error, head, pr: g.inFlight.pr });
          if (!write({ landing: { mainPull: { head: r.sha, at }, ...NEW_HEAD }, note: `Lander: main moved since CI ran on ${head.slice(0, 9)}; the newest main is in PR #${g.inFlight.pr} (${str(r.sha, 9)}) and CI runs again before the merge` })) return 'stop';
          act(`main moved since CI ran on ${head.slice(0, 9)}: newest main merged into PR #${g.inFlight.pr} (${str(r.sha, 9)}), CI runs again`);
          out.waiting = 'CI is running on the newest main'; return 'stop';
        }
        // green: the build rules at the gate, once per head (a fixer's commit is a new head: CI again). The gate fails
        // closed: rules that could not run (a crash, a timeout, no JSON) get one more try, then it is a failure
        let rules = b.landing?.rules?.head === head ? b.landing.rules : null;
        const tried = rules?.error ? Number(rules.tries) || 1 : 0;
        if ((!rules || (rules.error && tried < RULES_TRIES)) && !dry) {
          const r = rulesOnBranch({ s, git, b, branch, buildRules });
          rules = r.skipped ? { head, ok: true, failing: [], skipped: str(r.skipped, 120), at }
            : r.error ? { head, ok: false, failing: [], error: str(r.error, 300), tail: str(r.tail, 600), tries: tried + 1, at }
              : { head, ok: r.ok === true, failing: r.failing || [], fixed: r.fixed || [], ...(r.detail ? { detail: str(r.detail, L.LOG_TAIL) } : {}), at };
          if (!write({ landing: { rules } })) return 'stop';
          if (r.pushed) { act(`build rules fixed ${(r.fixed || []).join(', ') || 'files'} and pushed ${r.pushed.slice(0, 9)}: CI runs again`); out.waiting = 'CI is running on the rules fix'; return 'stop'; }
          if (rules.error && rules.tries < RULES_TRIES) { act(`the build rules could not run (${rules.error}): one more try on the next tick`); out.waiting = 'the build rules run again'; return 'stop'; }
        }
        if (rules?.error) return fail('infra', { why: `the build rules could not run on ${head.slice(0, 9)} (${rules.error}), so the gate is not passed.${rules.tail ? ` Last lines: ${rules.tail}` : ''}`, head, pr: g.inFlight.pr });
        if (rules && !rules.ok) return fail('rules', { why: `build rules fail at the gate (${rules.failing.slice(0, 4).join(', ')})`, head, pr: g.inFlight.pr, failing: rules.failing, log: rules.detail });
        if (!dry && b.landing?.green?.head !== head && !write({ landing: { green: { head, at } } })) return 'stop';
        act(`CI green on ${head.slice(0, 9)}${rules?.skipped ? ` (build rules skipped: ${rules.skipped})` : ', build rules pass'}`);
        return 'merging-main';
      },

      /** merging-main: main and the PR head read again from GitHub, then the one merge, sha pinned; then the next group or landed. */
      async 'merging-main'() {
        const g = L.groupState(b); if (!g.inFlight) return 'merging-pr';
        if (b.status !== 'merging-main' && !write({ status: 'merging-main' })) return 'stop';
        const branch = branchFor(b, openedCount(b) + 1);
        if (dry) { out.waiting = `would merge PR #${g.inFlight.pr} at ${git(['rev-parse', `${s.remote}/${branch}`]).out.slice(0, 9)}`; return 'stop'; }
        // right before the merge, never on what the tick fetched minutes ago (the build rules alone may run 20 minutes)
        const stale = G.fetchFresh({ s, git, branch });
        if (stale) return fail('infra', { why: `main could not be read again right before the merge (${stale}): nothing merges blind`, pr: g.inFlight.pr });
        const head = git(['rev-parse', `${s.remote}/${branch}`]).out;
        const pr = await prOf(g.inFlight.pr);
        let mergeSha = '';
        if (pr?.merged_at || pr?.merged) { mergeSha = String(pr.merge_commit_sha || ''); /* merged already (a tick that died after the merge) */ }
        else if (pr?.state === 'closed') return fail('pr-closed', { why: `PR #${g.inFlight.pr} was closed without merging. Reopen it and the lander goes on; or re-send the build (lander retry ${b.id}) and a new PR is opened.`, head, pr: g.inFlight.pr });
        // never a stale head, never an untested one: main moved after CI went green, or the PR head is not the head CI and
        // the rules passed on. Not a failure: the landing run goes back through the main pull and CI (the contract lets a
        // landing run start again at merging-pr)
        else if (b.landing?.green?.head !== head || mainMoved(branch)) {
          const why = b.landing?.green?.head !== head ? `PR #${g.inFlight.pr} is at ${head.slice(0, 9)}, not the head CI went green on` : `main moved after CI went green on ${head.slice(0, 9)}`;
          if (!write({ status: 'merging-pr', group: true, landing: { green: null }, note: `Lander: ${why}; the newest main is pulled and CI runs again before the merge` })) return 'stop';
          act(`${why}: pulling the newest main and running CI again before the merge`);
          return 'pr-pulling-main';
        } else {
          try { const m = await gh('PUT', `/repos/${s.slug}/pulls/${g.inFlight.pr}/merge`, { merge_method: cfg.mergeMethod, sha: head, commit_title: `Merge pull request #${g.inFlight.pr} from ${branch} (lander: ${b.id})`.slice(0, 250) }); mergeSha = String(m?.sha || ''); }
          catch (e) { return fail(e.status === 405 || e.status === 409 ? 'merge' : 'infra', { why: `merging PR #${g.inFlight.pr}: ${e.message}`, head, pr: g.inFlight.pr }); }
        }
        const merged = [...L.landingOf(b).merged, g.inFlight.pr];
        // the merge evidence done-means-merged@1 asks of `landed`: the PR, its merge commit and CI green on the head it merged (sha pinned)
        const lastMerge = { pr: g.inFlight.pr, sha: mergeSha || head, head, at };
        if (!write({ landing: { merged, lastMerge, ...NEW_HEAD, mainPull: null, fixes: null }, failure: null })) return 'stop';
        act(`PR #${g.inFlight.pr} merged into main`);
        git(['push', '-q', s.remote, '--delete', branch]);
        return L.groupState(b).waiting.length ? 'merging-pr' : land();
      },
    };

    /** A failed build whose retry is due: carry the retry out and continue forward. */
    const retry = async () => {
      const fr = b.failure || {};
      const n = fr.attempt || L.landingAttempt(b) || 1;
      if (!L.retryDue(b, at)) { out.waiting = `failed, attempt ${n}: ${fr.retry || 'retry'} at ${fr.notBefore}`; return 'stop'; }
      const g = L.groupState(b);
      const branch = branchFor(b, openedCount(b) + 1);
      if (fr.retry === 'rerun') {
        if (!dry) for (const id of fr.runIds || []) { try { await gh('POST', `/repos/${s.slug}/actions/runs/${id}/rerun-failed-jobs`); } catch (e) { log(`rerun ${id}: ${e.message}`); } }
        if (!fr.runIds?.length && !dry) { try { await gh('POST', `/repos/${s.slug}/actions/workflows/${cfg.workflow}/dispatches`, { ref: branch }); } catch (e) { log(`dispatch: ${e.message}`); } }
        const k = b.landing?.reruns?.head === fr.head ? b.landing.reruns.n + 1 : 1;
        if (!write({ status: 'running-ci', landing: { reruns: { head: fr.head, n: k } }, note: `Lander: attempt ${n}: re-running the failed CI jobs on ${str(fr.head, 9)} (flaky check)` })) return 'stop';
        act(`attempt ${n}: re-ran the failed CI jobs`); out.waiting = 'CI is re-running'; return 'stop';
      }
      if (fr.retry === 'split') {
        if (g.inFlight && !dry) { try { await gh('PATCH', `/repos/${s.slug}/pulls/${g.inFlight.pr}`, { state: 'closed' }); } catch (e) { log(`close #${g.inFlight.pr}: ${e.message}`); } }
        const closed = g.inFlight ? [...L.landingOf(b).closed, g.inFlight.pr] : L.landingOf(b).closed;
        const tied = fr.tiedStep ? ` (the red check names step ${fr.tiedStep}'s files)` : '';
        if (!write({ status: 'merging-pr', landing: { split: true, closed, ...NEW_HEAD, mainPull: null, fixes: null }, note: `Lander: attempt ${n}: split${g.inFlight ? ` PR #${g.inFlight.pr}` : ''}${tied}; its steps land one PR each` })) return 'stop';
        act(`attempt ${n}: split${g.inFlight ? ` PR #${g.inFlight.pr}` : ''} into one PR per step${tied}`); return 'merging-pr';
      }
      if (fr.retry === 'fix') {
        const head = git(['rev-parse', `${s.remote}/${branch}`]).out;
        const pr = g.inFlight?.pr || fr.pr || 0;
        const src = fr.of?.kind ? fr.of : fr;
        if (fr.fix?.at) {
          if (head && head !== fr.fix.head) { if (!write({ status: 'running-ci', note: `Lander: the fix pushed ${head.slice(0, 9)}; CI runs on it` })) return 'stop'; act(`the fix pushed ${head.slice(0, 9)}`); return 'running-ci'; }
          if (L.fixTimedOut(fr.fix, at, cfg)) return fail('fix-timeout', { why: `fix session ${fr.fix.n || 1} (${fr.fix.session || 'no session name'}) pushed nothing to ${branch} in ${cfg.fixTimeoutMin} min`, head, pr, of: src });
          out.waiting = `fix session ${fr.fix.n || 1}${fr.fix.session ? ` (${fr.fix.session})` : ''} works on ${branch} (${fr.fix.model || FIX_MODEL}, since ${fr.fix.at})`; return 'stop';
        }
        if (dry) { out.waiting = `would start a fix session on ${branch}`; return 'stop'; }
        const k = L.fixesOf(b, pr) + 1;
        const text = src.log || (src.jobIds?.length ? await logOf(src.jobIds) : '');
        let job;
        try { job = fixSession({ git, b, f: fr, branch, pr, log: text, n: k, of: cfg.maxFixes }) || {}; } catch (e) { job = { exit: 1, why: str(e.message, 200) }; }
        if (job.exit !== 0) {
          // not started = nothing is working on it: say so, and try again on the next tick, not after the fix timeout
          const why = str(job.why, 200) || `the launcher exited ${job.exit ?? 'with nothing'}`;
          const tries = (Number(fr.fixStart?.n) || 0) + 1;
          if (tries >= cfg.fixStartTries) return fail('fix-start', { why: `the fix session did not start, ${tries} ticks running: ${why}`, head, pr, of: src });
          write({ failure: { ...fr, fixStart: { n: tries, at, why } } });
          act(`fix session did not start: ${why} (try ${tries} of ${cfg.fixStartTries}, again on the next tick)`);
          out.waiting = `fix session did not start: ${why}`; return 'stop';
        }
        const { fixStart, ...rest } = fr;
        if (!write({ failure: { ...rest, fix: { at, head, session: str(job.session, 120), n: k, model: job.model || FIX_MODEL, ...(job.queued ? { queued: true } : {}) } }, landing: { fixes: { pr, n: k } }, note: `Lander: attempt ${n}: fix session ${k} of ${cfg.maxFixes} on ${branch} (${job.model || FIX_MODEL}${job.session ? `, ${job.session}` : ''})` })) return 'stop';
        act(`attempt ${n}: fix session ${k} of ${cfg.maxFixes} ${job.queued ? 'waits for a slot' : 'started'} on ${branch} (${job.model || FIX_MODEL}${job.session ? `, ${job.session}` : ''})`);
        out.waiting = `fix session ${k}${job.session ? ` (${job.session})` : ''} works on ${branch}`; return 'stop';
      }
      const to = L.retryStatus(fr);
      // rules that could not run are run again on the retry, never read back from the record
      if (!write({ status: to, ...(b.landing?.rules?.error ? { landing: { rules: null } } : {}), note: `Lander: attempt ${n}: retrying ${to}` })) return 'stop';
      act(`attempt ${n}: retrying ${to}`);
      return to;
    };

    try {
      let next = await syncPr();
      if (syncOnly) { if (!next && L.isHeld(b) && b.failure?.kind === 'hand-merge') await held(); return b; }
      if (!next) next = L.isHeld(b) ? await held() : b.status === 'failed' ? await retry() : b.status === 'build-complete' ? 'merging-pr' : b.status;
      for (let i = 0; i < 12 && next && next !== 'stop'; i++) {
        const fn = phases[next];
        if (!fn) break;
        next = await fn();
      }
    } catch (e) { out.error = str(e.stack || e.message, 600); log(L.say(b, `tick failed: ${e.message}`)); }
    return b;
  };

  // GitHub's word on every other PR in flight first (a hand merge or a closed PR is seen even while another build lands)
  const others = new Set(syncOnly ? [pick.build.id, ...pick.others] : pick.others);
  for (const o of scope.filter((x) => others.has(x.id) && L.groupState(x).inFlight)) { await run(o, { syncOnly: true }); out.waiting = ''; }
  if (syncOnly) { out.build = ''; try { gh.save?.(); } catch { /* cache only */ } return out; }
  const b = await run(pick.build);
  try { gh.save?.(); } catch { /* cache only */ }
  out.status = b.status;
  return out;
}

/**
 * GitHub's word on every PR in flight, outside the timer's tick: the builds reconciler's safety net
 * (framework/cli/builds-reconcile.mjs), and `run.mjs sync-prs`. The same rule as the tick's first step, under the same
 * lock (a tick that is running already does it). → { ok, actions: [text], error, skipped }
 */
export async function syncPrs(opts = {}) {
  const s = opts.s || settings();
  const lock = opts.lock === false ? { ok: true, release: () => {} } : takeLock(files(s).lock);
  if (!lock.ok) return { ok: true, actions: [], error: '', skipped: 'a lander tick is running: it reads the PRs itself' };
  try { const r = await tick({ ...opts, s, syncOnly: true }); return { ok: !r.error, actions: r.actions, error: r.error, skipped: '' }; }
  finally { lock.release(); }
}

// ------------------------------------------------------------------ CLI

/** Status for the console (gate plugin's Auto-lander tab and systems check): service, the build landing, the queue. */
export async function status(s = settings(), { store } = {}) {
  store ??= await makeStore({ repo: s.repo });
  const svc = G.readJson(files(s).service, {}) || {};
  const ctl = readControl(s);
  const builds = store.read();
  const rows = L.queueRows(builds);
  const current = rows.find((r) => L.LANDING.includes(r.status === 'failed' ? r.failure?.status : r.status)) || null;
  const cfg = readConfig(s);
  return {
    ok: true, $axf: 'lander-status@1',
    service: { lastTick: svc.at || '', result: svc.result || '', build: svc.build || '', error: svc.error || '', paused: ctl.paused === true, pausedAt: ctl.pausedAt || '', pausedBy: ctl.pausedBy || '' },
    current: current?.build || '', queue: rows.map((r) => r.build), builds: rows,
    failing: rows.filter((r) => r.status === 'failed' && !r.needsBrett && r.attempt >= cfg.notifyAfterAttempts).map((r) => ({ build: r.build, attempt: r.attempt, kind: r.failure?.kind || '', why: r.failure?.why || '', since: r.statusAt, pr: r.prs.at(-1)?.pr || null })),
    escalations: L.escalations(builds), settings: cfg,
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
  if (cmd === 'sync-prs') { const r = await syncPrs({ s, log: (l) => { if (!json) console.log(`[lander] ${l}`); } }); if (!r.ok) process.exitCode = 1; return print(r, r.skipped || r.error || r.actions.join(' · ') || 'every PR in flight is open: nothing to record'); }
  if (cmd === 'status') { const st = await status(s); return print(st, `lander: ${st.service.paused ? 'paused' : 'on'}, last tick ${st.service.lastTick || 'never'}; landing ${st.current || 'nothing'}; ${st.queue.length} in the queue`); }
  if (cmd === 'queue') { const st = await status(s); return print({ ok: true, rows: st.builds }, st.builds.map((r) => `${r.status.padEnd(16)} ${r.build}${r.attempt ? ` (attempt ${r.attempt})` : ''}${r.prs.length ? ` ${r.prs.map((p) => `#${p.pr}`).join(' ')}` : ''}`).join('\n') || 'nothing waits to land'); }
  if (cmd === 'show') {
    const id = rest.find((x) => !x.startsWith('--'));
    const b = (await makeStore({ repo: s.repo })).read().find((x) => x.id === id);
    if (!b) { process.exitCode = 2; return print({ ok: false, error: `no build ${id || '<build>'}` }, `no build ${id || '<build>'}`); }
    const row = L.queueRows([b])[0] || null;
    const n = L.landingAttempt(b);
    return print({ ok: true, build: id, row, status: b.status, attempt: n, needsBrett: L.isHeld(b), failure: b.failure || null, statusLog: b.statusLog || [], landing: L.landingOf(b) }, `${id}: ${b.status}${n ? ` (landing attempt ${n})` : ''}${L.isHeld(b) ? ` · stopped, needs Brett: ${b.failure?.stopped || ''}` : ''}\n${(b.statusLog || []).map((x) => `  ${x.at} ${x.status} by ${x.by}${x.why || x.note ? ` · ${x.why || x.note}` : ''}`).join('\n')}`);
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
    const id = rest.find((x) => !x.startsWith('--') && x !== flag('--by'));
    const store = await makeStore({ repo: s.repo });
    const b = store.read().find((x) => x.id === id);
    if (!b || b.status !== 'failed') return print({ ok: false, error: `${id || '<build>'} is not failed` }, `${id || '<build>'} is not failed`);
    // a stopped build is re-sent (a new landing run); any other failed build's retry is simply due now
    const release = L.releaseHold(b, { at: nowIso(), by: flag('--by') || 'cli' });
    const r = store.write(b.id, release || { failure: { ...b.failure, notBefore: nowIso() } });
    return print({ ok: r.ok, build: id, resent: !!release }, r.ok ? `${id}: ${release ? `re-sent, a new landing run starts at ${release.status}` : 'the retry is due now'} (the next tick)` : r.why);
  }
  if (cmd === 'accept') {
    // the one hand-recorded verdict: a PR merged by hand whose CI the lander cannot find green, vouched for by a person
    const id = rest.find((x) => !x.startsWith('--') && x !== flag('--by') && x !== flag('--why'));
    const by = flag('--by'); const why = flag('--why');
    const store = await makeStore({ repo: s.repo });
    const b = store.read().find((x) => x.id === id);
    const ch = b ? L.acceptHandMerge(b, { by, why }) : null;
    const bad = !b ? `no build ${id || '<build>'}` : ch?.error || '';
    if (bad) { process.exitCode = 2; return print({ ok: false, error: bad }, bad); }
    const r = store.write(b.id, ch);
    return print({ ok: r.ok, build: id }, r.ok ? `${id}: accepted; it lands on the next tick` : r.why);
  }
  console.error('usage: run.mjs tick [--dry-run] [--only <build>] | status | queue | config | pause | resume | retry <build> | show <build> [--json]');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
