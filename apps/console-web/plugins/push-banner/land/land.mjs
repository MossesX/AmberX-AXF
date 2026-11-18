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
 *   … merge-main <build|branch> [--dry-run] [--json]   merge main into one build's branch now (same rules as a round)
 *   … queue list | add <pr> | remove <pr> | move <pr> <index>   the merge queue (merge-queue.mjs; it runs in every round)
 *   … tracking [<build>] [--json] | tracking-show on|off   what the lander did with each build's tracking files (last reset,
 *                                        take-main, regenerate); shown on the merge queue rows or not (landShowTracking)
 *
 * One round, per finished build (land-core.mjs isCandidate), in dependency order:
 *   1. its worktree: tracking files (framework/core/tracking-paths.mjs) reset to the branch's merge-base copy with
 *      main, never committed (PR 733); other synced files committed on its own branch; scratch files skipped, untracked copies of hub files
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
 * Settings (push banner config.json, Settings → Plugins → Push banner → Auto-land): autoLand (off since Nov 4 2026:
 * only the merge queue merges; Brett: "Stop merging these things one at a time"), landWaitUi (on).
 * Environment: AXF_LAND_REPO (checkout to run git in; default this file's repo), AXF_PUSH_BANNER_DIR (data folder;
 * default <AXF_CONSOLE_ROOT or /opt/axf>/.axf-console/plugins/push-banner), AXF_LAND_REPO_SLUG (MossesX/AmberX-AXF),
 * AXF_LAND_CONSOLE (docker container of the console, axf-console; "off" = no console calls), AXF_LAND_ARCHIVE
 * (/root/archive/auto-land), AXF_LAND_GITHUB_API (https://api.github.com), AXF_LAND_WORKFLOW (android.yml).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from './land-core.mjs';
import * as tracking from '../../../../../framework/core/tracking-paths.mjs';
import { waitFreeSync } from '../../../../../framework/cli/land-lock.mjs';
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

export function makeGit(cwd) {
  return (args, o = {}) => {
    const r = spawnSync('git', args, { cwd: o.cwd || cwd, encoding: 'utf8', timeout: o.timeout || 120000, maxBuffer: 64 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(o.env || {}) } });
    return { code: r.status ?? 1, out: (r.stdout || '').replace(/\s+$/, ''), err: (r.stderr || r.error?.message || '').trim() };
  };
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
export const controlFile = (s) => join(s.dataDir, 'land-control.json');
export const readState = (s) => readJson(stateFile(s), { $axf: core.LAND_FRAME, items: [] });
export const readControl = (s) => readJson(controlFile(s), { $axf: core.CONTROL_FRAME, holds: {}, now: [], after: {} });
export function readConfig(s) {
  const c = readJson(join(s.dataDir, 'config.json'), {}) || {};
  return { autoLand: c.autoLand === true, landWaitUi: c.landWaitUi !== false };
}
export function control(s, cmd, build, opts = {}) {
  const d = core.applyControl(readControl(s), cmd, build, opts);
  writeJson(controlFile(s), d);
  return d;
}

/**
 * What the lander did with each build's tracking files (tracking-paths@1), from land.json: { $axf, show, at, items:
 * [{ build, pr, branch, tracking: { reset?, takeMain?, regenerate? }, show }] }. `show` is the console_show target of
 * the merge queue view. The same shape as the push banner's GET /land/tracking.
 */
export function trackingState(s, build = '') {
  const st = readState(s); const cfg = readJson(join(s.dataDir, 'config.json'), {}) || {};
  const items = (st.items || []).filter((x) => !build || x.id === build).map((x) => ({ build: x.id, pr: x.pr || null, branch: x.branch || '', tracking: x.tracking || {}, show: 'function:push-banner.queue' }));
  return { $axf: 'auto-land-tracking@1', show: cfg.landShowTracking === true, at: st.at || null, items };
}

// ------------------------------------------------------------------ the build's worktree

/**
 * Every worktree of the repo, by branch. A branch can sit in more than one worktree (`worktree add --force`, a merge
 * left in /tmp): the build's own (the folder named after the branch's last segment, claude/<id> → …/<id>) wins, else
 * the first listed, so a stray checkout never stands in for the build's worktree.
 */
export function worktrees(git) {
  const out = {}; let cur = null;
  const own = (br, path) => path.split('/').pop() === br.split('/').pop();
  for (const l of git(['worktree', 'list', '--porcelain']).out.split('\n')) {
    if (l.startsWith('worktree ')) cur = { path: l.slice(9) };
    else if (l.startsWith('branch refs/heads/') && cur) {
      const br = l.slice(18);
      if (!out[br] || (own(br, cur.path) && !own(br, out[br]))) out[br] = cur.path;
    }
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

/** Files bigger than this are not backed up before a reset (journal parts: append-only, kept on main and the hub). */
const BACKUP_MAX = 8 << 20;

/**
 * Put tracking files (tracking-paths@1) back to the branch's merge-base copy with main, in the
 * build's worktree `wt`, instead of committing them: the dirty ones in `paths`, and any the branch itself committed
 * since it left main (a session's commit, an old auto-land commit). A file main's base lacks is dropped from the
 * index (the copy on disk stays, untracked). When the branch's commits carried any, one commit puts them back
 * ("Reset tracking files to main's base copy"), so the build's diff never shows them. Returns { reset, commit, base }.
 */
export function resetTracking({ s, git, b, wt, paths = [], dry = false }) {
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  const base = g(['merge-base', 'HEAD', `${s.remote}/${s.base}`]).out;
  if (!base) return { reset: [], commit: '', base: '', error: 'no merge-base with main' };
  const committed = g(['diff', '--name-only', base, 'HEAD', '--', ...trackingSpecs()]).out.split('\n').filter(Boolean);
  const all = [...new Set([...paths, ...committed])];
  if (dry || !all.length) return { reset: all, commit: '', base };
  const inBase = (p) => g(['cat-file', '-e', `${base}:${p}`]).code === 0;
  const out = [];
  for (const p of all) {
    const f = join(wt, p);
    try { if (existsSync(f) && statSync(f).size <= BACKUP_MAX) { const to = join(s.archive, b.id, 'tracking', p); mkdirSync(dirname(to), { recursive: true }); copyFileSync(f, to); } } catch { /* backup is best effort */ }
    const r = inBase(p) ? g(['checkout', base, '--', p]) : g(['rm', '-q', '--cached', '--ignore-unmatch', '--', p]);
    if (!r.code) out.push(p);
  }
  let commit = '';
  const staged = g(['diff', '--cached', '--name-only', 'HEAD', '--', ...out]).out.split('\n').filter(Boolean);
  if (staged.length) {
    const c = g(['-c', 'user.name=AXF auto-land', '-c', 'user.email=auto-land@amberxai.com', 'commit', '-q', '-m', `${b.id}: reset tracking files to main's base copy (auto-land; they live on main and the hub)`, '--', ...staged]);
    if (!c.code) commit = g(['rev-parse', 'HEAD']).out;
  }
  return { reset: out, commit, base };
}
const trackingSpecs = () => tracking.trackingPathspecs();

/**
 * Step 1: clean a finished build's worktree. Returns { code: [files], reset: [files], archived: [files], pushError }.
 * Tracking files are reset to the merge-base copy (resetTracking), never committed; other synced data is committed.
 */
export function cleanWorktree({ s, git, b, wt, dry, now = Date.now() }) {
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  const res = { committed: [], reset: [], resetCommit: '', archived: [], skipped: [], code: [], settling: false, pushError: '' };
  if (!dry) { try { writeFileSync(join(wt, '.claude-sync-hold'), `auto-land: ${b.id} is finished; claude-sync leaves this checkout alone.\n`); } catch { /* read-only checkout */ } }
  const hubHas = (p) => { const h = hubPath(s, wt, p); if (!h || !existsSync(h)) return false; try { return readFileSync(h).equals(readFileSync(join(wt, p))); } catch { return false; } };
  const plan = core.strayPlan(g(['status', '--porcelain', '--untracked-files=all']).out, hubHas);
  res.skipped = plan.skip; res.code = plan.code;
  // a session that wrote code here in the last 10 minutes may still be finishing: leave it this round (tracking files
  // are rewritten by builds-live all the time and never hold a landing)
  const fresh = [...plan.commit, ...plan.code].some((p) => { try { return now - statSync(join(wt, p)).mtimeMs < 10 * 60000; } catch { return false; } });
  if (fresh) { res.settling = true; return res; }
  if (dry) { const t = resetTracking({ s, git, b, wt, paths: plan.reset, dry: true }); return { ...res, committed: plan.commit, reset: t.reset, archived: [...plan.archive, ...plan.restore] }; }
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
    const c = g(['-c', 'user.name=AXF auto-land', '-c', 'user.email=auto-land@amberxai.com', 'commit', '-q', '-m', `${b.id}: commit synced files left in the worktree (auto-land; tracking files excluded)`, '--', ...plan.commit]);
    if (!c.code) res.committed = plan.commit;
  }
  const t = resetTracking({ s, git, b, wt, paths: plan.reset });
  res.reset = t.reset; res.resetCommit = t.commit;
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
 *   tracking     main's side (`mainSide`; a file main deleted is removed): tracking-paths@1, never a build's
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
  const resolved = []; const tracked = [];
  const stage = (p, n) => { const x = g(['show', `:${n}:${p}`]); return x.code ? '' : `${x.out}\n`; };
  // tracking files (tracking-paths@1): main's copy, whichever side main is; main deleted it = it goes (s6)
  const mainStage = mainSide === 'ours' ? 2 : 3;
  for (const p of plan.tracking) {
    const has = g(['cat-file', '-e', `:${mainStage}:${p}`]).code === 0;
    const r = has ? g(['checkout', `--${mainSide}`, '--', p]) : g(['rm', '-q', '--cached', '--ignore-unmatch', '--', p]);
    if (r.code === 0) { if (has) g(['add', '--', p]); resolved.push(p); tracked.push(p); log(`${p}: main's copy taken (tracking file)`); }
  }
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
  for (const gen of core.regenPlan([...plan.generated, ...plan.unionJson, ...plan.union])) {
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
  return { resolved, regenerated, skipped, tracking: tracked };
}

/**
 * Merge main into the branch in a temporary worktree and push the merge commit. Data conflicts are resolved by
 * land-core's rules (resolveConflicts); any code conflict aborts. Returns { merged, sha, conflicts: [code files],
 * resolved, regenerated, pushError }.
 */
export function mergeMain({ s, git, b, dry, log = () => {} }) {
  // never merge main while another build is landing (land-lock@1): wait for the lock, then take main fresh
  const free = waitFreeSync({ waitSec: Number(process.env.AXF_LAND_LOCK_WAIT || 600), onWait: (h) => log(`merge-main ${b.id}: ${h?.who ?? 'a build'} is landing; waiting for the landing lock`) });
  if (!free.ok) return { merged: false, conflicts: [], pushError: `${free.holder?.who ?? 'another build'} is still landing (landing lock); main is merged in next round` };
  git(['fetch', '-q', s.remote, s.base]);
  const dir = mkdtempSync(join(tmpdir(), 'axf-land-')); const wt = join(dir, 'wt');
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  const live = join(s.repo, 'framework/cli/builds-live.mjs');
  const drv = ['-c', `merge.axf-builds.driver=node "${live}" merge-driver %O %A %B %P`, '-c', 'user.name=AXF auto-land', '-c', 'user.email=auto-land@amberxai.com'];
  try {
    let r = git(['worktree', 'add', '-q', '--detach', wt, `${s.remote}/${b.branch}`]);
    if (r.code) return { merged: false, conflicts: [], pushError: `worktree: ${r.err.slice(-200)}` };
    const m = g([...drv, 'merge', '--no-edit', '-m', `Merge main into ${b.branch} (auto-land: builds files newer-wins, logs unioned, generated files regenerated)`, `${s.remote}/${s.base}`], { timeout: 180000 });
    let resolved = []; let regenerated = []; let trackingTaken = [];
    if (m.code) {
      const left = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
      if (!left.length) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `merge: ${m.err.slice(-200) || m.out.slice(-200)}` }; }
      // main is the side being merged in (theirs); its builds files win too (the newest status is on main)
      const res = resolveConflicts({ g, wt, dir, left, mainSide: 'theirs', buildsSide: 'theirs', log });
      if (res.conflicts) { g(['merge', '--abort']); return { merged: false, conflicts: res.conflicts }; }
      if (res.error) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `merge: ${res.error.slice(-300)}` }; }
      resolved = res.resolved; regenerated = res.regenerated; trackingTaken = res.tracking || [];
      const c = g([...drv, 'commit', '-q', '--no-edit']);
      if (c.code) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `commit: ${c.err.slice(-200)}` }; }
    }
    const sha = g(['rev-parse', 'HEAD']).out;
    if (dry) return { merged: true, sha, conflicts: [], resolved, regenerated, tracking: trackingTaken, dry: true };
    const p = g(['push', '-q', s.remote, `HEAD:refs/heads/${b.branch}`], { timeout: 90000 });
    return p.code ? { merged: false, conflicts: [], resolved, regenerated, tracking: trackingTaken, pushError: p.err.slice(-200) || 'push failed' } : { merged: true, sha, conflicts: [], resolved, regenerated, tracking: trackingTaken };
  } finally { git(['worktree', 'remove', '--force', wt]); rmSync(dir, { recursive: true, force: true }); }
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

