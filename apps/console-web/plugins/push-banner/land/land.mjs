#!/usr/bin/env node
/**
 * Auto-land runner (build auto-land, Brett Nov 3 2026: "zero tokens for merging"). Plain Node: git, the GitHub REST
 * API and the console's own routes. It never calls a model; a code conflict or red CI is the only thing it hands to an
 * agent (agent-job.mjs, once per head). land.test.mjs fails the build if this folder imports any LLM client.
 *
 * Runs on the VPS host (cron every 3 minutes, deploy/install-console.sh), where the build worktrees and the GitHub
 * token broker are; the console container reads what it writes (the push banner's data folder) and does the merging
 * itself (push banner auto-merge: oldest first → this file's landing order, one merge per round, UI Review holds).
 *
 *   node apps/console-web/plugins/push-banner/land/land.mjs run [--dry-run] [--only <build>] [--json]   one round
 *   … list | blocked [--json]            what the last round found (landing order, PR, state, reason)
 *   … now <build> | hold <build> [--why "…"] | release <build> | after <build> <other>
 *   … off <build> [--why "…"] | on <build>   the per-build switch (auto-land is on for every build unless switched off)
 *   … sweep [--dry-run]                  the sweeper now (it also runs every 10 min inside a round): land or fix-build each
 *                                        finished build not on main; say what is stuck over 30 min
 *   … status | pause [--why "…"] | resume   the sweeper's state (paused, last sweep, what it did) | stop / restart its timed runs
 *   … lock | serial -- <cmd …>           the serial landing line: who lands now | run a command in the line (waits its turn)
 *   run takes the line's lock (skips when busy; --wait-lock waits up to 15 min, the finish hook's round)
 *   … merge-main <build|branch> [--dry-run] [--json]   merge main into one build's branch now (same rules as a round)
 *   … queue list | add <pr> | remove <pr> | move <pr> <index>   the merge queue (merge-queue.mjs; it runs in every round)
 *
 * One round, per finished build (land-core.mjs isCandidate), in dependency order:
 *   1. its worktree: synced files committed on its own branch, scratch files skipped, untracked copies of hub files
 *      moved to /root/archive/auto-land/<build>/, `.claude-sync-hold` written so claude-sync stops dropping files in;
 *      code changes never committed stop it (reason `code`); the branch is pushed when it is ahead of GitHub;
 *   2. main merged in (a temporary worktree, never the build's): only when main moved in code (status-only `[skip ci]`
 *      commits under _claude/ don't count) or GitHub says the PR conflicts. Builds files newer-wins (builds-live.mjs
 *      merge driver), THREADS / STATUS / decisions / logs / PORTING.md unioned, help packs and catalog status unioned by
 *      key, generated files (framework/spec/generated-files.json) from main then regenerated and tested, only code
 *      conflicts abort (reason `conflict`, an agent job);
 *   3. its PR opened when it has none; CI started (workflow_dispatch) when nothing ran on the head;
 *   4. the reason it waits (land-core.mjs blockReason) written to land.json; a new reason is pushed to Brett once
 *      (console alert, key land:<build>), and resolved when it lands.
 *
 * Group chat (crew-sections@1): each landing event is posted as the section's owner through framework/cli/crew-say.mjs (a
 * child process: this folder imports only node built-ins). Sections `landing` (this round) and `merge-queue`
 * (merge-queue.mjs). Dropped while the chat is off; AXF_CREW_SAY=off for tests; never on a dry run.
 *
 * Settings (push banner config.json, Settings → Plugins → Push banner → Auto-land): autoLand (on by default for every
 * build since Nov 13 2026, Brett: "what's it gonna take to get you to merge and land what's completed"; the merge queue
 * still does the merging, one batch at a time), landWaitUi (on). Per build: `off <build>` / `on <build>` (land-control).
 * Environment: AXF_LAND_REPO (checkout to run git in; default this file's repo), AXF_PUSH_BANNER_DIR (data folder;
 * default <AXF_CONSOLE_ROOT or /opt/axf>/.axf-console/plugins/push-banner), AXF_LAND_REPO_SLUG (MossesX/AmberX-AXF),
 * AXF_LAND_CONSOLE (docker container of the console, axf-console; "off" = no console calls), AXF_LAND_ARCHIVE
 * (/root/archive/auto-land), AXF_LAND_GITHUB_API (https://api.github.com), AXF_LAND_WORKFLOW (android.yml).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './land-core.mjs';
import { queueRound, readQueue, readQueueConfig, main as queueMain } from './merge-queue.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF_REPO = resolve(HERE, '../../../../..');
const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export function settings() {
  const repo = env('AXF_LAND_REPO', SELF_REPO);
  return {
    repo,
    slug: env('AXF_LAND_REPO_SLUG', 'MossesX/AmberX-AXF'),
    dataDir: env('AXF_PUSH_BANNER_DIR', join(env('AXF_CONSOLE_ROOT', '/opt/axf'), '.axf-console', 'plugins', 'push-banner')),
    archive: env('AXF_LAND_ARCHIVE', '/root/archive/auto-land'),
    console: env('AXF_LAND_CONSOLE', 'axf-console'),
    api: env('AXF_LAND_GITHUB_API', 'https://api.github.com'),
    workflow: env('AXF_LAND_WORKFLOW', 'android.yml'),
    projects: env('AXHUB_PROJECTS_DIR', '/projects'),
    remote: 'origin', base: 'main',
  };
}

// ------------------------------------------------------------------ small IO helpers

const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** git in a checkout. A fetch / push / update-ref that lost a ref lock to another git process is tried again (3×). */
export function makeGit(cwd, { retryWait = 2000 } = {}) {
  return (args, o = {}) => {
    const once = () => {
      const r = spawnSync('git', args, { cwd: o.cwd || cwd, encoding: 'utf8', timeout: o.timeout || 120000, maxBuffer: 64 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(o.env || {}) } });
      return { code: r.status ?? 1, out: (r.stdout || '').replace(/\s+$/, ''), err: (r.stderr || r.error?.message || '').trim() };
    };
    let r = once();
    for (let i = 0; i < 3 && r.code && ['fetch', 'push', 'update-ref'].includes(args[0]) && core.REF_LOCK_ERR.test(r.err); i++) { sleepSync(retryWait * (i + 1)); r = once(); }
    return r;
  };
}

// ------------------------------------------------------------------ the serial landing line

export const lockDir = () => env('AXF_LAND_LOCK', '/run/axf-land.lock.d');
/** Take the landing line's lock (mkdir is atomic). `wait` ms: keep trying that long. Returns true when held. */
export async function takeLandLock({ wait = 0, stale = core.LOCK_STALE_MS, who = '' } = {}) {
  const d = lockDir(); const until = Date.now() + wait;
  for (;;) {
    try { mkdirSync(d); writeFileSync(join(d, 'owner'), `${process.pid} ${new Date().toISOString()} ${who}\n`); return true; } catch (e) { if (e.code !== 'EEXIST') { try { mkdirSync(dirname(d), { recursive: true }); continue; } catch { return false; } } }
    try { if (Date.now() - Math.floor(statSync(d).mtimeMs) >= stale) { rmSync(d, { recursive: true, force: true }); continue; } } catch { continue; }
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, Math.min(5000, Math.max(50, until - Date.now()))));
  }
}
export const dropLandLock = () => { try { rmSync(lockDir(), { recursive: true, force: true }); } catch { /* gone */ } };
/** Who holds the line right now ('' = free): "<pid> <since> <what>". */
export const lockOwner = () => { try { return readFileSync(join(lockDir(), 'owner'), 'utf8').trim(); } catch { return ''; } };
/** Run fn while holding the line. Resolves { ran: false } when the line stayed busy for `wait` ms. */
export async function serial(fn, { wait = core.LOCK_WAIT_MS, who = '' } = {}) {
  if (!(await takeLandLock({ wait, who }))) return { ran: false, owner: lockOwner() };
  try { return { ran: true, value: await fn() }; } finally { dropLandLock(); }
}

