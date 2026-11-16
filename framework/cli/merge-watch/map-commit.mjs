/**
 * merge-watch@1 host: map one landing on main (merge-watch-entry@1) to its PR, its build, its files and areas.
 *
 *   PR      the subject (merge queue "Merge pull request #N", batch "#N", squash "(#N)"); a stacked PR's
 *           "Merge branch 'land/…'" by GitHub search + merge_commit_sha; else GitHub
 *           GET /repos/{repo}/commits/{sha}/pulls (a manual merge, a rebase merge). A known PR number with no branch
 *           (batch, squash) asks GET /repos/{repo}/pulls/{n} for its head branch, title and merged_at.
 *   build   the branch (claude/<id>, build-id@1 branches are made from the id) when the store or build-origin knows it;
 *           else the store's build linked to the PR; else the store's build on that branch; else build-origin by the
 *           branch id; else the subject prefix when the store knows it; else none (an unlinked landing).
 *   files   git diff --name-only base..sha (a PR merge's work is on its second parent; a build_land diffs from its
 *           second parent, main just before it); areas from
 *           shipped-manifest@1 areasOf.
 *
 * GitHub goes through framework/cli/github-token.mjs (installation token, else GITHUB_TOKEN) with an ETag cache in the
 * merge-watch data dir (github-cache.json): a 304 costs no rate limit. No token or no network = the subject only.
 * Everything is injectable: { store, origins, git, github, repo } for tests.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as MW from '../../core/merge-watch.mjs';
import * as SM from '../../core/shipped-manifest.mjs';
import { mergeWatchDir } from '../merge-watch-files.mjs';
import { gitRoot, REPO_ROOT, runGit, STACK_MERGE } from './walk.mjs';

export const GITHUB_REPO = 'MossesX/AmberX-AXF';
const CACHE_MAX = 400;

// ------------------------------------------------------------------ GitHub with an ETag cache

const cacheFile = (env) => join(mergeWatchDir(env), 'github-cache.json');
const readCache = (env) => { try { return JSON.parse(readFileSync(cacheFile(env), 'utf8')); } catch { return {}; } };
function writeCache(c, env) {
  const f = cacheFile(env); mkdirSync(dirname(f), { recursive: true });
  const keep = Object.fromEntries(Object.entries(c).sort((a, b) => (b[1].at || '').localeCompare(a[1].at || '')).slice(0, CACHE_MAX));
  const tmp = `${f}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(keep)); renameSync(tmp, f);
}

/** Only the fields the watch reads (PRs, search hits, CI runs), so the cache stays small. */
const slimPr = (p) => (p && typeof p === 'object' ? { number: p.number, title: p.title, head: { ref: p.head?.ref, sha: p.head?.sha }, merged_at: p.merged_at, merge_commit_sha: p.merge_commit_sha, html_url: p.html_url } : p);
export function slim(body) {
  if (Array.isArray(body)) return body.map(slimPr);
  if (body && Array.isArray(body.items)) return { items: body.items.map((i) => ({ number: i.number })) };
  if (body && Array.isArray(body.workflow_runs)) return { workflow_runs: body.workflow_runs.map((r) => ({ name: r.name, run_number: r.run_number, status: r.status, conclusion: r.conclusion, html_url: r.html_url })) };
  return body && body.number ? slimPr(body) : body;
}

let tokenMemo;
export function githubToken(env = process.env) {
  if (tokenMemo !== undefined) return tokenMemo;
  const r = spawnSync(process.execPath, [join(REPO_ROOT, 'framework/cli/github-token.mjs'), 'token'], { encoding: 'utf8', env, timeout: 20e3 });
  tokenMemo = r.status === 0 ? r.stdout.trim() : (env.GITHUB_TOKEN || '');
  return tokenMemo;
}

