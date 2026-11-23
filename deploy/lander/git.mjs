/**
 * Lander git + GitHub operations (lander@1). Ported from the retired push banner auto-land runner (land.mjs: the git
 * runner, the ETag-cached GitHub client, the conflict resolver) and extended for Pipeline 2.0's one-PR landing:
 *   combineSteps   every step branch of a group merged into one PR branch (lander/<build>[-k]) in a temporary worktree
 *   pullMain       origin/main merged into the PR branch (data files resolve by land-rules.mjs; code conflicts stop)
 *   diffLines      lines a branch changes against main (the size cap's measure; tracking files left out)
 * Nothing here pushes to main or merges a PR: run.mjs does the one merge, through GitHub, sha pinned.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as R from './land-rules.mjs';
import { numstatLines } from './lander-core.mjs';

export const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
// axf-data: not data (host-local runner files: heartbeat, pause switch, GitHub ETag cache; build state goes to the builds store)
export function writeJson(f, v) { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.tmp-${process.pid}`; writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); renameSync(t, f); }

export function makeGit(cwd) {
  return (args, o = {}) => {
    const r = spawnSync('git', args, { cwd: o.cwd || cwd, encoding: 'utf8', timeout: o.timeout || 120000, maxBuffer: 64 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(o.env || {}) } });
    return { code: r.status ?? 1, out: (r.stdout || '').replace(/\s+$/, ''), err: (r.stderr || r.error?.message || '').trim() };
  };
}

/** GitHub REST with the token broker's token (never printed, never logged).
 *  Save compute (Brett, Nov 4 2026: "Save the compute"): every GET is cached with its ETag in the lander's data
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
    const r = await fetch(`${s.api}${path}`, { method, redirect: 'error', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'axf-lander', ...(hit?.etag ? { 'If-None-Match': hit.etag } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
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
  /**
   * A text resource behind a redirect (a job's log): the API call carries the token and is never followed; the
   * signed URL it points at is fetched without the token. → the last `tail` characters, '' when it can't be read.
   */
  gh.text = async (path, tail = 4000) => {
    tok ??= token() || '';
    if (!tok) return '';
    try {
      let r = await fetch(`${s.api}${path}`, { redirect: 'manual', headers: { Authorization: `Bearer ${tok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'axf-lander' }, signal: AbortSignal.timeout(20000) });
      gh.calls++;
      const to = r.status >= 300 && r.status < 400 ? r.headers.get('location') : '';
      if (to) { if (!/^https:\/\//.test(to)) return ''; r = await fetch(to, { redirect: 'error', headers: { 'User-Agent': 'axf-lander' }, signal: AbortSignal.timeout(30000) }); }
      if (!r.ok) return '';
      return (await r.text()).slice(-tail);
    } catch { return ''; }
  };
  gh.calls = 0; gh.cached = 0; gh.save = save; gh.left = () => remaining;
  return gh;
}

export function brokerToken(s) {
  const r = spawnSync('node', [join(s.repo, 'framework/cli/github-token.mjs'), 'token'], { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

const IDENT = ['-c', 'user.name=AXF lander', '-c', 'user.email=lander@amberxai.com'];
const driver = (s) => ['-c', `merge.axf-builds.driver=node "${join(s.repo, 'framework/cli/builds-live.mjs')}" merge-driver %O %A %B %P`, ...IDENT];

/** Lines `br` changes against main (merge-base diff, tracking files left out). -1 when the branch can't be read. */
export function diffLines({ s, git, br }) {
  const r = git(['diff', '--numstat', `${s.remote}/${s.base}...${s.remote}/${br}`]);
  return r.code ? -1 : numstatLines(r.out, R.trackingPath);
}

/** The files `br` changes against main (merge-base diff, tracking files left out). */
export function changedFiles({ s, git, br }) {
  const r = git(['diff', '--name-only', `${s.remote}/${s.base}...${s.remote}/${br}`]);
  return r.code ? [] : r.out.split('\n').filter((p) => p && !R.trackingPath(p));
}

/** Does the branch lack code from main (anything but status-only commits)? */
export function codeBehind({ s, git, br }) {
  const msgs = git(['log', '--format=%s', `${s.remote}/${br}..${s.remote}/${s.base}`]).out.split('\n').filter(Boolean);
  if (!msgs.length) return false;
  const files = git(['diff', '--name-only', `${s.remote}/${br}...${s.remote}/${s.base}`]).out.split('\n').filter(Boolean);
  return !R.statusOnly(msgs, files);
}

/** The newest main and PR branch from the remote, right now (the tick's own fetch may be minutes old). → '' or the error. */
export function fetchFresh({ s, git, branch }) {
  const refs = [s.base, branch].filter(Boolean).map((b) => `+refs/heads/${b}:refs/remotes/${s.remote}/${b}`);
  const r = git(['fetch', '-q', s.remote, ...refs], { timeout: 180000 });
  return r.code ? (r.err.slice(-200) || 'fetch failed') : '';
}

/** A temporary detached worktree at `ref`, handed to fn(g, wt, dir); always removed. */
function inWorktree({ git, ref }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'axf-lander-')); const wt = join(dir, 'wt');
  const g = (a, o = {}) => git(a, { ...o, cwd: wt });
  try {
    const r = git(['worktree', 'add', '-q', '--detach', wt, ref]);
    if (r.code) return { ok: false, error: `worktree: ${r.err.slice(-200)}` };
    return fn(g, wt, dir);
  } finally { git(['worktree', 'remove', '--force', wt]); rmSync(dir, { recursive: true, force: true }); }
}

/** Merge `ref` into the worktree with the merge rules. → { ok, sha } | { ok: false, conflicts } | { ok: false, error }. */
function mergeIn({ s, g, wt, dir, ref, message, mainSide, buildsSide, log }) {
  const m = g([...driver(s), 'merge', '--no-ff', '--no-edit', '-m', message, ref], { timeout: 180000 });
  if (!m.code) return { ok: true, resolved: [], regenerated: [], tracking: [] };
  const left = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
  if (!left.length) { g(['merge', '--abort']); return { ok: false, error: `merge: ${(m.err || m.out).slice(-200)}` }; }
  const res = resolveConflicts({ g, wt, dir, left, mainSide, buildsSide, log });
  if (res.conflicts) { g(['merge', '--abort']); return { ok: false, conflicts: res.conflicts }; }
  if (res.error) { g(['merge', '--abort']); return { ok: false, error: res.error.slice(-300) }; }
  const c = g([...driver(s), 'commit', '-q', '--no-edit']);
  if (c.code) { g(['merge', '--abort']); return { ok: false, error: `commit: ${c.err.slice(-200)}` }; }
  return { ok: true, resolved: res.resolved, regenerated: res.regenerated, tracking: res.tracking || [] };
}

/**
 * merging-pr: every branch of the group merged into one PR branch, starting from the first. Step-into-step data
 * conflicts resolve by the merge rules (tracking files: the first branch's copy, they never land anyway); a code
 * conflict between two steps stops it ({ conflicts, between }: the incoming branch and the earlier branch it really
 * clashes with, found by merging the two alone). The PR branch is the lander's own: it is rebuilt and
 * force-pushed (lease on what the lander last saw) until its PR exists, never after.
 * → { ok, sha, branch } | { ok: false, conflicts, between } | { ok: false, error }
 */
export function combineSteps({ s, git, branch, branches, dry = false, log = () => {} }) {
  const named = [...new Set(branches.filter(Boolean))];
  if (!named.length) return { ok: false, error: 'no step branches' };
  // a step branch that is not on GitHub: one whose session committed nothing has nothing to land and is left out; one
  // that committed and never pushed is pushed from the host's own checkout (the step worktrees are its branches).
  // Nov 23 2026: a ten-step build could not land because one step had found nothing to change.
  const list = [];
  for (const br of named) {
    if (!git(['rev-parse', '-q', '--verify', `refs/remotes/${s.remote}/${br}`]).code) { list.push(br); continue; }
    if (git(['rev-parse', '-q', '--verify', `refs/heads/${br}`]).code) return { ok: false, error: `${br} is not on GitHub` };
    const ahead = Number(git(['rev-list', '--count', `refs/remotes/${s.remote}/${s.base}..refs/heads/${br}`]).out) || 0;
    if (!ahead) { log(`${br}: no commit that ${s.base} lacks, nothing of it to merge`); continue; }
    if (dry) return { ok: false, error: `${br} is not on GitHub (it would be pushed first)` };
    const up = git(['push', '-q', s.remote, `refs/heads/${br}:refs/heads/${br}`], { timeout: 90000 });
    if (up.code) return { ok: false, error: `${br} is not on GitHub and could not be pushed: ${up.err.slice(-200) || 'failed'}` };
    git(['fetch', '-q', s.remote, `+refs/heads/${br}:refs/remotes/${s.remote}/${br}`]);
    log(`${br}: pushed (its session had not)`);
    list.push(br);
  }
  if (!list.length) return { ok: false, error: `no step branch holds a commit that ${s.base} lacks: nothing to land` };
  return inWorktree({ git, ref: `${s.remote}/${list[0]}` }, (g, wt, dir) => {
    for (const br of list.slice(1)) {
      const r = mergeIn({ s, g, wt, dir, ref: `${s.remote}/${br}`, message: `Merge ${br} into ${branch} (lander: one PR for the build)`, mainSide: 'ours', buildsSide: 'theirs', log });
      if (r.conflicts) return { ok: false, conflicts: r.conflicts, between: clashPair({ s, git, incoming: br, earlier: list.slice(0, list.indexOf(br)), log }) };
      if (!r.ok) return r;
    }
    const sha = g(['rev-parse', 'HEAD']).out;
    if (dry) return { ok: true, sha, branch, dry: true };
    const p = g(['push', '-q', '--force', s.remote, `HEAD:refs/heads/${branch}`], { timeout: 90000 });
    if (p.code) return { ok: false, error: `push: ${p.err.slice(-200) || 'failed'}` };
    git(['fetch', '-q', s.remote, `+refs/heads/${branch}:refs/remotes/${s.remote}/${branch}`]);
    return { ok: true, sha, branch };
  });
}

/**
 * Which earlier branch does `incoming` clash with in code? Each earlier one is merged with it alone (newest first: the
 * nearest clash is named). → [earlier, incoming]; when no single pair clashes (only the combination does), every
 * earlier branch is named.
 */
export function clashPair({ s, git, incoming, earlier, log = () => {} }) {
  for (const br of [...earlier].reverse()) {
    const r = inWorktree({ git, ref: `${s.remote}/${br}` }, (g, wt, dir) => mergeIn({ s, g, wt, dir, ref: `${s.remote}/${incoming}`, message: `probe ${incoming} into ${br}`, mainSide: 'ours', buildsSide: 'theirs', log }));
    if (r.conflicts) return [br, incoming];
  }
  return [earlier.join(' + '), incoming];
}

/**
 * After a landing: the build's merged step branches go (local and on the remote), their worktrees are removed and the
 * worktree list is pruned. Only what is fully on main is touched: a branch (or a worktree's HEAD) with a commit main
 * lacks stays, and is reported. `extra` = folders the lander made itself (its fix worktree): removed as they are.
 * → { worktrees: [path], branches: [name], kept: [{ branch, why }] }
 */
export function cleanupLanded({ s, git, branches = [], extra = [], log = () => {} }) {
  const out = { worktrees: [], branches: [], kept: [] };
  const main = `${s.remote}/${s.base}`;
  const onMain = (ref) => git(['merge-base', '--is-ancestor', ref, main]).code === 0;
  const has = (ref) => git(['rev-parse', '-q', '--verify', ref]).code === 0;
  const trees = () => {
    const list = []; let cur = null;
    for (const line of git(['worktree', 'list', '--porcelain']).out.split('\n')) {
      if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: '', head: '' }; list.push(cur); }
      else if (cur && line.startsWith('HEAD ')) cur.head = line.slice(5);
      else if (cur && line.startsWith('branch refs/heads/')) cur.branch = line.slice(18);
    }
    return list;
  };
  const top = git(['rev-parse', '--show-toplevel']).out;
  const drop = (path) => { const r = git(['worktree', 'remove', '--force', path]); if (!r.code) out.worktrees.push(path); else log(`worktree ${path}: ${r.err.slice(-160)}`); return !r.code; };
  for (const path of extra) if (path && path !== top && trees().some((w) => w.path === path)) drop(path);
  for (const br of [...new Set(branches.filter(Boolean))]) {
    if (br === s.base || br === 'HEAD') continue;
    const remoteRef = `refs/remotes/${s.remote}/${br}`; const localRef = `refs/heads/${br}`;
    if (has(remoteRef) && !onMain(remoteRef)) { out.kept.push({ branch: br, why: 'it has commits main lacks' }); continue; }
    let busy = false;
    for (const w of trees().filter((x) => x.branch === br)) {
      if (w.path === top || !w.head || !onMain(w.head)) { busy = true; out.kept.push({ branch: br, why: `its worktree ${w.path} ${w.path === top ? 'is the checkout the lander runs in' : 'has commits main lacks'}` }); continue; }
      if (!drop(w.path)) busy = true;
    }
    if (busy) continue;
    if (has(localRef)) { if (onMain(localRef)) git(['branch', '-D', br]); else { out.kept.push({ branch: br, why: 'the local branch has commits main lacks' }); continue; } }
    if (has(remoteRef)) { const p = git(['push', '-q', s.remote, '--delete', br], { timeout: 90000 }); if (p.code && !/remote ref does not exist/.test(p.err)) { log(`delete ${br}: ${p.err.slice(-160)}`); continue; } git(['update-ref', '-d', remoteRef]); }
    out.branches.push(br);
  }
  git(['worktree', 'prune']);
  return out;
}

/**
 * pr-pulling-main: origin/main merged into the PR branch (main's side wins tracking, builds and generated files; data
 * files union; generated files regenerate). Skipped when main moved only by status-only commits. A code conflict stops
 * it ({ conflicts }). → { ok, sha, merged } | { ok: false, conflicts } | { ok: false, error }
 */
export function pullMain({ s, git, branch, force = false, dry = false, log = () => {} }) {
  if (!force && !codeBehind({ s, git, br: branch })) return { ok: true, merged: false, sha: git(['rev-parse', `${s.remote}/${branch}`]).out };
  return inWorktree({ git, ref: `${s.remote}/${branch}` }, (g, wt, dir) => {
    const r = mergeIn({ s, g, wt, dir, ref: `${s.remote}/${s.base}`, message: `Merge main into ${branch} (lander: builds files newer-wins, logs unioned, generated files regenerated)`, mainSide: 'theirs', buildsSide: 'theirs', log });
    if (!r.ok) return r;
    const sha = g(['rev-parse', 'HEAD']).out;
    if (dry) return { ok: true, merged: true, sha, dry: true };
    const p = g(['push', '-q', s.remote, `HEAD:refs/heads/${branch}`], { timeout: 90000 });
    if (p.code) return { ok: false, error: `push: ${p.err.slice(-200) || 'failed'}` };
    git(['fetch', '-q', s.remote, `+refs/heads/${branch}:refs/remotes/${s.remote}/${branch}`]);
    return { ok: true, merged: true, sha, resolved: r.resolved, regenerated: r.regenerated };
  });
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
  const plan = R.planConflicts(left);
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
    // axf-data: not data (a merged repo file in a temporary git worktree)
    else writeFileSync(join(wt, p), `${JSON.stringify(R.mergeJson3(b, o, t, mainSide), null, 2)}\n`);
    g(['add', '--', p]); resolved.push(p);
  }
  for (const p of plan.generated) { g(['checkout', `--${mainSide}`, '--', p]); g(['add', '--', p]); resolved.push(p); }
  const still = g(['diff', '--name-only', '--diff-filter=U']).out.split('\n').filter(Boolean);
  if (still.length) return { conflicts: still };
  // the generators, each once, on the merged tree; their outputs join the merge commit
  const regenerated = [];
  const run = (cmd, timeout) => { const r = spawnSync(cmd[0], cmd.slice(1), { cwd: wt, encoding: 'utf8', timeout, maxBuffer: 16 << 20, env: { ...process.env, CI: '1' } }); return { code: r.status ?? 1, text: `${r.stderr || ''}${r.stdout || ''}`.trim().slice(-400) }; };
  const skipped = [];
  for (const gen of R.regenPlan([...plan.generated, ...plan.unionJson, ...plan.union])) {
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
    for (const t of R.landTests()) { const c = run(t, 180000); if (c.code) return { error: `tests after regenerating failed (${t.join(' ')}): ${c.text}` }; }
  }
  if (regenerated.length) log(`regenerated ${regenerated.join(', ')} after the merge`);
  return { resolved, regenerated, skipped, tracking: tracked };
}