/** GitHub REST with the token broker's token (never printed, never logged).
 *  Save compute (Brett, Nov 4 2026: "Save the compute"): every GET is cached with its ETag in the push banner's data
 *  folder (gh-cache.json) and sent again as a conditional request; GitHub answers an unchanged resource with 304, which
 *  doesn't count against the shared 5000/h limit. Reads stop when fewer than GH_RESERVE calls are left, so the console
 *  and the reconciler keep theirs. `gh.calls` / `gh.cached` count this run's billed and free requests. */
const GH_RESERVE = 300, GH_CACHE_MAX = 2000;
export function makeGitHub(s, token = () => brokerToken(s)) {
  let tok = null, cache = null, dirty = false, remaining = Infinity;
  const file = join(s.dataDir, 'gh-cache.json');
  const save = () => {
    if (!dirty) return;
    const keys = Object.keys(cache);
    if (keys.length > GH_CACHE_MAX) for (const k of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - GH_CACHE_MAX)) delete cache[k];
    try { writeJson(file, cache); dirty = false; } catch { /* cache is an optimisation only */ }
  };
  const gh = async (method, path, body) => {
    tok ??= token() || '';
    if (!tok) throw new Error('no GitHub token (framework/cli/github-token.mjs token)');
    const get = method === 'GET';
    cache ??= readJson(file, {}) || {};
    const hit = get ? cache[path] : null;
    if (get && remaining < GH_RESERVE) { if (hit) { gh.cached++; return hit.data; } const e = new Error(`GitHub calls held back (${remaining} left, reserve ${GH_RESERVE})`); e.status = 429; throw e; }
    const r = await fetch(`${s.api}${path}`, { method, redirect: 'error', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'axf-auto-land', ...(hit?.etag ? { 'If-None-Match': hit.etag } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const left = Number(r.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(left) && r.headers.has('x-ratelimit-remaining')) remaining = left;
    if (r.status === 304 && hit) { gh.cached++; hit.at = Date.now(); dirty = true; return hit.data; }
    gh.calls++;
    const text = await r.text();
    const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
    if (!r.ok) { const e = new Error(`GitHub ${r.status}: ${String(data?.message || text).slice(0, 200)}`); e.status = r.status; throw e; }
    const etag = r.headers.get('etag');
    if (get && etag) { cache[path] = { etag, data, at: Date.now() }; dirty = true; }
    return data;
  };
  gh.calls = 0; gh.cached = 0; gh.save = save; gh.left = () => remaining;
  return gh;
}

function brokerToken(s) {
  const r = spawnSync('node', [join(s.repo, 'framework/cli/github-token.mjs'), 'token'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

/** The console's own API, from inside its container (the host has no console token): docker exec + curl. */
export function makeConsole(s) {
  if (s.console === 'off') return async () => null;
  return async (method, path, body) => {
    const cmd = `curl -s -m 20 -X ${method} -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" ${body ? '--data-binary @-' : ''} "http://127.0.0.1:7090${path}"`;
    const r = spawnSync('docker', ['exec', '-i', s.console, 'sh', '-c', cmd], { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', timeout: 30000 });
    if (r.status !== 0) return null;
    try { return JSON.parse(r.stdout); } catch { return null; }
  };
}

// ------------------------------------------------------------------ state files (the push banner's data folder)

/** A section event in the crew's group chat, as its owner (framework/cli/crew-say.mjs). Never fails the round. */
export function crewSay(section, event, text, { ref = '', repo = SELF_REPO, dedupeMin } = {}) {
  if (process.env.AXF_CREW_SAY === 'off') return false;
  const cli = join(repo, 'framework/cli/crew-say.mjs');
  if (!existsSync(cli)) return false;
  const args = [cli, section, event, String(text || '').slice(0, 600), ...(ref ? ['--ref', String(ref)] : []), ...(dedupeMin !== undefined ? ['--dedupe-min', String(dedupeMin)] : [])];
  return spawnSync(process.execPath, args, { cwd: repo, encoding: 'utf8', timeout: 30000 }).status === 0;
}
/** Which chat event a landing reason is: Brett's move, a code fix, or something in the way. */
export const reasonEvent = (kind) => (['held', 'ui', 'code'].includes(kind) ? 'waiting' : ['conflict', 'ci', 'error'].includes(kind) ? 'failed' : 'blocked');

export const stateFile = (s) => join(s.dataDir, 'land.json');
/** One record per build of its fix attempts (round and sweeper share it, so an attempt is never filed twice). */
export const fixFile = (s) => join(s.dataDir, 'land-fix.json');
export const readFixes = (s) => (readJson(fixFile(s), {}) || {}).builds || {};
export const writeFixes = (s, builds) => writeJson(fixFile(s), { $axf: 'auto-land-fix@1', builds });
export const controlFile = (s) => join(s.dataDir, 'land-control.json');
export const readState = (s) => readJson(stateFile(s), { $axf: core.LAND_FRAME, items: [] });
export const readControl = (s) => readJson(controlFile(s), { $axf: core.CONTROL_FRAME, holds: {}, now: [], after: {}, off: {} });
export function readConfig(s) {
  const c = readJson(join(s.dataDir, 'config.json'), {}) || {};
  return { autoLand: core.autoLandOn(c), landWaitUi: c.landWaitUi !== false };
}
export function control(s, cmd, build, opts = {}) {
  const d = core.applyControl(readControl(s), cmd, build, opts);
  writeJson(controlFile(s), d);
  return d;
}

// ------------------------------------------------------------------ the build's worktree

/** Every worktree of the repo, by branch. */
export function worktrees(git) {
  const out = {}; let cur = null;
  for (const l of git(['worktree', 'list', '--porcelain']).out.split('\n')) {
    if (l.startsWith('worktree ')) cur = { path: l.slice(9) };
    else if (l.startsWith('branch refs/heads/') && cur) out[l.slice(18)] = cur.path;
  }
  return out;
}

/** The hub file a repo path is synced with (claude-sync / persist.mjs), or ''. */
export function hubPath(s, wt, p) {
  const manifest = (dir) => readJson(join(wt, dir, 'project.manifest.json'), {}) || {};
  const name = (dir) => manifest(dir).name || '';
  let m = p.match(/^(?:apps\/[^/]+\/)?_claude\/shared\/(.+)$/);
  if (m) return join(s.projects, '_shared', '_claude', m[1]);
  const shared = (manifest('.').data?.shared || []).filter((x) => typeof x === 'string');
  if (shared.some((x) => (x.endsWith('/') ? p.startsWith(x) : p === x))) { const n = name('.'); return n ? join(s.projects, n, '_data', p) : ''; }
  m = p.match(/^apps\/([^/]+)\/_claude\/(.+)$/);
  if (m) { const n = name(`apps/${m[1]}`); return n ? join(s.projects, n, '_claude', m[2]) : ''; }
  m = p.match(/^_claude\/(.+)$/);
  if (m) { const n = name('.'); return n ? join(s.projects, n, '_claude', m[1]) : ''; }
  return '';
}

/** Step 1: clean a finished build's worktree. Returns { code: [files], committed: [files], archived: [files], pushError }. */
export function cleanWorktree({ s, git, b, wt, dry, now = Date.now() }) {
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  const res = { committed: [], archived: [], skipped: [], code: [], settling: false, pushError: '' };
  if (!dry) { try { writeFileSync(join(wt, '.claude-sync-hold'), `auto-land: ${b.id} is finished; claude-sync leaves this checkout alone.\n`); } catch { /* read-only checkout */ } }
  const hubHas = (p) => { const h = hubPath(s, wt, p); if (!h || !existsSync(h)) return false; try { return readFileSync(h).equals(readFileSync(join(wt, p))); } catch { return false; } };
  const plan = core.strayPlan(g(['status', '--porcelain', '--untracked-files=all']).out, hubHas);
  res.skipped = plan.skip; res.code = plan.code;
  // a session that wrote here in the last 10 minutes may still be finishing: leave it this round
  const fresh = [...plan.commit, ...plan.code].some((p) => { try { return now - statSync(join(wt, p)).mtimeMs < 10 * 60000; } catch { return false; } });
  if (fresh) { res.settling = true; return res; }
  if (dry) return { ...res, committed: plan.commit, archived: [...plan.archive, ...plan.restore] };
  for (const p of [...plan.archive, ...plan.restore]) {
    const to = join(s.archive, b.id, p);
    try {
      mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(wt, p), to);
      if (plan.restore.includes(p)) { if (g(['checkout', '--', p]).code) continue; } else rmSync(join(wt, p));
      res.archived.push(p);
    } catch { /* left in place */ }
  }
  if (plan.commit.length) {
    g(['add', '--', ...plan.commit]);
    const c = g(['-c', 'user.name=AXF auto-land', '-c', 'user.email=auto-land@amberxai.com', 'commit', '-q', '-m', `${b.id}: commit synced files left in the worktree (auto-land)`, '--', ...plan.commit]);
    if (!c.code) res.committed = plan.commit;
  }
  if (plan.code.length) return res;
  // push the branch when the worktree is ahead of GitHub (never forced; a branch that moved on GitHub is left alone)
  const ahead = g(['rev-list', '--count', `${s.remote}/${b.branch}..HEAD`]);
  const behind = g(['rev-list', '--count', `HEAD..${s.remote}/${b.branch}`]);
  if (ahead.code) { const p = g(['push', '-q', s.remote, `HEAD:refs/heads/${b.branch}`], { timeout: 90000 }); if (p.code) res.pushError = p.err.slice(-200) || 'push failed'; }
  else if (+ahead.out > 0) {
    if (+behind.out > 0) res.pushError = `${b.branch} has commits here and on GitHub that differ`;
    else { const p = g(['push', '-q', s.remote, `HEAD:refs/heads/${b.branch}`], { timeout: 90000 }); if (p.code) res.pushError = p.err.slice(-200) || 'push failed'; }
  }
  return res;
}

// ------------------------------------------------------------------ step 2: main merged in

/** Does the branch lack code from main (anything but status-only commits)? */
export function codeBehind({ s, git, br }) {
  const msgs = git(['log', '--format=%s', `${s.remote}/${br}..${s.remote}/${s.base}`]).out.split('\n').filter(Boolean);
  if (!msgs.length) return false;
  const files = git(['diff', '--name-only', `${s.remote}/${br}...${s.remote}/${s.base}`]).out.split('\n').filter(Boolean);
  return !core.statusOnly(msgs, files);
}

/**
 * Resolve a stopped merge's conflicted files in worktree `wt` by land-core's rules (generated-files@1 manifest):
 *   builds       the side `buildsSide` names (the builds-live merge driver did the rest)
 *   union        both sides' lines (git merge-file --union): THREADS, STATUS, logs, PORTING.md
 *   union-json   both sides' keys (land-core mergeJson3, main wins a scalar clash): help packs, catalog status
 *   generated    main's side (`mainSide`), then every generator those files need runs once on the merged tree
 *                (control inventory, help bake, framework re-bake + lock, fixtures, tracker) and its outputs are staged
 *   code         a person's: nothing is touched and { conflicts } comes back
 * After regenerating, the generators' checks and the manifest's tests run; a red one comes back as { error } (the
 * merge is not committed). Returns { resolved: [paths], regenerated: [generator ids] } when every file is resolved.
 * `dir` is a scratch folder for the merge-file inputs. Nothing here commits or aborts: the caller does.
 */
export function resolveConflicts({ g, wt, dir, left, mainSide = 'theirs', buildsSide = 'theirs', log = () => {} }) {
  const plan = core.planConflicts(left);
  if (plan.code.length) return { conflicts: plan.code };
  const resolved = [];
  const stage = (p, n) => { const x = g(['show', `:${n}:${p}`]); return x.code ? '' : `${x.out}\n`; };
  for (const p of plan.builds) { if (g(['checkout', `--${buildsSide}`, '--', p]).code === 0) { g(['add', '--', p]); resolved.push(p); } }
  for (const p of plan.union) {
    const f = (n, t) => { const q = join(dir, `${n}.txt`); writeFileSync(q, t); return q; };
    const ours = f('ours', stage(p, 2)); const base = f('base', stage(p, 1)); const theirs = f('theirs', stage(p, 3));
    g(['merge-file', '--union', ours, base, theirs]);
    writeFileSync(join(wt, p), readFileSync(ours)); g(['add', '--', p]); resolved.push(p);
  }
  for (const p of plan.unionJson) {
    const parse = (t) => { try { return t.trim() ? JSON.parse(t) : undefined; } catch { return undefined; } };
    const o = parse(stage(p, 2)); const t = parse(stage(p, 3)); const b = parse(stage(p, 1));
    if (o === undefined || t === undefined) { g(['checkout', `--${mainSide}`, '--', p]); log(`${p}: one side is not JSON; main's copy taken`); }
    else writeFileSync(join(wt, p), `${JSON.stringify(core.mergeJson3(b, o, t, mainSide), null, 2)}\n`);
    g(['add', '--', p]); resolved.push(p);
  }
  for (const p of plan.generated) { g(['checkout', `--${mainSide}`, '--', p]); g(['add', '--', p]); resolved.push(p); }
  const still = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
  if (still.length) return { conflicts: still };
  // the generators, each once, on the merged tree; their outputs join the merge commit
  const regenerated = [];
  const run = (cmd, timeout) => { const r = spawnSync(cmd[0], cmd.slice(1), { cwd: wt, encoding: 'utf8', timeout, maxBuffer: 16 << 20, env: { ...process.env, CI: '1' } }); return { code: r.status ?? 1, text: `${r.stderr || ''}${r.stdout || ''}`.trim().slice(-400) }; };
  const skipped = [];
  for (const gen of core.regenPlan(plan.generated)) {
    const r = run(gen.run, gen.timeoutMs);
    if (r.code) {
      // an optional generator that refuses (rebake: the app's baked files were edited in place) leaves main's copy, which main's CI passed
      if (gen.optional) { skipped.push(gen.id); log(`${gen.id} did not run (${r.text.split('\n').pop()}); main's copy stands`); continue; }
      return { error: `${gen.id} failed to regenerate after the merge (${gen.run.join(' ')}): ${r.text}` };
    }
    regenerated.push(gen.id);
    g(['add', '-A', '--', ...gen.outputs.filter((o) => existsSync(join(wt, o)))]);
    if (gen.check) { const c = run(gen.check, gen.timeoutMs); if (c.code) return { error: `${gen.id} regenerated but its check failed (${gen.check.join(' ')}): ${c.text}` }; }
  }
  if (plan.generated.length || plan.unionJson.length) {
    for (const t of core.landTests()) { const c = run(t, 180000); if (c.code) return { error: `tests after regenerating failed (${t.join(' ')}): ${c.text}` }; }
  }
  if (regenerated.length) log(`regenerated ${regenerated.join(', ')} after the merge`);
  return { resolved, regenerated, skipped };
}

/**
 * Merge main into the branch in a temporary worktree and push the merge commit. Data conflicts are resolved by
 * land-core's rules (resolveConflicts); any code conflict aborts. Returns { merged, sha, conflicts: [code files],
 * resolved, regenerated, pushError }.
 */
export function mergeMain({ s, git, b, dry, inPlace = '', log = () => {} }) {
  // inPlace: a running build's own clean worktree (refreshRunning); otherwise a temporary worktree that is removed afterwards
  const dir = mkdtempSync(join(tmpdir(), 'axf-land-')); const wt = inPlace || join(dir, 'wt');
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  const live = join(s.repo, 'framework/cli/builds-live.mjs');
  const drv = ['-c', `merge.axf-builds.driver=node "${live}" merge-driver %O %A %B %P`, '-c', 'user.name=AXF auto-land', '-c', 'user.email=auto-land@amberxai.com'];
  try {
    if (!inPlace) {
      const r = git(['worktree', 'add', '-q', '--detach', wt, `${s.remote}/${b.branch}`]);
      if (r.code) return { merged: false, conflicts: [], pushError: `worktree: ${r.err.slice(-200)}` };
    }
    const m = g([...drv, 'merge', '--no-edit', '-m', `Merge main into ${b.branch} (auto-land: builds files newer-wins, logs unioned, generated files regenerated)`, `${s.remote}/${s.base}`], { timeout: 180000 });
    let resolved = []; let regenerated = [];
    if (m.code) {
      const left = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
      if (!left.length) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `merge: ${m.err.slice(-200) || m.out.slice(-200)}` }; }
      // main is the side being merged in (theirs); its builds files win too (the newest status is on main)
      const res = resolveConflicts({ g, wt, dir, left, mainSide: 'theirs', buildsSide: 'theirs', log });
      if (res.conflicts) { g(['merge', '--abort']); return { merged: false, conflicts: res.conflicts }; }
      if (res.error) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `merge: ${res.error.slice(-300)}` }; }
      resolved = res.resolved; regenerated = res.regenerated;
      // check JSON: a settled builds / generated file that doesn't parse takes main's copy; one that still doesn't stops it
      const broken = badJson(wt, resolved);
      for (const p of broken) { g(['checkout', '--theirs', '--', p]); g(['add', '--', p]); }
      const still2 = badJson(wt, broken);
      if (still2.length) { g(['merge', '--abort']); return { merged: false, conflicts: still2, badJson: still2 }; }
      const c = g([...drv, 'commit', '-q', '--no-edit']);
      if (c.code) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `commit: ${c.err.slice(-200)}` }; }
    }
    const sha = g(['rev-parse', 'HEAD']).out;
    if (dry) return { merged: true, sha, conflicts: [], resolved, regenerated, dry: true };
    const p = g(['push', '-q', s.remote, `HEAD:refs/heads/${b.branch}`], { timeout: 90000 });
    return p.code ? { merged: false, conflicts: [], resolved, regenerated, pushError: p.err.slice(-200) || 'push failed' } : { merged: true, sha, conflicts: [], resolved, regenerated };
  } finally { if (!inPlace) git(['worktree', 'remove', '--force', wt]); rmSync(dir, { recursive: true, force: true }); }
}

