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
 *   … queue list | add <pr> | remove <pr> | move <pr> <index>   the merge queue (merge-queue.mjs; it runs in every round)
 *
 * One round, per finished build (land-core.mjs isCandidate), in dependency order:
 *   1. its worktree: synced files committed on its own branch, scratch files skipped, untracked copies of hub files
 *      moved to /root/archive/auto-land/<build>/, `.claude-sync-hold` written so claude-sync stops dropping files in;
 *      code changes never committed stop it (reason `code`); the branch is pushed when it is ahead of GitHub;
 *   2. main merged in (a temporary worktree, never the build's): only when main moved in code (status-only `[skip ci]`
 *      commits under _claude/ don't count) or GitHub says the PR conflicts. Builds files newer-wins (builds-live.mjs
 *      merge driver), STATUS / decisions / logs unioned, generated files from main then regenerated, code
 *      conflicts abort (reason `conflict`, an agent job);
 *   3. its PR opened when it has none; CI started (workflow_dispatch) when nothing ran on the head;
 *   4. the reason it waits (land-core.mjs blockReason) written to land.json; a new reason is pushed to Brett once
 *      (console alert, key land:<build>), and resolved when it lands.
 *
 * Settings (push banner config.json, Settings → Plugins → Push banner → Auto-land): autoLand (off since Nov 4 2026:
 * only the merge queue merges; Brett: "Stop merging these things one at a time"), landWaitUi (on).
 * Environment: AXF_LAND_REPO (checkout to run git in; default this file's repo), AXF_PUSH_BANNER_DIR (data folder;
 * default <AXF_CONSOLE_ROOT or /opt/axf>/.axf-console/plugins/push-banner), AXF_LAND_REPO_SLUG (MossesX/AmberX-AXF),
 * AXF_LAND_CONSOLE (docker container of the console, axf-console; "off" = no console calls), AXF_LAND_ARCHIVE
 * (/root/archive/auto-land), AXF_LAND_GITHUB_API (https://api.github.com), AXF_LAND_WORKFLOW (android.yml).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
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
 * Merge main into the branch in a temporary worktree and push the merge commit. Data conflicts are resolved by
 * land-core's rules; any code conflict aborts. Returns { merged, sha, conflicts: [code files], resolved, pushError }.
 */
export function mergeMain({ s, git, b, dry }) {
  const dir = mkdtempSync(join(tmpdir(), 'axf-land-')); const wt = join(dir, 'wt');
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  const live = join(s.repo, 'framework/cli/builds-live.mjs');
  const drv = ['-c', `merge.axf-builds.driver=node "${live}" merge-driver %O %A %B %P`, '-c', 'user.name=AXF auto-land', '-c', 'user.email=auto-land@amberxai.com'];
  try {
    let r = git(['worktree', 'add', '-q', '--detach', wt, `${s.remote}/${b.branch}`]);
    if (r.code) return { merged: false, conflicts: [], pushError: `worktree: ${r.err.slice(-200)}` };
    const m = g([...drv, 'merge', '--no-edit', '-m', `Merge main into ${b.branch} (auto-land: builds files newer-wins, logs unioned)`, `${s.remote}/${s.base}`], { timeout: 180000 });
    const resolved = [];
    if (m.code) {
      const left = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
      if (!left.length) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `merge: ${m.err.slice(-200) || m.out.slice(-200)}` }; }
      const plan = core.planConflicts(left);
      if (plan.code.length) { g(['merge', '--abort']); return { merged: false, conflicts: plan.code }; }
      for (const p of plan.builds) { if (g(['checkout', '--theirs', '--', p]).code === 0) { g(['add', '--', p]); resolved.push(p); } }
      for (const p of plan.union) {
        const stage = (n) => { const x = g(['show', `:${n}:${p}`]); return x.code ? '' : `${x.out}\n`; };
        const f = (n, t) => { const q = join(dir, `${n}.txt`); writeFileSync(q, t); return q; };
        const ours = f('ours', stage(2)); const base = f('base', stage(1)); const theirs = f('theirs', stage(3));
        g(['merge-file', '--union', ours, base, theirs]);
        writeFileSync(join(wt, p), readFileSync(ours)); g(['add', '--', p]); resolved.push(p);
      }
      for (const p of plan.generated) { g(['checkout', '--theirs', '--', p]); const cmd = core.regenFor(p); if (cmd) spawnSync(cmd[0], cmd.slice(1), { cwd: wt, timeout: 120000 }); g(['add', '--', p]); resolved.push(p); }
      const still = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
      if (still.length) { g(['merge', '--abort']); return { merged: false, conflicts: still }; }
      const c = g([...drv, 'commit', '-q', '--no-edit']);
      if (c.code) { g(['merge', '--abort']); return { merged: false, conflicts: [], pushError: `commit: ${c.err.slice(-200)}` }; }
    }
    const sha = g(['rev-parse', 'HEAD']).out;
    if (dry) return { merged: true, sha, conflicts: [], resolved, dry: true };
    const p = g(['push', '-q', s.remote, `HEAD:refs/heads/${b.branch}`], { timeout: 90000 });
    return p.code ? { merged: false, conflicts: [], resolved, pushError: p.err.slice(-200) || 'push failed' } : { merged: true, sha, conflicts: [], resolved };
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
            else if (m.merged) { it.mergedMain = { sha: m.sha, resolved: m.resolved || [] }; git(['fetch', '-q', s.remote, `+refs/heads/${b.branch}:refs/remotes/${s.remote}/${b.branch}`]); }
          }
          if (!pr && !facts.conflicts && !dry) {
            try { pr = await gh('POST', `/repos/${s.slug}/pulls`, { title: it.title.slice(0, 120), head: b.branch, base: s.base, body: `Build \`${b.id}\` is finished (every step done). Opened by auto-land: it merges by itself once CI is green on its head and UI Review doesn't hold it.\n\n${String(b.detail || '').slice(0, 1500)}` }); }
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
      it.pushed = { kind: it.reason.kind, head: it.head, at };
    }
    if (it.reason?.agent && !(old.agent && old.agent.kind === it.reason.kind && old.agent.head === it.head)) {
      const job = core.agentJobFor(b, it.reason);
      if (job && !dry) it.agent = { kind: it.reason.kind, head: it.head, at, ...agentJob(job) };
    }
    if (!it.reason && old.pushed && !dry) await api('POST', '/api/alerts/resolve', { keys: [core.alertKey(b.id)] });
    items.push(it);
  }
  // builds that left the list (merged, or no longer finished): their alert goes
  const gone = [...prevItems.keys()].filter((id) => !items.some((x) => x.id === id) && prevItems.get(id)?.pushed);
  if (gone.length && !dry && !only) await api('POST', '/api/alerts/resolve', { keys: gone.map(core.alertKey) });
  const st = { $axf: core.LAND_FRAME, at, on: true, waitUi: cfg.landWaitUi, mainSha, order: items.map((x) => x.pr).filter(Boolean), managed: items.map((x) => x.pr).filter(Boolean),
    items: only ? [...items, ...(prev.items || []).filter((x) => x.id !== only)] : items };
  if (!dry) { writeJson(stateFile(s), st); const c = readControl(s); if (c.now?.length) writeJson(controlFile(s), { ...c, now: c.now.filter((id) => !items.some((x) => x.id === id)) }); }
  return st;
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
  if (cmd === 'list' || cmd === 'blocked') {
    const st = readState(s); const items = (st.items || []).filter((x) => cmd === 'list' || x.state === 'blocked');
    return print({ ...st, items }, items.map(line).join('\n') || (cmd === 'blocked' ? 'nothing blocked' : 'no finished builds to land'));
  }
  if (known || cmd === 'after') {
    const id = rest[0]; if (!id || id.startsWith('--')) throw new Error(`${cmd} <build>${cmd === 'after' ? ' <other>' : ''}`);
    const d = control(s, cmd, id, { why: opt('why'), after: rest[1] });
    return print({ ok: true, control: d }, `${cmd}: ${id}${cmd === 'after' ? ` after ${rest[1]}` : ''}`);
  }
  throw new Error('usage: land.mjs run [--dry-run] [--only <build>] | list | blocked | now <build> | hold <build> [--why …] | release <build> | after <build> <other>');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
