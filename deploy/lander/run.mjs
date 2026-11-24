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
 *   An emergency build is picked first (front of the line).
 *   The merge rule (Brett, Nov 24 2026): a green PR is always merged as it is first, pinned to the head CI went green
 *   on. Main having moved is no reason to pull it in or to run CI again; only a merge GitHub refuses (a conflict, a
 *   head that changed) makes the lander pull main into the PR and run CI again, by itself. A build that already has
 *   its own open PR (a hand build's session opened it) lands on that PR: no second PR, no second CI run.
 *   The merge line is written to the builds store (`mergeLine: { position, waitingFor }` on every build in it), and
 *   every landing state the lander writes (waiting-to-merge, merging, running-ci, landed, failed attempt N) is followed
 *   by one best-effort update command to the console (POST /api/builds/updated { build, state, rev, at }).
 *   Merge together (`merge-together`): every build waiting at build-complete goes into one branch and one PR, CI runs
 *   once and they merge in one go; a build that clashes in code is left out and lands by itself.
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
 *   … merge-together [--builds a,b] [--off] [--by who]      combine every build waiting to merge into one PR on the next tick
 *                                                           (one CI run, one merge; a clashing build lands by itself)
 *   … line [--json]                                         the merge line: each build's place and the build it waits for
 * Environment: AXF_LANDER_DIR (data folder: service heartbeat, control, GitHub cache, fix briefs; default
 * <AXF_CONSOLE_ROOT or /opt/axf>/.axf-console/lander), AXF_LAND_REPO (checkout to run git in), AXF_LAND_REPO_SLUG
 * (MossesX/AmberX-AXF), AXF_LAND_GITHUB_API, AXF_LANDER_SIZE_CAP (lines, overrides the config), AXF_LANDER_BUILD_RULES=off,
 * AXF_LANDER_FIX_LAUNCHER, AXF_CREW_SAY=off, AXF_LANDER_NOTIFY=off (no update command), AXF_CONSOLE_URL + AXF_TOKEN (where
 * the update command goes; default: the DOMAIN and AXF_TOKEN lines of <console root>/.axf-console/env).
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

/**
 * The update command (the same one the pipeline sends): POST <console base>/api/builds/updated { build, state, rev, at }.
 * The console fans it out to every open screen (GET /api/builds/events), which re-read the builds store. Best effort:
 * a short timeout, no retry, and a console that is down never slows or fails a landing. The base and the token come
 * from AXF_CONSOLE_URL / AXF_TOKEN, else from the console's own env file beside the lander's data folder (DOMAIN,
 * AXF_TOKEN). → a function (event) → Promise<boolean>; with no base it sends nothing.
 */
export const NOTIFY_TIMEOUT_MS = 2500;
export function consoleTarget(s, e = process.env) {
  const file = {};
  try { for (const line of readFileSync(join(dirname(s.dataDir), 'env'), 'utf8').split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) file[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } } catch { /* no env file: only the environment */ }
  const base = str(e.AXF_CONSOLE_URL || (file.DOMAIN ? `https://${file.DOMAIN}` : ''), 300).replace(/\/+$/, '');
  return { base, token: str(e.AXF_TOKEN || file.AXF_TOKEN, 400) };
}
export function defaultNotify(s, { fetch: f = globalThis.fetch, env: e = process.env } = {}) {
  if (e.AXF_LANDER_NOTIFY === 'off') return async () => false;
  let target = null;
  return async (event) => {
    target ??= consoleTarget(s, e);
    if (!target.base || !/^https?:\/\//.test(target.base)) return false;
    try {
      const r = await f(`${target.base}/api/builds/updated`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', 'User-Agent': 'axf-lander', ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}) }, body: JSON.stringify(event), signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS) });
      return r.ok;
    } catch { return false; }
  };
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
 * buildRules, say (crew chat), notify (the update command to the console). `syncOnly`: nothing is worked on; every build with a PR in flight only hears what
 * GitHub says about that PR (syncPrs). → { at, build, status, actions: [text], waiting: text, error }
 */
export async function tick({ s = settings(), git = G.makeGit(s.repo), gh = G.makeGitHub(s), store, cfg = readConfig(s), now = nowIso, fixSession = defaultFixSession(s), buildRules = defaultBuildRules(s), say = (ev, text, ref) => sayLanding(s.repo, ev, text, ref), notify = defaultNotify(s), dry = false, only = '', syncOnly = false, log = () => {} } = {}) {
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

  /** What the store holds of each build, as this tick last saw or wrote it. */
  const known = new Map(all.map((b) => [b.id, b]));
  const sent = [];
  /**
   * One write to one build, and the update command after it when the write changed what a screen shows: the landing
   * state (waiting-to-merge, merging, running-ci, landed, failed attempt N), or the build's place in the merge line.
   * One command per change; never awaited inside the landing (the tick waits for them at its very end, each on its
   * own short timeout).
   */
  const put = (id, change) => {
    const before = known.get(id) || null;
    const r = store.write(id, change);
    if (r.build) known.set(id, r.build);
    const after = r.build || null;
    const shown = (x) => (x ? `${L.landingState(x)}|${x.status === 'failed' ? L.rowAttempt(x) : ''}|${L.storedLine(x)?.position || 0}>${L.waitsFor(L.storedLine(x))}` : '');
    if (after && !dry && L.landingState(after) && shown(after) !== shown(before)) {
      const event = { build: id, state: L.landingState(after), rev: Number(after.rev) || 0, at, ...(after.status === 'failed' ? { attempt: L.rowAttempt(after) } : {}) };
      try { sent.push(Promise.resolve(notify(event)).catch(() => false)); } catch { /* the command is a courtesy: the store is the truth */ }
    }
    return r;
  };
  /** The tick's last step, on every way out: the update commands it sent have had their (short) time. */
  const done = async () => { if (sent.length) await Promise.allSettled(sent); try { gh.save?.(); } catch { /* cache only */ } return out; };

  /**
   * The merge line into the store: every build in the line carries its place and the build it waits for; a build that
   * left the line (landed, stopped for Brett, archived) loses it. Only what changed is written. A store that does not
   * keep the field (an older builds@1 normalizer) is asked once per tick, never in a loop.
   */
  let lineKept = store.keeps?.mergeLine !== false;
  if (!lineKept) log('the builds store does not keep `mergeLine` yet (its builds@1 contract does not name it): the merge line is not written');
  const syncLine = () => {
    if (dry || syncOnly || only || !lineKept) return;
    const now_ = store.read();
    for (const x of now_) known.set(x.id, x);
    const line = L.mergeLine(now_);
    for (const x of now_) {
      const want = line.get(x.id) || null;
      if (L.sameLine(L.storedLine(x), want)) continue;
      const r = put(x.id, { mergeLine: want });
      if (want && r.build && !L.storedLine(r.build)) { lineKept = false; log('the builds store does not keep `mergeLine` yet (its builds@1 normalizer drops it): the merge line is not on the records'); break; }
    }
  };

  let pick = L.pickBuild(scope);
  out.others = pick.others;
  if (pick.others.length) log(`more than one build waits to land (${pick.others.join(', ')}): one at a time, ${pick.build.id} first${L.isEmergency(pick.build) ? ' (emergency build: front of the line)' : ''}`);
  if (!pick.build) { out.waiting = 'nothing to land'; syncLine(); return done(); }
  out.build = pick.build.id;
  // the line as it stands before any work: a build that just finished shows "waiting to merge" and its place at once
  syncLine();
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
  /** The branch of each PR this tick has seen (a PR's own head ref: the lander's lander/… branch, or the build's own). */
  const branchByPr = new Map();

  /** One build: the picked one goes through its phases; any other one (`syncOnly`) only hears what GitHub says about its PR. */
  const run = async (b0, { syncOnly = false } = {}) => {
    let b = b0;
    const act = (text) => { out.actions.push(syncOnly ? `${b.id}: ${text}` : text); log(L.say(b, text)); };
    /** Set by a retry after a refused merge: this time main does go into the PR (the merge rule's "only then"). */
    let pullNow = false;
    /**
     * The branch of the PR in flight: the PR's own head ref, as GitHub has it (the lander's lander/<build> branch, the
     * build's own branch when its own PR was taken, a merge-together branch). GitHub not answering: the lander's branch
     * when it exists, else the one branch the steps share.
     */
    const prBranch = async (pr = null) => {
      const g = L.groupState(b); const mine = branchFor(b, openedCount(b) + 1);
      if (!g.inFlight) return mine;
      const n = g.inFlight.pr;
      if (branchByPr.has(n)) return branchByPr.get(n);
      const p = Number(pr?.number) === n ? pr : await prOf(n);
      const ref = str(p?.head?.ref, 250);
      if (ref) { branchByPr.set(n, ref); return ref; }
      if (!git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${mine}`]).code) return mine;
      return L.ownBranch(b, g.inFlight.steps) || mine;
    };
    /** The other builds in this build's PR (merge together): what the PR goes through, they go through. */
    const mates = () => { const pr = L.prInFlight(b); return pr ? [...known.values()].filter((x) => x.id !== b.id && !x.deleted && L.isLanding(x) && L.prInFlight(x) === pr) : []; };
    /**
     * Merge together undone (the PR stopped for Brett, was closed, or is split): the PR is closed and every other build
     * in it goes back to land by itself, one at a time.
     */
    const dissolve = async (why) => {
      const pr = L.prInFlight(b); const others = mates();
      if (!pr || !others.length) return;
      if (!dry) { try { await gh('PATCH', `/repos/${s.slug}/pulls/${pr}`, { state: 'closed' }); } catch (e) { log(`close #${pr}: ${e.message}`); } }
      for (const m of others) put(m.id, { status: 'merging-pr', group: true, failure: null, landing: { closed: [...new Set([...L.landingOf(m).closed, pr])], ...NEW_HEAD, mainPull: null, fixes: null }, note: `Lander: merge together (PR #${pr}) was undone (${str(why, 200)}): this build lands by itself` });
      act(`merge together (PR #${pr}) undone (${why}): ${others.map((m) => m.id).join(', ')} land one at a time`);
    };
    /** Write a change; a write the store refuses or drops stops the tick (said, never silent). */
    const write = (change) => {
      if (dry && store.list === undefined) return true;
      // a stopped build that goes on (its PR was merged or reopened by hand, CI went green on a hand merge) is a reset
      // with its reason: the only way the store lets a build out of `failed` at the attempt ceiling
      const ch = L.isHeld(b) && change.status && change.status !== 'failed' && change.note ? { ...L.RESET, ...change } : change;
      // merge together: the PR's phase is every build's phase (best effort: only the build at the front owns the ladder)
      const others = ch.status && L.GROUP_FLOW.includes(ch.status) && !syncOnly ? mates() : [];
      const r = put(b.id, ch);
      if (r.build) b = r.build;
      if (!r.ok) { out.error = `store: ${r.why || 'write refused'}`; log(L.say(b, out.error)); return false; }
      for (const m of others) if (m.status !== ch.status || ch.group === true) put(m.id, { status: ch.status, ...(ch.group === true ? { group: true } : {}) });
      return true;
    };
    const rerunsOn = (head) => (head && b.landing?.reruns?.head === head ? Number(b.landing.reruns.n) || 0 : 0);
    /** A failure: status failed, the landing run's attempt N, the failure record; posted once attempts pile up or it stops. */
    const fail = async (kind, ctx = {}) => {
      const g = L.groupState(b);
      const pr = ctx.pr ?? g.inFlight?.pr ?? 0;
      const fr = L.failure(b, kind, { at, status: L.failedIn(b), groupSize: g.inFlight?.steps.length || 1, reruns: rerunsOn(ctx.head), fixes: L.fixesOf(b, pr), ...ctx, pr }, cfg);
      const held = fr.failure.retry === 'hold';
      const next = held ? `stopped (${fr.failure.stopped}): needs Brett` : `next: ${fr.failure.retry} at ${fr.failure.notBefore}`;
      act(`failed in ${fr.failure.status}, attempt ${fr.attempt}: ${fr.failure.why} (${next})`);
      // the build's `attempt` carries the landing run's count while landing: the store's attempt ceiling reads it there
      write({ status: 'failed', attempt: fr.attempt, failure: fr.failure, landing: { attempt: fr.attempt }, note: `Lander: failed in ${fr.failure.status}, attempt ${fr.attempt}: ${fr.failure.why}${held ? ` Stopped (${fr.failure.stopped}): needs Brett. Start it again: node deploy/lander/run.mjs retry ${b.id}` : ''}` });
      // a merge-together PR that stops takes nobody with it: the others go back to landing by themselves
      if (held && pr && mates().length) {
        await dissolve(`${b.id} stopped: ${fr.failure.stopped}`);
        write({ landing: { closed: [...new Set([...L.landingOf(b).closed, pr])] }, failure: { ...b.failure, status: 'merging-pr', resume: 'same', pr: 0 } });
      }
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
      if (!write({ status: 'landed', failure: null, mergeLine: null, ...L.landedEvidence(b, at), note: `Lander: landed (${merged.map((n) => `#${n}`).join(', ')}).` })) return 'stop';
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
        const gone = str(pr.head?.ref, 250) || branchFor(b, openedCount(b));
        if (gone && gone !== s.base) git(['push', '-q', s.remote, '--delete', gone]);
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

    /**
     * The build's own open PR: the PR its session opened on the one branch all its steps share (a hand build's PR, a
     * draft opened when the build started). → the PR, or null (several branches, no open PR on it, GitHub not
     * answering: the lander then makes its own). A draft is marked ready first; one that can't be is left alone.
     */
    const ownPr = async (steps) => {
      const br = L.ownBranch(b, steps);
      if (!br || br === s.base || L.isLanderBranch(br)) return null;
      if (git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${br}`]).code) return null;
      let open = [];
      try { open = await gh('GET', `/repos/${s.slug}/pulls?state=open&head=${encodeURIComponent(`${s.slug.split('/')[0]}:${br}`)}`); } catch (e) { log(`PRs of ${br}: ${e.message}`); return null; }
      const pr = (Array.isArray(open) ? open : []).find((p) => Number(p?.number) && (!p.base?.ref || p.base.ref === s.base));
      if (!pr) return null;
      if (pr.draft && !dry) {
        try {
          await gh('POST', '/graphql', { query: 'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', variables: { id: pr.node_id } });
          act(`PR #${pr.number} was a draft: marked ready`);
        } catch (e) { log(L.say(b, `PR #${pr.number} is a draft and could not be marked ready (${e.message}): the lander opens its own`)); return null; }
      }
      return pr;
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
        // the build's own PR (its session opened it on the one branch its steps share): it is the PR, as it is. No
        // lander branch, no second PR, no second CI run (Nov 24 2026: PR 901 was opened beside a green PR 900)
        const own = !split && groups.length === 1 && k === 1 ? await ownPr(steps) : null;
        if (b.status !== 'merging-pr' && !write({ status: 'merging-pr', group: k > 1, ...fresh, note: own ? `Lander: the build's own PR #${own.number} (${str(own.head?.ref, 200)}) is taken as it is: no second PR (${steps.map((x) => x.id).join(', ')})` : `Lander: PR ${k} of ${total} (${steps.map((x) => x.id).join(', ')}${split ? ', split after a failure' : ''})` })) return 'stop';
        if (own) {
          const n = Number(own.number);
          branchByPr.set(n, str(own.head?.ref, 250));
          if (!write({ pr: String(n), steps: steps.map((x) => ({ id: x.id, status: 'in-pr', prNumber: n })) })) return 'stop';
          act(`PR #${n} is the build's own (${str(own.head?.ref, 200)}): taken as it is, no second PR`);
          return 'pr-pulling-main';
        }
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
        branchByPr.set(n, branch);
        if (!write({ pr: String(n), steps: steps.map((x) => ({ id: x.id, status: 'in-pr', prNumber: n })) })) return 'stop';
        act(`PR #${n} opened: ${steps.map((x) => x.id).join(', ')} added`);
        return 'pr-pulling-main';
      },

      /** pr-pulling-main: main into the PR the lander just made (no CI has run on it yet), or after a refused merge. */
      async 'pr-pulling-main'() {
        const g = L.groupState(b); if (!g.inFlight) return 'merging-pr';
        if (b.status !== 'pr-pulling-main' && !write({ status: 'pr-pulling-main' })) return 'stop';
        const pr = await prOf(g.inFlight.pr);
        const branch = await prBranch(pr);
        const force = pullNow || pr?.mergeable === false; pullNow = false;
        // the merge rule: a PR that was there already is tried as it is. Main goes into it only when GitHub says it
        // cannot merge, or after a merge that was refused
        if (!L.isLanderBranch(branch) && !force) { act(`PR #${g.inFlight.pr} is tried as it is: main is pulled in only if the merge is refused`); return 'running-ci'; }
        const r = G.pullMain({ s, git, branch, force, dry, log });
        if (r.conflicts) return fail('clash-main', { why: `merging main into ${branch} conflicts in code (${r.conflicts.slice(0, 4).join(', ')})`, pr: g.inFlight.pr });
        if (!r.ok) return fail('infra', { why: r.error, pr: g.inFlight.pr });
        act(r.merged ? `main merged into PR #${g.inFlight.pr} (${str(r.sha, 9)})` : `PR #${g.inFlight.pr} already has main's code`);
        return 'running-ci';
      },

      /** running-ci: CI once on the head, then the gate's build rules on the same head. */
      async 'running-ci'() {
        const g = L.groupState(b); if (!g.inFlight) return 'merging-pr';
        if (b.status !== 'running-ci' && !write({ status: 'running-ci' })) return 'stop';
        const branch = await prBranch();
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
        // green. The merge rule (Brett, Nov 24 2026): a green PR is merged as it is. Main having moved since CI ran is no
        // reason to pull it in or to run CI again here; only a merge GitHub refuses is (merging-main, then the retry)
        // the build rules at the gate, once per head (a fixer's commit is a new head: CI again). The gate fails
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

      /**
       * merging-main: the PR head read again from GitHub, then the one merge, as it is, pinned to the head CI went
       * green on; then the next group or landed. A merge GitHub refuses is a `merge` failure: its retry pulls main into
       * the PR and CI runs again (the only time the lander does that to a green PR).
       */
      async 'merging-main'() {
        const g = L.groupState(b); if (!g.inFlight) return 'merging-pr';
        if (b.status !== 'merging-main' && !write({ status: 'merging-main' })) return 'stop';
        const branch = await prBranch();
        if (dry) { out.waiting = `would merge PR #${g.inFlight.pr} at ${git(['rev-parse', `${s.remote}/${branch}`]).out.slice(0, 9)}`; return 'stop'; }
        // right before the merge, never on what the tick fetched minutes ago (the build rules alone may run 20 minutes)
        const stale = G.fetchFresh({ s, git, branch });
        if (stale) return fail('infra', { why: `the PR head could not be read again right before the merge (${stale}): nothing merges blind`, pr: g.inFlight.pr });
        const head = git(['rev-parse', `${s.remote}/${branch}`]).out;
        const pr = await prOf(g.inFlight.pr);
        let mergeSha = '';
        if (pr?.merged_at || pr?.merged) { mergeSha = String(pr.merge_commit_sha || ''); /* merged already (a tick that died after the merge) */ }
        else if (pr?.state === 'closed') return fail('pr-closed', { why: `PR #${g.inFlight.pr} was closed without merging. Reopen it and the lander goes on; or re-send the build (lander retry ${b.id}) and a new PR is opened.`, head, pr: g.inFlight.pr });
        // never an untested head: the PR head is not the head CI and the rules passed on (someone pushed). Not a
        // failure: the landing run goes back through CI on that head (the contract lets a landing run start again at
        // merging-pr). Main having moved is NOT a reason: the merge is tried as it is
        else if (b.landing?.green?.head !== head) {
          const why = `PR #${g.inFlight.pr} is at ${head.slice(0, 9)}, not the head CI went green on`;
          if (!write({ status: 'merging-pr', group: true, landing: { green: null }, note: `Lander: ${why}; CI runs on it before the merge` })) return 'stop';
          act(`${why}: CI runs on it before the merge`);
          return 'pr-pulling-main';
        } else {
          try { const m = await gh('PUT', `/repos/${s.slug}/pulls/${g.inFlight.pr}/merge`, { merge_method: cfg.mergeMethod, sha: head, commit_title: `Merge pull request #${g.inFlight.pr} from ${branch} (lander: ${b.id})`.slice(0, 250) }); mergeSha = String(m?.sha || ''); }
          catch (e) {
            if (e.status === 405 || e.status === 409) return fail('merge', { why: `merging PR #${g.inFlight.pr} as it is was refused (${str(e.message, 200)}): main is pulled into the PR and CI runs again`, head, pr: g.inFlight.pr });
            return fail('infra', { why: `merging PR #${g.inFlight.pr}: ${e.message}`, head, pr: g.inFlight.pr });
          }
        }
        const merged = [...L.landingOf(b).merged, g.inFlight.pr];
        // the merge evidence done-means-merged@1 asks of `landed`: the PR, its merge commit and CI green on the head it merged (sha pinned)
        const lastMerge = { pr: g.inFlight.pr, sha: mergeSha || head, head, at };
        const together = mates();
        if (!write({ landing: { merged, lastMerge, ...NEW_HEAD, mainPull: null, fixes: null }, failure: null })) return 'stop';
        act(`PR #${g.inFlight.pr} merged into main${together.length ? ` (merge together: ${[b.id, ...together.map((m) => m.id)].join(', ')})` : ''}`);
        if (branch !== s.base) git(['push', '-q', s.remote, '--delete', branch]);
        // merge together: the one merge is every build's merge, with the same evidence (the head CI went green on)
        for (const m of together) {
          const r1 = put(m.id, { landing: { merged: [...new Set([...L.landingOf(m).merged, g.inFlight.pr])], lastMerge, ...NEW_HEAD, mainPull: null, fixes: null }, failure: null });
          const mb = r1.build || m;
          const r2 = put(m.id, { status: 'landed', failure: null, mergeLine: null, ...L.landedEvidence(mb, at), note: `Lander: landed together with ${[b.id, ...together.filter((x) => x.id !== m.id).map((x) => x.id)].join(', ')} (#${g.inFlight.pr}).` });
          if (!r2.ok) { log(L.say(m, `store: ${r2.why || 'write refused'}`)); continue; }
          out.actions.push(`${m.id}: landed together (PR #${g.inFlight.pr})`);
          if (cfg.cleanup) G.cleanupLanded({ s, git, branches: L.landSteps(mb).map((st) => L.stepBranch(mb, st)), extra: [fixWorktree(m.id)], log });
          say('done', `${m.id} landed: #${g.inFlight.pr} on main (merged together).`, m.id);
        }
        return L.groupState(b).waiting.length ? 'merging-pr' : land();
      },
    };

    /** A failed build whose retry is due: carry the retry out and continue forward. */
    const retry = async () => {
      const fr = b.failure || {};
      const n = fr.attempt || L.landingAttempt(b) || 1;
      if (!L.retryDue(b, at)) { out.waiting = `failed, attempt ${n}: ${fr.retry || 'retry'} at ${fr.notBefore}`; return 'stop'; }
      const g = L.groupState(b);
      const branch = await prBranch();
      if (fr.retry === 'rerun') {
        if (!dry) for (const id of fr.runIds || []) { try { await gh('POST', `/repos/${s.slug}/actions/runs/${id}/rerun-failed-jobs`); } catch (e) { log(`rerun ${id}: ${e.message}`); } }
        if (!fr.runIds?.length && !dry) { try { await gh('POST', `/repos/${s.slug}/actions/workflows/${cfg.workflow}/dispatches`, { ref: branch }); } catch (e) { log(`dispatch: ${e.message}`); } }
        const k = b.landing?.reruns?.head === fr.head ? b.landing.reruns.n + 1 : 1;
        if (!write({ status: 'running-ci', landing: { reruns: { head: fr.head, n: k } }, note: `Lander: attempt ${n}: re-running the failed CI jobs on ${str(fr.head, 9)} (flaky check)` })) return 'stop';
        act(`attempt ${n}: re-ran the failed CI jobs`); out.waiting = 'CI is re-running'; return 'stop';
      }
      if (fr.retry === 'split') {
        await dissolve(`${b.id} splits its steps`);
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
      // a refused merge: now, and only now, main goes into the PR and CI runs again
      if (fr.kind === 'merge' && to === 'pr-pulling-main') pullNow = true;
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

  /**
   * Merge together (Brett, Nov 24 2026: "compile them all into one and merge them all together"), asked for with
   * `run.mjs merge-together`: every build waiting at build-complete is combined into ONE branch and ONE PR; CI runs
   * once on it and the one merge lands them all. A build whose code clashes with the ones before it is left out, with
   * a note saying which branch it clashes with, and lands by itself after them. It starts only when no build is in the
   * middle of landing; the request is used up once a PR is made (or when fewer than two builds can go together).
   */
  const together = async () => {
    const clear = () => { const c = readControl(s); delete c.mergeTogether; G.writeJson(files(s).control, c); };
    const line = L.lineOf(scope).filter((x) => !L.isHeld(x));
    const busy = line.find((x) => x.status !== 'build-complete' && !L.isEmergency(x));
    if (busy || L.isEmergency(pick.build)) { log(`merge together waits: ${(busy || pick.build).id} lands first`); return; }
    // the builds the press named (the merge line's own list), or every build that waits
    const asked = Array.isArray(ctl.mergeTogether.builds) && ctl.mergeTogether.builds.length ? new Set(ctl.mergeTogether.builds.map((x) => str(x, 120))) : null;
    let members = line.filter((x) => x.status === 'build-complete' && !L.isEmergency(x) && !L.prInFlight(x) && L.landSteps(x).length && (!asked || asked.has(x.id)));
    const branchesOf = (x) => [...new Set(L.landSteps(x).map((st) => L.stepBranch(x, st)).filter(Boolean))];
    const say1 = (text) => { out.actions.push(text); log(`lander: ${text}`); };
    const left = [];
    let made = null; let branch = '';
    while (members.length >= 2) {
      branch = L.togetherBranch(members[0].id);
      const c = G.combineSteps({ s, git, branch, branches: members.flatMap(branchesOf), dry, log });
      if (c.ok) { made = c; break; }
      if (!c.conflicts) { say1(`merge together could not be put together (${str(c.error, 200)}): the builds land one at a time`); clear(); return; }
      // the build the clashing branch belongs to is left out (the later one of the two); the rest still go together
      const owner = members.find((x) => branchesOf(x).includes(c.between[1])) || members[members.length - 1];
      const why = `${c.between.join(' and ')} conflict in code (${c.conflicts.slice(0, 4).join(', ')})`;
      left.push({ id: owner.id, why });
      put(owner.id, { note: `Lander: left out of merge together: ${why}. It lands by itself, after the others.` });
      members = members.filter((x) => x.id !== owner.id);
    }
    for (const l of left) say1(`merge together: ${l.id} is left out (${l.why}) and lands by itself`);
    if (!made) { say1('merge together: fewer than two builds can go together, so they land one at a time'); clear(); return; }
    let pr = null;
    try {
      const open = await gh('GET', `/repos/${s.slug}/pulls?state=open&head=${encodeURIComponent(`${s.slug.split('/')[0]}:${branch}`)}`);
      pr = Array.isArray(open) && open[0] ? open[0] : null;
      if (!pr) {
        const body = [`Merge together: ${members.length} builds in one PR, opened by the lander (deploy/lander/run.mjs). CI runs once and the one merge lands them all.`, '', ...members.flatMap((x) => [`- \`${x.id}\`: ${str(x.title || x.id, 120)}`, ...L.landSteps(x).map((st) => `  - ${st.id}: ${str(st.title || st.text, 100)} (\`${L.stepBranch(x, st)}\`)`)]), ...(left.length ? ['', ...left.map((l) => `Left out, lands by itself: \`${l.id}\` (${l.why})`)] : [])].join('\n');
        pr = await gh('POST', `/repos/${s.slug}/pulls`, { title: `Merge together: ${members.length} builds (${members.map((x) => x.id).join(', ')})`.slice(0, 240), head: branch, base: s.base, body });
      }
    } catch (e) { say1(`merge together: the PR could not be opened (${e.message}); the next tick tries again`); return; }
    const n = Number(pr?.number) || 0;
    if (!n) { say1('merge together: the PR has no number; the next tick tries again'); return; }
    branchByPr.set(n, branch);
    const ids = members.map((x) => x.id);
    for (const x of members) {
      const r = put(x.id, { status: 'merging-pr', landing: { attempt: 0, fixes: null, ...NEW_HEAD }, pr: String(n), steps: L.landSteps(x).map((st) => ({ id: st.id, status: 'in-pr', prNumber: n })), note: `Lander: merge together: PR #${n} carries ${ids.join(', ')}; CI runs once and they merge in one go` });
      if (!r.ok) log(`${x.id}: store: ${r.why || 'write refused'}`);
    }
    clear();
    say1(`merge together: PR #${n} opened for ${ids.join(', ')} (${branch})`);
    pick = L.pickBuild([...known.values()]);
    out.build = pick.build?.id || ''; out.others = pick.others;
  };

  // GitHub's word on every other PR in flight first (a hand merge or a closed PR is seen even while another build lands)
  const others = new Set(syncOnly ? [pick.build.id, ...pick.others] : pick.others);
  for (const o of scope.filter((x) => others.has(x.id) && L.groupState(x).inFlight)) { await run(o, { syncOnly: true }); out.waiting = ''; }
  if (syncOnly) { out.build = ''; return done(); }
  if (ctl.mergeTogether && !dry && !only) await together();
  // builds that share one PR (merge together): the one with the lowest id carries it, whichever the line shows first,
  // so the PR's own records (the green head, the attempt and fix counts) stay on one build
  const sharing = L.togetherWith([...known.values()], known.get(pick.build.id) || pick.build);
  if (sharing.length) {
    const lead = [known.get(pick.build.id) || pick.build, ...sharing].filter((x) => !L.isHeld(x)).sort((x, y) => x.id.localeCompare(y.id))[0];
    if (lead && lead.id !== pick.build.id) { pick = { build: lead, others: [pick.build.id, ...pick.others.filter((id) => id !== lead.id)] }; out.build = lead.id; out.others = pick.others; }
  }
  const b = await run(known.get(pick.build.id) || pick.build);
  out.status = b.status;
  syncLine();
  return done();
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
    // the merge line (each build's place and the build it waits for) and a pending merge-together request
    line: lineRows(builds), mergeTogether: ctl.mergeTogether || null,
  };
}

/** The merge line, in order: [{ build, number, title, status, state, position, waitingFor, together, text }]. */
export function lineRows(builds) {
  const line = L.mergeLine(builds);
  return L.lineOf(builds).filter((b) => line.has(b.id)).map((b) => { const m = line.get(b.id); const pr = L.prInFlight(b); return { build: b.id, number: b.number ?? null, title: str(b.title || b.id, 200), status: b.status, state: L.landingState(b), ...m, ...(pr && L.togetherWith(builds, b).length ? { together: pr } : {}), text: L.lineText(m) }; });
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
  if (cmd === 'merge-together') {
    // the request only: the next tick puts the PR together (under its lock, like every other piece of landing work)
    const off = rest.includes('--off');
    const only = flag('--builds').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50);
    const c = readControl(s);
    if (off) delete c.mergeTogether; else c.mergeTogether = { at: nowIso(), by: flag('--by') || 'cli', ...(only.length ? { builds: only } : {}) };
    G.writeJson(files(s).control, off ? c : { ...c, runRequested: nowIso(), runRequestedBy: flag('--by') || 'cli' });
    const waiting = off ? [] : lineRows((await makeStore({ repo: s.repo })).read()).filter((r) => r.status === 'build-complete' && (!only.length || only.includes(r.build))).map((r) => r.build);
    const message = off ? 'Merge together: request dropped.' : waiting.length >= 2 ? `Merge together: on its next tick the lander combines ${waiting.join(', ')} into one branch, runs CI once and merges them in one go. A build that clashes is named on its record and lands by itself.` : `Merge together needs two builds waiting to merge; ${waiting.length} ${waiting.length === 1 ? 'waits' : 'wait'} right now.`;
    return print({ ok: true, mergeTogether: !off, builds: waiting, waiting, message }, message);
  }
  if (cmd === 'line') { const rows = lineRows((await makeStore({ repo: s.repo })).read()); return print({ ok: true, line: rows }, rows.map((r) => `${String(r.position).padStart(2)}. ${r.build}${r.number != null ? ` (build ${r.number})` : ''} · ${r.state}${r.waitingFor ? ` · waiting for ${r.waitingFor.number ? `build ${r.waitingFor.number}` : r.waitingFor.id}` : ''}${r.together ? ` · together in #${r.together}` : ''}`).join('\n') || 'nobody waits to merge'); }
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
  console.error('usage: run.mjs tick [--dry-run] [--only <build>] | status | queue | line | merge-together [--off] | config | pause | resume | retry <build> | show <build> [--json]');
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