// ------------------------------------------------------------------ running builds: main merged in every 30 minutes

export const refreshFile = (s) => join(s.dataDir, 'land-refresh.json');

/**
 * A build that is still running gets origin/main merged into its branch every REFRESH_MS (Brett, Nov 13 2026: so it
 * never falls far behind). Only in its own worktree when that is clean and not behind GitHub (a session mid-edit is
 * left for the next turn), only when main moved in code, and at most MAX_REFRESH a round. The same merge rules as a
 * landing: builds files newer-wins, THREADS / STATUS / decisions unioned, JSON checked; a code clash is aborted and noted
 * (the build's own session resolves it when it finishes; the landing then files the fix build if it still clashes).
 */
export function refreshRunning({ s, git, builds, wts = worktrees(git), dry = false, nowMs = Date.now(), log = () => {} }) {
  const prev = readJson(refreshFile(s), { $axf: 'auto-land-refresh@1', builds: {} }) || { builds: {} };
  const out = { $axf: 'auto-land-refresh@1', at: new Date(nowMs).toISOString(), builds: { ...(prev.builds || {}) } };
  let n = 0;
  const due = core.refreshDue(builds, prev.builds || {}, nowMs);
  for (const b of due) {
    if (n >= core.MAX_REFRESH) break;
    const rec = { at: out.at, state: 'skipped' };
    const wt = wts[b.branch];
    const remote = git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${b.branch}`]).code === 0;
    if (!wt || !existsSync(wt) || !remote) { rec.why = 'no worktree or branch on GitHub here'; out.builds[b.id] = rec; continue; }
    if (!codeBehind({ s, git, br: b.branch })) { rec.state = 'current'; out.builds[b.id] = rec; continue; }
    const dirty = core.strayPlan(git(['status', '--porcelain', '--untracked-files=no'], { cwd: wt }).out);
    if (dirty.code.length || dirty.commit.length) { rec.why = 'its session has uncommitted changes; next turn'; rec.at = prev.builds?.[b.id]?.at || ''; out.builds[b.id] = rec; continue; }
    if (git(['rev-list', '--count', `HEAD..${s.remote}/${b.branch}`], { cwd: wt }).out !== '0') { rec.why = 'its worktree is behind GitHub; next turn'; out.builds[b.id] = rec; continue; }
    n++;
    const m = mergeMain({ s, git, b, dry, inPlace: wt });
    if (m.merged) Object.assign(rec, { state: 'merged', sha: m.sha, resolved: m.resolved || [] });
    else Object.assign(rec, { state: m.conflicts?.length ? 'clash' : 'failed', files: (m.conflicts || []).slice(0, 20), why: m.pushError || (m.conflicts?.length ? 'main clashes with it in code; its session resolves it' : '') });
    if (rec.state === 'merged') crewSay('landing', 'done', `${b.id} is still running: merged main into ${b.branch} so it stays current.`, { ref: b.id, repo: s.repo, dedupeMin: 25 });
    log(`refresh ${b.id}: ${rec.state}${rec.why ? ` (${rec.why})` : ''}`);
    out.builds[b.id] = rec;
  }
  // forget builds that are no longer running
  const live = new Set(builds.filter(core.isRunning).map((b) => b.id));
  for (const id of Object.keys(out.builds)) if (!live.has(id)) delete out.builds[id];
  if (!dry) writeJson(refreshFile(s), out);
  return out;
}

/** The .json files among `paths` that don't parse (a merge that settled them badly). */
export function badJson(wt, paths) {
  return (paths || []).filter((p) => p.endsWith('.json')).filter((p) => { try { JSON.parse(readFileSync(join(wt, p), 'utf8')); return false; } catch { return true; } });
}

// ------------------------------------------------------------------ step 3: PR + CI

const BAD = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);

/** CI on a commit from GitHub Actions only (a CodeRabbit "skipped" is not CI): success | failure | running | none. */
export function ciOf(runs) {
  const ours = (runs || []).filter((r) => (r?.app?.slug || 'github-actions') === 'github-actions' && r?.conclusion !== 'skipped');
  if (!ours.length) return { ci: 'none', failing: [] };
  if (ours.some((r) => r.status !== 'completed')) return { ci: 'running', failing: [] };
  const failing = ours.filter((r) => BAD.has(r.conclusion)).map((r) => String(r.name || '').slice(0, 120));
  return { ci: failing.length ? 'failure' : 'success', failing };
}

// ------------------------------------------------------------------ one round

export async function round({ s = settings(), git = makeGit(s.repo), gh = makeGitHub(s), api = makeConsole(s), dry = false, only = '', now = () => new Date(), agentJob = defaultAgentJob(s), log = () => {} } = {}) {
  const cfg = readConfig(s); const ctl = readControl(s); const prev = readState(s);
  const at = now().toISOString();
  if (!cfg.autoLand) { const st = { ...prev, $axf: core.LAND_FRAME, at, on: false, items: prev.items || [] }; if (!dry) writeJson(stateFile(s), st); return st; }
  const f = git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 });
  if (f.code) log(`fetch: ${f.err.slice(-200)}`);
  const storeText = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
  const store = storeText.code ? { builds: [] } : JSON.parse(storeText.out);
  const builds = (store.builds || []).filter((b) => !b.deleted);
  const byId = new Map(builds.map((b) => [b.id, b]));
  const prevItems = new Map((prev.items || []).map((x) => [x.id, x]));
  let cands = core.uniqueByBranch(builds.filter(core.isCandidate).filter((b) => !only || b.id === only));
  let merges = 0;
  const remoteHas = (br) => git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${br}`]).code === 0;
  const wts = worktrees(git);
  const contains = (a, b) => remoteHas(a.branch) && remoteHas(b.branch) && git(['merge-base', '--is-ancestor', `${s.remote}/${b.branch}`, `${s.remote}/${a.branch}`]).code === 0
    && git(['rev-list', '--count', `${s.remote}/${s.base}..${s.remote}/${b.branch}`]).out !== '0';
  let order = core.landOrder(cands, { after: ctl.after || {}, contains });
  const nowFirst = (ctl.now || []).filter((id) => order.some((o) => o.id === id));
  order = [...nowFirst.map((id) => order.find((o) => o.id === id)), ...order.filter((o) => !nowFirst.includes(o.id))];
  // GitHub calls stay near one a round (the token is shared with the banner and the reconciler): CI and mergeable are
  // kept per head and asked again only when the head, or main, moved, or CI was still running
  const mainSha = git(['rev-parse', `${s.remote}/${s.base}`]).out || '';
  let pulls = [];
  try { pulls = await gh('GET', `/repos/${s.slug}/pulls?state=open&per_page=100`); } catch (e) { log(`pulls: ${e.message}`); }
  const prOf = (br) => (Array.isArray(pulls) ? pulls : []).find((p) => p?.head?.ref === br && p?.base?.ref === s.base && (p?.head?.repo?.full_name || '').toLowerCase() === s.slug.toLowerCase());
  const queueOn = readQueueConfig(s).mergeQueue; const queued = queueOn ? readQueue(s) : {};
  const items = [];
  const candById = new Map(cands.map((c) => [c.id, c]));
  for (const o of order) {
    const b = candById.get(o.id);
    const it = { id: b.id, title: String(b.title || b.id).slice(0, 200), branch: b.branch, after: o.after, ...(b.alsoBuilds ? { alsoBuilds: b.alsoBuilds } : {}), pr: null, head: '', state: 'waiting', reason: null, since: '', checkedAt: at };
    const old = prevItems.get(b.id) || {};
    if (!core.buildOn(ctl, b.id)) { it.state = 'off'; it.reason = { kind: 'off', text: `${b.id}: auto-land is switched off for this build (${String(ctl.off[b.id]?.why || 'by hand').slice(0, 160)}). Switch it on to land it.`, quiet: true }; it.since = old.since || at; items.push(it); continue; }
    const facts = { held: ctl.holds?.[b.id] ? ctl.holds[b.id].why || true : '', waitUi: cfg.landWaitUi };
    try {
      if (!facts.held) {
        const wt = wts[b.branch];
        if (wt && existsSync(wt)) {
          const c = cleanWorktree({ s, git, b, wt, dry });
          if (c.settling) { it.state = 'settling'; it.reason = { kind: 'running', text: `${b.id}: its worktree changed in the last 10 minutes; lands once it settles.`, quiet: true }; items.push(it); continue; }
          if (c.code.length) facts.code = c.code;
          if (c.pushError) facts.pushError = c.pushError;
          it.cleaned = { committed: c.committed, archived: c.archived, skipped: c.skipped.length };
          if (c.committed.length || !remoteHas(b.branch)) git(['fetch', '-q', s.remote, `+refs/heads/${b.branch}:refs/remotes/${s.remote}/${b.branch}`]);
        }
        if (!remoteHas(b.branch) && !facts.pushError) facts.pushError = `${b.branch} is not on GitHub and has no worktree here`;
        let pr = prOf(b.branch);
        if (!facts.code && !facts.pushError) {
          const headNow = git(['rev-parse', `${s.remote}/${b.branch}`]).out || '';
          let mergeable = old.head === headNow && prev.mainSha === mainSha ? old.mergeable : undefined;
          if (pr && mergeable === undefined) { try { mergeable = (await gh('GET', `/repos/${s.slug}/pulls/${pr.number}`))?.mergeable; } catch { /* next round */ } }
          it.mergeable = typeof mergeable === 'boolean' ? mergeable : null;
          // with the merge queue on, main is combined in on the queue branch instead: pulling it into the branch would
          // change the head and make the queue test it twice. Only a real conflict (GitHub won't even run the PR checks)
          // gets main merged in, and never for a PR the queue is testing right now.
          const inStack = queueOn && pr && (queued.stack || []).some((e) => e.pr === pr.number);
          const wants = queueOn ? mergeable === false && !inStack : codeBehind({ s, git, br: b.branch }) || mergeable === false || nowFirst.includes(b.id);
          if (wants && merges >= core.MAX_MAIN_MERGES && !nowFirst.includes(b.id)) { it.state = 'queued'; it.reason = { kind: 'running', text: `${b.id}: waits its turn to have main merged in (${core.MAX_MAIN_MERGES} a round).`, quiet: true }; it.since = old.since || at; items.push(it); continue; }
          if (wants) {
            merges++;
            const m = mergeMain({ s, git, b, dry });
            if (m.conflicts?.length) facts.conflicts = m.conflicts;
            else if (m.pushError) facts.pushError = m.pushError;
            else if (m.merged) { it.mergedMain = { sha: m.sha, resolved: m.resolved || [], regenerated: m.regenerated || [] }; git(['fetch', '-q', s.remote, `+refs/heads/${b.branch}:refs/remotes/${s.remote}/${b.branch}`]); }
          }
          if (!pr && !facts.conflicts && !dry) {
            try { pr = await gh('POST', `/repos/${s.slug}/pulls`, { title: it.title.slice(0, 120), head: b.branch, base: s.base, body: `Build \`${b.id}\` is finished (every step done). Opened by auto-land: it merges by itself once CI is green on its head and UI Review doesn't hold it.\n\n${String(b.detail || '').slice(0, 1500)}` }); if (pr?.number) crewSay('landing', 'start', `${b.id} is finished. Opened PR #${pr.number} and CI is on it.`, { ref: b.id, repo: s.repo }); }
            catch (e) { facts.prError = e.message; }
          }
        }
        if (pr) { it.pr = pr.number; it.url = pr.html_url || ''; }
        it.head = git(['rev-parse', `${s.remote}/${b.branch}`]).out || '';
        if (it.head && !facts.code && !facts.conflicts && !facts.pushError) {
          if (old.head === it.head && ['success', 'failure'].includes(old.ci)) Object.assign(facts, { ci: old.ci, failing: old.failing || [] });
          else {
            let runs = [];
            try { runs = (await gh('GET', `/repos/${s.slug}/commits/${it.head}/check-runs?per_page=100`))?.check_runs || []; } catch { facts.ci = 'running'; }
            if (!facts.ci) Object.assign(facts, ciOf(runs));
          }
          it.ci = facts.ci; it.failing = facts.failing || [];
          if (facts.ci === 'none' && !dry && old.dispatched !== it.head) {
            try { await gh('POST', `/repos/${s.slug}/actions/workflows/${s.workflow}/dispatches`, { ref: b.branch }); it.dispatched = it.head; } catch (e) { log(`dispatch ${b.id}: ${e.message}`); }
          } else if (old.dispatched === it.head) it.dispatched = it.head;
        }
        if (it.pr) { const u = await api('GET', `/api/plugins/push-banner/ui-hold?branch=${encodeURIComponent(b.branch)}&pr=${it.pr}`); facts.ui = u ? String(u.hold || '') : 'unknown'; } // UI Review through ui-review@1
        facts.deps = o.after.filter((d) => { const x = byId.get(d); return x && !x.mergedAt && x.status !== 'complete' && x.status !== 'archived'; });
      }
      it.reason = core.blockReason(b.id, facts);
      it.state = !it.reason ? 'ready' : it.reason.quiet ? 'waiting' : 'blocked';
    } catch (e) { it.state = 'blocked'; it.reason = { kind: 'error', text: `${b.id}: the landing round failed (${String(e.message).slice(0, 160)}).` }; }
    it.since = old.reason?.kind === it.reason?.kind ? old.since || at : at;
    // one push per new reason; an agent only for a code conflict or red CI, once per head
    it.pushed = old.pushed || null; it.agent = old.agent || null;
    if (it.reason && !it.reason.quiet && core.shouldPush(old.pushed, it.reason, it.head)) {
      if (!dry) await api('POST', '/api/alerts', core.alertFor(it.reason, { pr: it.pr ? `#${it.pr}` : '', since: it.since }));
      if (!dry) {
        const text = it.reason.text.replace(`${b.id}: `, `${b.id}${it.pr ? ` (#${it.pr})` : ''}: `);
        if (reasonEvent(it.reason.kind) === 'waiting') crewSay('landing', 'waiting', `Brett, ${text}`, { ref: b.id, repo: s.repo });
        else if (reasonEvent(it.reason.kind) === 'failed') crewSay('landing', 'failed', text, { ref: b.id, repo: s.repo });
        else crewSay('landing', 'blocked', text, { ref: b.id, repo: s.repo });
      }
      it.pushed = { kind: it.reason.kind, head: it.head, at };
    }
    // a code clash or failing tests: a P0 "merge main and land" fix build, again and again until it lands (FYI each time)
    const fixes = readFixes(s);
    it.fix = fixes[b.id] || old.fix || null;
    if (it.reason?.agent && !dry) {
      const f = await requestFix({ s, api, b, reason: it.reason, head: it.head, pr: it.pr, prev: it.fix, at, nowMs: now().getTime(), agentJob });
      if (f) { it.fix = f; writeFixes(s, { ...readFixes(s), [b.id]: f }); if (f.via === 'agent') it.agent = { kind: it.reason.kind, head: it.head, at, ...f.job }; }
    }
    if (!it.reason && old.pushed && !dry) await api('POST', '/api/alerts/resolve', { keys: [core.alertKey(b.id)] });
    if (!it.reason && old.state !== 'ready' && !dry) crewSay('landing', 'done', `${b.id}${it.pr ? ` (#${it.pr})` : ''} is ready: CI green, nothing holds it. It joins the merge queue.`, { ref: b.id, repo: s.repo });
    items.push(it);
  }
  // running builds: main merged in every 30 minutes (never on a one-build round)
  if (!only) { try { refreshRunning({ s, git, builds, wts, dry, nowMs: now().getTime(), log }); } catch (e) { log(`refresh: ${e.message}`); } }
  // builds that left the list (merged, or no longer finished): their alert goes
  const gone = [...prevItems.keys()].filter((id) => !items.some((x) => x.id === id) && prevItems.get(id)?.pushed);
  if (gone.length && !dry && !only) await api('POST', '/api/alerts/resolve', { keys: gone.map(core.alertKey) });
  const st = { $axf: core.LAND_FRAME, at, on: true, waitUi: cfg.landWaitUi, mainSha, order: items.map((x) => x.pr).filter(Boolean), managed: items.map((x) => x.pr).filter(Boolean),
    items: only ? [...items, ...(prev.items || []).filter((x) => x.id !== only)] : items };
  if (!dry) { writeJson(stateFile(s), st); const c = readControl(s); if (c.now?.length) writeJson(controlFile(s), { ...c, now: c.now.filter((id) => !items.some((x) => x.id === id)) }); }
  return st;
}

/**
 * File the next fix attempt when one is due (land-core fixDue): through the console (POST /land/fix → the orchestrator's
 * axf.build-dispatch@1, P0, queued), else the old agent job. Brett gets an FYI alert per attempt. Returns the new fix
 * record, or null when nothing was due.
 */
export async function requestFix({ s, api, b, reason, head, pr, prev, at, nowMs = Date.now(), agentJob = defaultAgentJob(s) }) {
  if (!core.fixDue(prev, reason, head, nowMs)) return null;
  const attempt = (prev?.attempt || 0) + 1;
  const fb = core.fixBuildFor(b, reason, { attempt, pr });
  const r = await api('POST', '/api/plugins/push-banner/land/fix', fb);
  let rec;
  if (r && r.ok && r.id) rec = { attempt, head, at, kind: reason.kind, via: 'build', id: r.id, status: r.status || 'queued' };
  else {
    const job = core.agentJobFor(b, reason);
    const j = job ? agentJob(job) : { exit: 1, why: 'no job' };
    rec = { attempt, head, at, kind: reason.kind, via: 'agent', job: j, why: String(r?.detail || r?.error || 'the console did not take the fix build').slice(0, 200) };
  }
  await api('POST', '/api/alerts', core.fixFyi(b, reason, { attempt, fixId: rec.id || '', pr }));
  crewSay('landing', 'start', `${b.id}${pr ? ` (#${pr})` : ''}: ${reason.kind === 'conflict' ? 'clashes with main' : 'tests fail'}. Fix attempt ${attempt}${rec.id ? ` is build ${rec.id} (P0, queued)` : ' went to an agent'}.`, { ref: b.id, repo: s.repo });
  return rec;
}

function defaultAgentJob(s) {
  return (job) => {
    const args = [join(s.repo, 'framework/cli/agent-job.mjs'), job.type, ...Object.entries(job.input).flatMap(([k, v]) => ['--input', `${k}=${v}`]), '--json'];
    const r = spawnSync('node', args, { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch { /* plain text */ }
    return { job: job.type, exit: r.status ?? 1, session: out.session || '', why: r.status === 0 ? '' : (out.error || r.stdout || r.stderr || '').slice(-200) };
  };
}


async function runRound({ s, dry, json, opt, print }) {
  const gh = makeGitHub(s); // one client per run: one ETag cache, one count
  const st = await round({ s, gh, dry, only: opt('only'), log: (m) => !json && console.error(m) });
  // the merge queue takes its turn in the same round (same cron, same lock): it merges what auto-land made ready
  if (!opt('only')) {
    try { const git = makeGit(s.repo); const mq = await queueRound({ s, git, gh, api: makeConsole(s), dry, fetched: true, log: (m) => !json && console.error(m) }); st.queue = { on: mq.on, items: (mq.items || []).length, kicked: (mq.kicked || []).length }; }
    catch (e) { if (!json) console.error(`merge queue: ${e.message}`); }
  }
  // the sweeper: every 10 minutes, every finished build still not on main is landed or gets its fix build
  if (!opt('only')) { try { st.sweep = await sweep({ s, dry, log: (m) => !json && console.error(m) }); } catch (e) { if (!json) console.error(`sweep: ${e.message}`); } }
  gh.save(); st.github = { calls: gh.calls, cached: gh.cached, left: Number.isFinite(gh.left()) ? gh.left() : null };
  if (!json) console.error(`github: ${gh.calls} billed call(s), ${gh.cached} answered from cache (304)`);
  return print(st, st.on === false ? 'auto-land is off (Settings → Plugins → Push banner → Auto-land)' : st.items.map(line).join('\n') || 'no finished builds to land');
}

// ------------------------------------------------------------------ the sweeper (every 10 minutes)

export const sweepFile = (s) => join(s.dataDir, 'land-sweep.json');

/**
 * Every SWEEP_MS (or `force`): each finished build that is still not on main is landed or gets its fix build. Reads
 * what the last round and the merge queue found (no GitHub calls of its own): kicked out of the queue or a clash / red
 * CI → requestFix (P0 fix build, FYI); stuck on a push, a PR or a failed round for 30 min → first in line again. Also
 * drops fix records of builds that landed and clears the data folder's leftover *.tmp-* files.
 */
export async function sweep({ s, api = makeConsole(s), nowMs = Date.now(), dry = false, force = false, agentJob = defaultAgentJob(s), git = null, merge = mergeMain, log = () => {} } = {}) {
  const prev = readJson(sweepFile(s), {}) || {};
  // paused (land.mjs pause, POST /land/pause): the timed sweep stands still; an asked-for sweep (CLI sweep, POST
  // /land/sweep, which clears `at` and sets `requested`) still runs, the same through every channel
  const asked = force || Boolean(prev.requested && !prev.at);
  if (!asked && readControl(s).sweepPaused) return { ...prev, skipped: true, paused: readControl(s).sweepPaused };
  if (!force && nowMs - (Date.parse(prev.at || 0) || 0) < core.SWEEP_MS) return { ...prev, skipped: true };
  const at = new Date(nowMs).toISOString();
  const st = readState(s); const mq = readJson(join(s.dataDir, 'merge-queue.json'), {}) || {};
  const items = st.on === false ? [] : (st.items || []);
  const plan = core.sweepPlan(items, mq.waiting || [], nowMs);
  const fixes = readFixes(s); const done = [];
  const regen = { ...(prev.regen || {}) }; // build id → the head a regenerate merge was last tried on
  for (const p of plan) {
    const it = items.find((x) => x.id === p.id) || { id: p.id };
    const b = { id: p.id, title: it.title || p.id, branch: it.branch || '' };
    if (p.act === 'retry') { if (!dry) control(s, 'now', p.id); done.push({ id: p.id, act: 'retry' }); continue; }
    // a clash only in generated / data files: merge main again with the generated-files@1 regenerate step first
    if (b.branch && core.regenFirst(p.reason, p.head, regen[p.id])) {
      if (dry) { done.push({ id: p.id, act: 'regen', dry: true }); continue; }
      regen[p.id] = p.head || at;
      const m = merge({ s, git: git || makeGit(s.repo), b, dry: false, log });
      if (m.merged) { control(s, 'now', p.id); done.push({ id: p.id, act: 'regen', sha: m.sha, regenerated: m.regenerated || [] }); log(`sweep ${p.id}: main merged, generated files regenerated; back in line`); continue; }
      log(`sweep ${p.id}: regenerate merge did not land (${m.conflicts?.length ? `code: ${m.conflicts.join(', ')}` : m.pushError || 'not merged'}); fix build`);
      if (m.conflicts?.length) p.reason = core.blockReason(p.id, { conflicts: m.conflicts });
    }
    if (dry) { if (core.fixDue(fixes[p.id], p.reason, p.head, nowMs)) done.push({ id: p.id, act: 'fix', dry: true }); continue; }
    const f = await requestFix({ s, api, b, reason: p.reason, head: p.head, pr: p.pr, prev: fixes[p.id], at, nowMs, agentJob });
    if (f) { fixes[p.id] = f; done.push({ id: p.id, act: 'fix', attempt: f.attempt, fix: f.id || f.via }); }
  }
  // fix records of builds no longer waiting to land
  const live = new Set(items.map((x) => x.id));
  for (const id of Object.keys(fixes)) if (!live.has(id)) delete fixes[id];
  let tmpCleared = 0;
  if (!dry) {
    writeFixes(s, fixes);
    try {
      for (const f of readdirSync(s.dataDir)) {
        if (!/\.tmp-\d+$/.test(f)) continue;
        const p = join(s.dataDir, f);
        try { if (nowMs - statSync(p).mtimeMs > 3600e3) { rmSync(p, { force: true }); tmpCleared++; } } catch { /* gone */ }
      }
    } catch { /* no folder */ }
  }
  for (const id of Object.keys(regen)) if (!live.has(id)) delete regen[id];
  const out = { $axf: 'auto-land-sweep@1', at, acted: done, stuck: core.stuckItems(items, nowMs), tmpCleared, regen };
  if (!dry) writeJson(sweepFile(s), out);
  log(`sweep: ${done.length} acted, ${out.stuck.length} stuck over 30 min`);
  return out;
}

/** The sweeper's state, the same for the CLI (status), REST (GET /land/status) and MCP (push_banner_land_status). */
export function sweepStatus(s, nowMs = Date.now()) {
  const sw = readJson(sweepFile(s), {}) || {}; const ctl = readControl(s); const st = readState(s);
  return { $axf: 'auto-land-sweep@1', on: st.on !== false, paused: ctl.sweepPaused || null, at: sw.at || null, requested: sw.requested || null,
    everyMin: core.SWEEP_MS / 60000, acted: sw.acted || [], regen: sw.regen || {}, stuck: core.stuckItems(st.items || [], nowMs) };
}

// ------------------------------------------------------------------ CLI

const line = (x) => `${x.state.padEnd(8)} ${x.id}${x.pr ? ` #${x.pr}` : ''}${x.reason ? ` · ${x.reason.text.replace(`${x.id}: `, '')}` : ' · ready: merges at the next push banner round'}`;

export async function main(argv) {
  const json = argv.includes('--json'); const dry = argv.includes('--dry-run'); const waitLock = argv.includes('--wait-lock');
  const args = argv.filter((a) => !['--json', '--dry-run', '--wait-lock'].includes(a));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] || '' : ''; };
  const [cmd = 'list', ...rest] = args;
  const s = settings();
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const known = core.LAND_COMMANDS.find((c) => c.cli === cmd);
  if (cmd === 'serial') {
    // anything else that lands (vps.build_land, a session landing by hand) waits its turn in the same line
    const i = argv.indexOf('--'); const c = i >= 0 ? argv.slice(i + 1) : [];
    if (!c.length) throw new Error('serial -- <command …>');
    const r = await serial(() => spawnSync(c[0], c.slice(1), { stdio: 'inherit' }).status ?? 1, { who: c.join(' ').slice(0, 120) });
    if (!r.ran) { console.error(`the landing line stayed busy (${r.owner || 'unknown'})`); process.exitCode = 75; return; }
    process.exitCode = r.value; return;
  }
  if (cmd === 'sweep') {
    const r = await serial(() => sweep({ s, dry, force: true, log: (m) => !json && console.error(m) }), { wait: 60000, who: 'sweep' });
    if (!r.ran) return print({ ran: false, owner: r.owner }, `the landing line is busy (${r.owner || 'unknown'})`);
    return print(r.value, `${r.value.acted.map((a) => `${a.act.padEnd(6)} ${a.id}${a.fix ? ` → ${a.fix}` : ''}`).join('\n') || 'nothing to sweep'}${r.value.stuck.length ? `\nstuck over 30 min: ${r.value.stuck.map((x) => x.id).join(', ')}` : ''}`);
  }
  if (cmd === 'lock') return print({ owner: lockOwner(), dir: lockDir() }, lockOwner() ? `landing now: ${lockOwner()}` : 'the landing line is free');
  if (cmd === 'run') {
    // one landing at a time: the cron round skips when the line is busy, the finish hook's round waits for it
    if (!dry && !(await takeLandLock({ wait: waitLock ? core.LOCK_WAIT_MS : 0, who: `run${opt('only') ? ` --only ${opt('only')}` : ''}` }))) {
      return print({ ran: false, owner: lockOwner() }, `the landing line is busy (${lockOwner() || 'unknown'}); the build stays first in line for the next round`);
    }
    try { return await runRound({ s, dry, json, opt, print }); } finally { if (!dry) dropLandLock(); }
  }
  if (cmd === 'queue') return queueMain(argv.slice(argv.indexOf('queue') + 1));
  if (cmd === 'pause' || cmd === 'resume') {
    const d = control(s, cmd, '', { why: opt('why') });
    return print({ ok: true, ...sweepStatus(s), control: d }, cmd === 'pause' ? 'the sweeper is paused (rounds still land; land.mjs resume)' : 'the sweeper is on');
  }
  if (cmd === 'status') {
    const st = sweepStatus(s);
    return print(st, `sweeper ${st.paused ? `paused (${st.paused.why})` : 'on'} · last sweep ${st.at || 'never'}${st.acted.length ? `\n${st.acted.map((a) => `${a.act.padEnd(6)} ${a.id}${a.fix ? ` → ${a.fix}` : ''}`).join('\n')}` : ''}${st.stuck.length ? `\nstuck over 30 min: ${st.stuck.map((x) => x.id).join(', ')}` : ''}`);
  }
  if (cmd === 'line') {
    const st = readState(s); const ctl = readControl(s); const sw = readJson(sweepFile(s), {}) || {};
    const items = (st.items || []).filter((x) => !['ready', 'off'].includes(x.state));
    const nowList = ctl.now || [];
    items.sort((a, b) => (nowList.includes(a.id) ? nowList.indexOf(a.id) : 1e3) - (nowList.includes(b.id) ? nowList.indexOf(b.id) : 1e3));
    const stuck = core.stuckItems(st.items || []);
    return print({ on: st.on !== false, at: st.at, owner: lockOwner(), line: items.map((x) => ({ id: x.id, pr: x.pr, state: x.state, since: x.since })), stuck, sweep: { at: sw.at, acted: sw.acted || [] } },
      `${lockOwner() ? `landing now: ${lockOwner()}\n` : ''}${items.map(line).join('\n') || 'the landing line is empty'}${stuck.length ? `\nstuck over 30 min: ${stuck.map((x) => `${x.id} (${x.kind}${x.fix ? `, fix ${x.fix}` : ''})`).join(', ')}` : ''}`);
  }
  if (cmd === 'merge-main') {
    // one build (or branch) gets main merged in right now, by the round's rules: what a re-land after a lander fix needs
    const id = rest[0]; if (!id || id.startsWith('--')) throw new Error('merge-main <build|branch> [--dry-run]');
    const git = makeGit(s.repo);
    const f = git(['fetch', '-q', '--prune', s.remote], { timeout: 180000 }); if (f.code) throw new Error(`fetch: ${f.err.slice(-200)}`);
    const storeText = git(['show', `${s.remote}/${s.base}:_claude/builds/store.json`]);
    const builds = storeText.code ? [] : (JSON.parse(storeText.out).builds || []);
    const b = builds.find((x) => x.id === id && x.branch) || { id, branch: id.startsWith('claude/') || id.startsWith('refs/') ? id : `claude/${id}` };
    if (git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${b.branch}`]).code) throw new Error(`${b.branch} is not on ${s.remote}`);
    const m = mergeMain({ s, git, b, dry, log: (t) => !json && console.error(t) });
    const text = m.merged ? `${b.id}: main merged in${dry ? ' (dry run, not pushed)' : ''} at ${m.sha.slice(0, 8)}${m.resolved?.length ? `; resolved ${m.resolved.join(', ')}` : ''}${m.regenerated?.length ? `; regenerated ${m.regenerated.join(', ')}` : ''}`
      : m.conflicts?.length ? `${b.id}: code conflicts with main in ${m.conflicts.join(', ')}` : `${b.id}: ${m.pushError || 'not merged'}`;
    if (!m.merged) process.exitCode = 1;
    return print({ build: b.id, branch: b.branch, ...m }, text);
  }
  if (cmd === 'list' || cmd === 'blocked') {
    const st = readState(s); const items = (st.items || []).filter((x) => cmd === 'list' || x.state === 'blocked');
    return print({ ...st, items }, items.map(line).join('\n') || (cmd === 'blocked' ? 'nothing blocked' : 'no finished builds to land'));
  }
  if (known || ['after', 'off', 'on'].includes(cmd)) {
    const id = rest[0]; if (!id || id.startsWith('--')) throw new Error(`${cmd} <build>${cmd === 'after' ? ' <other>' : ''}`);
    const d = control(s, cmd, id, { why: opt('why'), after: rest[1] });
    return print({ ok: true, control: d }, `${cmd}: ${id}${cmd === 'after' ? ` after ${rest[1]}` : ''}`);
  }
  throw new Error('usage: land.mjs run [--dry-run] [--only <build>] | list | blocked | now <build> | hold <build> [--why …] | release <build> | off <build> [--why …] | on <build> | after <build> <other> | sweep | status | pause [--why …] | resume | lock | serial -- <cmd …> | merge-main <build> [--dry-run]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