/** GET a GitHub API path with If-None-Match; returns the JSON body (cached on 304) or null. */
export async function githubGet(path, { env = process.env, fetchFn = globalThis.fetch } = {}) {
  if (env.AXF_MERGE_WATCH_GITHUB === 'off') return null; // tests, CI: the subject only
  const token = githubToken(env); if (!token || !fetchFn) return null;
  const cache = readCache(env); const hit = cache[path];
  try {
    const res = await fetchFn(`https://api.github.com${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'axf-merge-watch', ...(hit?.etag ? { 'if-none-match': hit.etag } : {}) }, signal: AbortSignal.timeout(15e3) });
    if (res.status === 304 && hit) { cache[path] = { ...hit, at: new Date().toISOString() }; writeCache(cache, env); return hit.body; }
    if (!res.ok) return null;
    const body = slim(await res.json());
    const etag = res.headers.get('etag');
    if (etag) { cache[path] = { etag, body, at: new Date().toISOString() }; writeCache(cache, env); }
    return body;
  } catch { return hit?.body ?? null; }
}

const prShape = (p) => (p && p.number ? { number: Number(p.number), title: String(p.title || ''), branch: String(p.head?.ref || ''), headSha: String(p.head?.sha || ''), mergedAt: p.merged_at || '', mergeSha: p.merge_commit_sha || '', url: p.html_url || '' } : null);

/** The PR a landing came from, with its head branch: the subject first, GitHub second. */
export async function prOf(e, { github = githubGet, repo = GITHUB_REPO } = {}) {
  if (e.pr) {
    const p = prShape(await github(`/repos/${repo}/pulls/${e.pr}`));
    return p || { number: e.pr, title: '', branch: e.branch, mergedAt: '', mergeSha: '', url: '' };
  }
  if (e.kind === 'build-land') return null; // a fast-forward has no PR of its own
  if (STACK_MERGE.test(e.subject)) {
    // a stacked PR (walk.mjs): GitHub's merge_commit_sha is this merge. Search finds the PRs that contain the sha (the
    // stack's own PR too); the one whose merge commit it is wins
    const found = await github(`/search/issues?q=${e.sha}+repo:${repo}+is:pr&per_page=10`);
    for (const it of (Array.isArray(found?.items) ? found.items : []).slice(0, 10)) {
      const p = prShape(await github(`/repos/${repo}/pulls/${it.number}`));
      if (p && p.mergeSha === e.sha) return p;
    }
    return null;
  }
  const list = await github(`/repos/${repo}/commits/${e.sha}/pulls`);
  const ps = (Array.isArray(list) ? list : []).map(prShape).filter(Boolean);
  return ps.find((p) => p.mergeSha === e.sha) || ps.find((p) => p.mergedAt) || null;
}

// ------------------------------------------------------------------ build

const storeBuilds = (store) => (Array.isArray(store?.builds) ? store.builds : []).filter((b) => b && !b.deleted);
const prNo = (v) => Number(String(v ?? '').replace(/\D/g, '')) || 0;

/** { id, via } for a landing: branch → store PR link → store branch → build-origin → subject prefix → none. */
export function buildOf(e, { store, origins = {} } = {}) {
  const bs = storeBuilds(store); const ids = new Set(bs.map((b) => b.id));
  const branch = MW.normBranch(e.branch);
  const fromBranch = MW.buildOfBranch(branch);
  if (fromBranch && ids.has(fromBranch)) return { id: fromBranch, via: 'branch' };
  if (e.pr) { const b = bs.find((x) => prNo(x.pr) === e.pr); if (b) return { id: b.id, via: 'store-pr' }; }
  if (branch) { const b = bs.find((x) => MW.normBranch(x.branch) === branch); if (b) return { id: b.id, via: 'store-branch' }; }
  if (fromBranch && origins[fromBranch]) return { id: fromBranch, via: 'origin' };
  if (e.guess && ids.has(e.guess)) return { id: e.guess, via: 'guess' };
  if (fromBranch) return { id: fromBranch, via: 'branch-new' }; // a claude/ branch the store never had: still its build id
  return { id: '', via: '' };
}

// ------------------------------------------------------------------ files

export function filesOf(e, { git = runGit, cwd = gitRoot() } = {}) {
  // build_land: main before the landing is the merge's second parent; diffing from the branch's base would also count
  // every main change the branch merged in
  const base = e.kind === 'build-land' ? `${e.sha}^2` : MW.sha(e.base) || `${e.sha}^`;
  try { return git(['diff', '--name-only', '--no-renames', `${base}..${e.sha}`], { cwd }).split('\n').filter(Boolean); }
  catch { return []; }
}

// ------------------------------------------------------------------ one landing

/**
 * mapped-commit = { entry (with pr / branch filled), pr: { number, title, branch, mergedAt, url } | null,
 *                   build: { id, via } (id '' = unlinked), files, areas }
 */
export async function mapCommit(entry, { store, origins = {}, git = runGit, cwd = gitRoot(), github = githubGet, repo = GITHUB_REPO } = {}) {
  const e = MW.normEntry(entry); if (!e) throw Object.assign(new Error('mapCommit: a merge-watch-entry@1 with a sha'), { code: 2 });
  const pr = await prOf(e, { github, repo });
  const branch = MW.normBranch(e.branch || pr?.branch || '');
  const filled = { ...e, pr: e.pr || pr?.number || 0, branch, build: e.build || MW.buildOfBranch(branch) };
  const build = buildOf(filled, { store, origins });
  const files = filesOf(filled, { git, cwd });
  // a "Merge branch 'land/…'" that is no PR's merge commit is a sync inside a stack: the stack's PR ships it
  const fold = STACK_MERGE.test(e.subject) && !pr ? (entry.via || 'stack') : '';
  return { entry: { ...filled, build: build.id }, pr, build, files, areas: SM.areasOf(files), fold };
}

export const knownSets = (store) => {
  const bs = storeBuilds(store);
  return { known: new Set(bs.map((b) => b.id)), byPr: new Map(bs.filter((b) => prNo(b.pr)).map((b) => [prNo(b.pr), b.id])) };
};