export async function round({ s = settings(), git = makeGit(s.repo), gh = makeGitHub(s), api = makeConsole(s), dry = false, only = '', now = () => new Date(), agentJob = defaultAgentJob(s), buildRules = defaultBuildRules(s), log = () => {} } = {}) {
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
    const facts = { held: ctl.holds?.[b.id] ? ctl.holds[b.id].why || true : '', waitUi: cfg.landWaitUi };
    try {
      if (!facts.held) {
        const wt = wts[b.branch];
        if (wt && existsSync(wt)) {
          const c = cleanWorktree({ s, git, b, wt, dry });
          if (c.settling) { it.state = 'settling'; it.reason = { kind: 'running', text: `${b.id}: its worktree changed in the last 10 minutes; lands once it settles.`, quiet: true }; items.push(it); continue; }
          if (c.code.length) facts.code = c.code;
          if (c.pushError) facts.pushError = c.pushError;
          it.cleaned = { committed: c.committed, reset: c.reset, ...(c.resetCommit ? { resetCommit: c.resetCommit } : {}), archived: c.archived, skipped: c.skipped.length };
          if (c.reset.length || c.resetCommit) it.tracking = { ...(old.tracking || {}), reset: { at, files: c.reset.slice(0, 40), commit: c.resetCommit || '' } };
          else if (old.tracking) it.tracking = old.tracking;
          if (c.committed.length || c.resetCommit || !remoteHas(b.branch)) git(['fetch', '-q', s.remote, `+refs/heads/${b.branch}:refs/remotes/${s.remote}/${b.branch}`]);
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
            else if (m.merged) {
              it.mergedMain = { sha: m.sha, resolved: m.resolved || [], regenerated: m.regenerated || [] };
              if (m.tracking?.length || m.regenerated?.length) it.tracking = { ...(it.tracking || old.tracking || {}), ...(m.tracking?.length ? { takeMain: { at, files: m.tracking.slice(0, 40), sha: m.sha } } : {}), ...(m.regenerated?.length ? { regenerate: { at, generators: m.regenerated, sha: m.sha } } : {}) }; git(['fetch', '-q', s.remote, `+refs/heads/${b.branch}:refs/remotes/${s.remote}/${b.branch}`]);
            }
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
        // build rules at the gate (build-rules@1): once per head with green CI, in the build's worktree; the provider's
        // runner fixes what it can and commits it on the branch (a new head, so CI runs again); what is left blocks
        if (it.pr && facts.ci === 'success' && !dry) {
          if (old.rules?.head === it.head) it.rules = old.rules;
          else { const br = buildRules({ id: b.id, head: it.head, root: wts[b.branch] || '' }); if (br) it.rules = { head: it.head, ...br }; }
          if (it.rules) facts.rules = it.rules;
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
    if (it.reason?.agent && !(old.agent && old.agent.kind === it.reason.kind && old.agent.head === it.head)) {
      const job = core.agentJobFor(b, it.reason);
      if (job && !dry) {
        it.agent = { kind: it.reason.kind, head: it.head, at, ...agentJob(job) };
        if (it.agent.exit === 0) crewSay('landing', 'start', `Handed ${b.id} to ${it.agent.session || 'an agent'} for the ${it.reason.kind === 'ci' ? 'red CI' : 'code conflict'}.`, { ref: b.id, repo: s.repo });
      }
    }
    if (!it.reason && old.pushed && !dry) await api('POST', '/api/alerts/resolve', { keys: [core.alertKey(b.id)] });
    if (!it.reason && old.state !== 'ready' && !dry) crewSay('landing', 'done', `${b.id}${it.pr ? ` (#${it.pr})` : ''} is ready: CI green, nothing holds it. It joins the merge queue.`, { ref: b.id, repo: s.repo });
    items.push(it);
  }
  // done-means-merged@1: one log with the builds (attempts, landing) and CI on the merge commit of what merged
  if (!dry) { try { await shareWithBuilds({ s, gh, items, prevItems, byId, builds, at, log }); } catch (e) { log(`share: ${e.message}`); } }
  // builds that left the list (merged, or no longer finished): their alert goes
  const gone = [...prevItems.keys()].filter((id) => !items.some((x) => x.id === id) && prevItems.get(id)?.pushed);
  if (gone.length && !dry && !only) await api('POST', '/api/alerts/resolve', { keys: gone.map(core.alertKey) });
  const st = { $axf: core.LAND_FRAME, at, on: true, waitUi: cfg.landWaitUi, mainSha, order: items.map((x) => x.pr).filter(Boolean), managed: items.map((x) => x.pr).filter(Boolean),
    items: only ? [...items, ...(prev.items || []).filter((x) => x.id !== only)] : items };
  if (!dry) { writeJson(stateFile(s), st); const c = readControl(s); if (c.now?.length) writeJson(controlFile(s), { ...c, now: c.now.filter((id) => !items.some((x) => x.id === id)) }); }
  return st;
}

// ------------------------------------------------------------------ one log with the builds (done-means-merged@1)

/** Run a framework CLI in the repo (this folder imports only node built-ins: the builds store is reached as a child process). */
function storeCli(s, file, args) {
  const r = spawnSync('node', [join(s.repo, file), ...args, '--json'], { cwd: s.repo, encoding: 'utf8', timeout: 60000 });
  let out = null; try { out = JSON.parse((r.stdout || '').trim().split('\n').pop() || 'null'); } catch { /* plain text */ }
  return { code: r.status ?? 1, out, err: (r.stderr || '').slice(-300) };
}

/**
 * The lander's side of done-means-merged@1: every try it makes (main merged in, a fix agent for a clash or red CI) goes
 * into the build's attempts[] (builds-store attempt), a finished build it owns is `landing`, and a merged build gets CI
 * on its merge commit recorded (builds-live link --sha --ci): green = landed (complete only after the verify), red = a
 * ci-red failure on the build (builds-store fail), so the ladder answers it. Never complete here.
 */
export async function shareWithBuilds({ s, gh, items, prevItems, byId, builds, at, log = () => {} }) {
  for (const it of items) {
    const b = byId.get(it.id); if (!b) continue;
    for (const op of core.shareOps(b, it, prevItems.get(it.id) || {}, at)) {
      const r = op.op === 'status' ? storeCli(s, 'framework/cli/builds-store.mjs', ['set-status', b.id, op.to, '--by', 'auto-lander'])
        : op.op === 'add' ? storeCli(s, 'framework/cli/builds-store.mjs', ['attempt', b.id, '--attempt', JSON.stringify(op.attempt), '--by', 'auto-lander'])
          : storeCli(s, 'framework/cli/builds-store.mjs', ['attempt', b.id, '--close', op.result, '--source', 'auto-lander', '--note', op.note, '--by', 'auto-lander']);
      if (r.code) log(`share ${b.id} ${op.op}: ${r.err || 'failed'}`);
    }
  }
  for (const b of core.mergeFollow(builds)) {
    const n = Number(String(b.pr).replace(/\D/g, '')); if (!n) continue;
    let pr = null; try { pr = await gh('GET', `/repos/${s.slug}/pulls/${n}`); } catch (e) { log(`merge follow ${b.id}: ${e.message}`); continue; }
    const sha = String(pr?.merge_commit_sha || ''); if (!pr?.merged_at || !sha) continue;
    let runs = []; try { runs = (await gh('GET', `/repos/${s.slug}/commits/${sha}/check-runs?per_page=100`))?.check_runs || []; } catch { continue; }
    const c = ciOf(runs); const ci = c.ci === 'none' ? 'running' : c.ci;
    if (b.landed?.sha === sha && b.landed?.ci === ci) continue;
    const runUrl = String(runs.find((x) => x?.html_url)?.html_url || '').slice(0, 300);
    const r = storeCli(s, 'framework/cli/builds-live.mjs', ['link', b.id, '--merged', pr.merged_at, '--sha', sha, '--ci', ci, ...(runUrl ? ['--ci-run', runUrl] : [])]);
    if (r.code) { log(`merge follow ${b.id}: ${r.err || 'link failed'}`); continue; }
    if (ci === 'failure') storeCli(s, 'framework/cli/builds-store.mjs', ['fail', b.id, '--kind', 'ci-red', '--why', `CI is red on main after the merge (${(c.failing || []).slice(0, 3).join(', ') || 'checks failed'})`, '--head', sha, '--by', 'auto-lander']);
    if (ci === 'success') crewSay('landing', 'done', `${b.id} (#${n}) merged and CI is green on main: landed. Complete once its verify passes.`, { ref: b.id, repo: s.repo });
  }
}

/**
 * The build rules check at the gate: the runner of the plugin that provides service:axf.build-rules@1 (found by
 * capability, never by folder name), phase gate, in the build's worktree with --commit. → { ok, failing, fixed, commit }
 * or null (no provider, AXF_LAND_BUILD_RULES=off, or the runner gave no answer: the round does not block on it).
 */
export function buildRulesProvider(repo) {
  const base = join(repo, 'apps/console-web/plugins');
  let dirs = []; try { dirs = readdirSync(base).sort(); } catch { return ''; }
  for (const d of dirs) {
    const m = readJson(join(base, d, 'plugin.json'), null);
    if (m && Array.isArray(m.provides) && m.provides.includes('service:axf.build-rules@1') && existsSync(join(base, d, 'build-rules-runner.mjs'))) return join(base, d, 'build-rules-runner.mjs');
  }
  return '';
}
function defaultBuildRules(s) {
  return ({ id, root }) => {
    if (process.env.AXF_LAND_BUILD_RULES === 'off') return null;
    // the phase is named 'gate' in build-rules@1 (axf-not-plugin:gate)
    const runner = buildRulesProvider(s.repo);
    if (!runner) return null;
    const r = spawnSync(process.execPath, [runner, 'run', '--build', id, '--phase', 'gate', /* axf-not-plugin:gate */ '--by', 'lander', '--json', ...(root ? ['--root', root, '--commit'] : [])], { cwd: s.repo, encoding: 'utf8', timeout: 20 * 60 * 1000 });
    let out = null; try { out = JSON.parse(r.stdout); } catch { return null; }
    const runs = Array.isArray(out?.runs) ? out.runs : [];
    return { ok: !!out.ok, failing: runs.filter((x) => x.result === 'fail').map((x) => x.id), fixed: runs.filter((x) => x.result === 'fixed').map((x) => x.id), ...(out.commit?.sha ? { commit: out.commit.sha } : {}) };
  };
}

function defaultAgentJob(s) {
  return (job) => {
    const args = [join(s.repo, 'framework/cli/agent-job.mjs'), job.type, ...Object.entries(job.input).flatMap(([k, v]) => ['--input', `${k}=${v}`]), '--json'];
    const r = spawnSync('node', args, { cwd: s.repo, encoding: 'utf8', timeout: 120000 });
    let out = {}; try { out = JSON.parse(r.stdout || '{}'); } catch { /* plain text */ }
    return { job: job.type, exit: r.status ?? 1, session: out.session || '', why: r.status === 0 ? '' : (out.error || r.stdout || r.stderr || '').slice(-200) };
  };
}

// ------------------------------------------------------------------ CLI

const line = (x) => `${x.state.padEnd(8)} ${x.id}${x.pr ? ` #${x.pr}` : ''}${x.reason ? ` · ${x.reason.text.replace(`${x.id}: `, '')}` : ' · ready: merges at the next push banner round'}`;

export async function main(argv) {
  const json = argv.includes('--json'); const dry = argv.includes('--dry-run');
  const args = argv.filter((a) => !['--json', '--dry-run'].includes(a));
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] || '' : ''; };
  const [cmd = 'list', ...rest] = args;
  const s = settings();
  const print = (o, text) => console.log(json ? JSON.stringify(o) : text);
  const known = core.LAND_COMMANDS.find((c) => c.cli === cmd);
  if (cmd === 'run') {
    const gh = makeGitHub(s); // one client per run: one ETag cache, one count
    const st = await round({ s, gh, dry, only: opt('only'), log: (m) => !json && console.error(m) });
    // the merge queue takes its turn in the same round (same cron, same lock): it merges what auto-land made ready
    if (!opt('only')) {
      try { const git = makeGit(s.repo); const mq = await queueRound({ s, git, gh, api: makeConsole(s), dry, fetched: true, log: (m) => !json && console.error(m) }); st.queue = { on: mq.on, items: (mq.items || []).length, kicked: (mq.kicked || []).length }; }
      catch (e) { if (!json) console.error(`merge queue: ${e.message}`); }
    }
    gh.save(); st.github = { calls: gh.calls, cached: gh.cached, left: Number.isFinite(gh.left()) ? gh.left() : null };
    if (!json) console.error(`github: ${gh.calls} billed call(s), ${gh.cached} answered from cache (304)`);
    return print(st, st.on === false ? 'auto-land is off (Settings → Plugins → Push banner → Auto-land)' : st.items.map(line).join('\n') || 'no finished builds to land');
  }
  if (cmd === 'queue') return queueMain(argv.slice(argv.indexOf('queue') + 1));
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
  if (cmd === 'tracking') {
    // what the lander did with each build's tracking files (item.tracking in land.json): REST GET /land/tracking, MCP land-tracking
    const t = trackingState(s, rest[0] && !rest[0].startsWith('--') ? rest[0] : '');
    const when = (x) => (x ? `${x.at.slice(0, 16).replace('T', ' ')} (${(x.files || x.generators || []).length})` : '-');
    return print(t, t.items.map((x) => `${x.build}${x.pr ? ` #${x.pr}` : ''}: reset ${when(x.tracking.reset)} · take-main ${when(x.tracking.takeMain)} · regenerate ${when(x.tracking.regenerate)}`).join('\n') || 'no finished builds to land');
  }
  if (cmd === 'tracking-show') {
    const v = rest[0]; if (!['on', 'off', 'true', 'false'].includes(v)) throw new Error('tracking-show on|off');
    const f = join(s.dataDir, 'config.json'); writeJson(f, { ...(readJson(f, {}) || {}), landShowTracking: v === 'on' || v === 'true' });
    return print(trackingState(s), `tracking-file handling on the merge queue rows: ${v === 'on' || v === 'true' ? 'shown' : 'hidden'}`);
  }
  if (cmd === 'list' || cmd === 'blocked') {
    const st = readState(s); const items = (st.items || []).filter((x) => cmd === 'list' || x.state === 'blocked');
    return print({ ...st, items }, items.map(line).join('\n') || (cmd === 'blocked' ? 'nothing blocked' : 'no finished builds to land'));
  }
  if (known || cmd === 'after') {
    const id = rest[0]; if (!id || id.startsWith('--')) throw new Error(`${cmd} <build>${cmd === 'after' ? ' <other>' : ''}`);
    const d = control(s, cmd, id, { why: opt('why'), after: rest[1] });
    return print({ ok: true, control: d }, `${cmd}: ${id}${cmd === 'after' ? ` after ${rest[1]}` : ''}`);
  }
  throw new Error('usage: land.mjs run [--dry-run] [--only <build>] | list | blocked | tracking [<build>] | tracking-show on|off | now <build> | hold <build> [--why …] | release <build> | after <build> <other> | merge-main <build> [--dry-run]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
