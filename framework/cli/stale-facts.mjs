#!/usr/bin/env node
/**
 * stale-facts — the facts the VPS stale-row watchdog classifies with (stale-row@1, framework/core/stale-rows.mjs).
 * Brett, Nov 16 2026: "I want a server fucking watchdog on the VPS to do that."
 *
 * One gather gives one facts map (stale-facts@1) keyed three ways:
 *   prs[<number>]     { number, state: open | closed | merged, mergedAt, mergeCommit, url, branch }   (GitHub)
 *   branches[<name>]  { name, exists, head, main: { landed, commit, by } | null, pr }                 (git: origin)
 *   builds[<id>]      { id, status, deleted, mergedAt, branch, pr, alive }                             (builds store + live sessions)
 *
 * Where each comes from:
 *   origin/main       `git log --merges` (merge commits "Merge pull request #N from <branch>") and first-parent squash
 *                     subjects ending "(#N)": a PR or branch whose work is on main, and how it got there
 *   branch heads      `git for-each-ref refs/remotes/origin/` after one fetch of main + claude/* (pruned): exists / gone
 *   GitHub PR states  GET /repos/<repo>/pulls?state=all (recent pages) plus single PRs a row names that the pages miss,
 *                     every request with If-None-Match from the ETag cache: an unchanged page is a 304, which costs no
 *                     rate limit, so a run every 5 minutes costs almost nothing. Token: github.mjs githubToken()
 *                     (the github-token.mjs broker: GitHub App installation token, else GITHUB_TOKEN)
 *   live sessions     agent slots + axf-* tmux sessions (builds-reconcile-core aliveIds); null where tmux can't be asked
 *
 * A fact that could not be looked up stays null (never "no"): the classifier keeps a row it knows nothing about.
 * A branch with no commits ahead of main is never "on main" by ancestry: a fresh branch would look landed.
 *
 *   node framework/cli/stale-facts.mjs [--no-fetch] [--no-github] [--pages N] [--json]
 *
 * Library: gatherFacts(opts) → facts; factsForRow(row, facts) → classifier facts for one row.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normRow, prNumber } from '../core/stale-rows.mjs';

export const FACTS_FRAME = 'stale-facts@1';
const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT_DEFAULT = resolve(HERE, '..', '..');
export const MAX_SINGLE_PRS = 25; // single-PR lookups per run beyond the list pages (each one ETag-cached too)

const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

/** The plugin data folder's cache file (lifecycle dataDir of the Build orchestrator). */
export const defaultCacheFile = (root = REPO_ROOT_DEFAULT) => join(process.env.AXF_WATCHDOG_DIR || join(root, '.axf-console', 'plugins', 'build-orchestrator', 'watchdog'), 'github-etags.json');

export function repoName(root = REPO_ROOT_DEFAULT) {
  if (process.env.AXF_GITHUB_REPO) return process.env.AXF_GITHUB_REPO;
  const url = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? '';
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] : 'MossesX/AmberX-AXF';
}

const gitIn = (root) => (args, { timeout = 120000 } = {}) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout });
  return r.status === 0 ? r.stdout : null;
};

// ------------------------------------------------------------------ main (git)

/** "Merge pull request #12 from MossesX/claude/x (…)" or "… from claude/x" → { pr, branch }. */
export function parseMergeSubject(subject, owner = '') {
  const m = /^Merge pull request #(\d+) from (\S+)/.exec(str(subject, 400));
  if (!m) return null;
  let branch = m[2];
  if (owner && branch.startsWith(`${owner}/`)) branch = branch.slice(owner.length + 1);
  return { pr: Number(m[1]), branch };
}
/** "Some change (#12)" → 12 (a squash merge's subject). */
export const squashPr = (subject) => { const m = /\(#(\d+)\)\s*$/.exec(str(subject, 400)); return m ? Number(m[1]) : 0; };

/**
 * What is on main: { head, prs: { n: { commit, by, branch } }, branches: { name: { commit, by, pr } }, heads: Set(sha) }.
 * `heads` = second parents of the merge commits (the branch heads that were merged), for branches without a PR line.
 */
export function readMain(git, { owner = '', depth = 3000, ref = 'refs/remotes/origin/main' } = {}) {
  const head = str(git(['rev-parse', ref]), 64);
  if (!head) return null;
  const out = { head, prs: {}, branches: {}, heads: new Map() };
  for (const ln of (git(['log', ref, '--merges', '--first-parent', `-n${depth}`, '--format=%H%x09%P%x09%s']) ?? '').split('\n')) {
    const [sha, parents, subject] = ln.split('\t'); if (!sha) continue;
    const second = (parents ?? '').split(' ')[1] ?? '';
    const p = parseMergeSubject(subject, owner);
    if (second) out.heads.set(second, sha);
    if (!p) continue;
    if (!out.prs[p.pr]) out.prs[p.pr] = { commit: sha, by: 'merge-commit', branch: p.branch };
    if (!out.branches[p.branch]) out.branches[p.branch] = { commit: sha, by: 'merge-commit', pr: p.pr };
  }
  for (const ln of (git(['log', ref, '--no-merges', '--first-parent', `-n${depth}`, '--format=%H%x09%s']) ?? '').split('\n')) {
    const [sha, subject] = ln.split('\t'); const n = squashPr(subject);
    if (sha && n && !out.prs[n]) out.prs[n] = { commit: sha, by: 'squash', branch: '' };
  }
  return out;
}

/** origin's branch heads: { name: sha } (refs/remotes/origin/<name>, HEAD left out). */
export function readHeads(git) {
  const out = {};
  for (const ln of (git(['for-each-ref', '--format=%(refname:strip=3) %(objectname)', 'refs/remotes/origin/']) ?? '').split('\n')) {
    const [name, sha] = ln.split(' ');
    if (name && sha && name !== 'HEAD') out[name] = sha;
  }
  return out;
}

// ------------------------------------------------------------------ GitHub (ETag cached)

export function readCache(file) { try { const j = JSON.parse(readFileSync(file, 'utf8')); return j && typeof j === 'object' && j.entries ? j : { entries: {} }; } catch { return { entries: {} }; } }
export function writeCache(file, cache) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`; writeFileSync(tmp, `${JSON.stringify(cache)}\n`); renameSync(tmp, file);
}

/** GET with If-None-Match: a 304 reuses the cached body. Returns { data, status, cached }; counts into `stats`. */
export async function cachedGet(gh, cache, path, stats) {
  const hit = cache.entries[path];
  const r = await gh.call('GET', path, undefined, { headers: hit?.etag ? { 'If-None-Match': hit.etag } : {} });
  stats.requests += 1;
  if (r.status === 304 && hit) { stats.notModified += 1; hit.at = new Date().toISOString(); return { data: hit.data, status: 304, cached: true }; }
  if (r.status < 200 || r.status >= 300) { const e = new Error(`GitHub ${r.status} on ${path}`); e.status = r.status; throw e; }
  const data = JSON.parse(r.body.toString('utf8') || 'null');
  const etag = r.headers.get?.('etag') ?? '';
  if (etag) cache.entries[path] = { etag, data, at: new Date().toISOString() };
  return { data, status: r.status, cached: false };
}

/** One GitHub PR (REST shape) → the facts shape. */
export const prFact = (p) => ({
  number: Number(p?.number) || 0,
  state: p?.merged_at ? 'merged' : p?.state === 'open' ? 'open' : p?.state === 'closed' ? 'closed' : null,
  mergedAt: str(p?.merged_at, 40), mergeCommit: str(p?.merged_at ? p?.merge_commit_sha : '', 64), url: str(p?.html_url),
  branch: str(p?.head?.ref, 200),
});
/** Only the fields the watchdog reads are kept in the cache (a page of 100 full PRs is ~1 MB). */
const slimPr = (p) => ({ number: p?.number, state: p?.state, merged_at: p?.merged_at ?? null, merge_commit_sha: p?.merge_commit_sha ?? null, html_url: p?.html_url ?? '', head: { ref: p?.head?.ref ?? '' } });

export async function readPrs(gh, cache, repo, { pages = 2, want = [], stats }) {
  const prs = {};
  for (let page = 1; page <= pages; page++) {
    const path = `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`;
    const r = await cachedGet(gh, cache, path, stats);
    if (!r.cached && Array.isArray(r.data) && cache.entries[path]) cache.entries[path].data = r.data.map(slimPr);
    const list = Array.isArray(r.data) ? r.data : [];
    for (const p of list) { const f = prFact(p); if (f.number && !prs[f.number]) prs[f.number] = f; }
    if (list.length < 100) break;
  }
  const missing = [...new Set(want.map(Number).filter((n) => n > 0 && !prs[n]))].slice(0, MAX_SINGLE_PRS);
  for (const n of missing) {
    try {
      const path = `/repos/${repo}/pulls/${n}`;
      const r = await cachedGet(gh, cache, path, stats);
      if (!r.cached && cache.entries[path]) cache.entries[path].data = slimPr(r.data);
      const f = prFact(r.data); if (f.number) prs[f.number] = f;
    } catch (e) { if (e.status !== 404) stats.errors.push(str(e.message, 200)); }
  }
  return prs;
}

// ------------------------------------------------------------------ builds (store + live sessions)

/** Live build ids from agent slots + axf-* tmux sessions; null when this machine can't tell. */
export async function liveBuildIds() {
  try {
    const slots = await import('./agent-slots.mjs');
    const { aliveIds } = await import('../plan/builds-reconcile-core.mjs');
    const tmux = slots.tmuxSessions(); if (!tmux) return null;
    const running = slots.loadState().running.filter((r) => r.state === 'running' || r.state === 'starting');
    return aliveIds({ sessions: [...tmux.keys()], slots: running });
  } catch { return null; }
}

export function buildFacts(builds, alive) {
  const out = {};
  for (const b of Array.isArray(builds) ? builds : []) {
    const id = str(b?.id, 120); if (!id) continue;
    out[id] = { id, status: str(b.status, 20), deleted: !!b.deleted, mergedAt: str(b.mergedAt, 40), branch: str(b.branch, 200), pr: prNumber(b.pr), alive: alive ? alive.has(id) : null };
  }
  return out;
}

// ------------------------------------------------------------------ gather

/**
 * Everything at once. opts: root, repo, fetch (git fetch first, default true), github (default true), pages (2),
 * wantPrs (PR numbers rows name), builds (builds@1 records; default none: the table readers pass theirs), gh, alive,
 * cacheFile. Never throws for a missing source: it is null and named in `errors`.
 */
export async function gatherFacts(opts = {}) {
  const root = opts.root ?? REPO_ROOT_DEFAULT;
  const repo = opts.repo ?? repoName(root);
  const owner = repo.split('/')[0];
  const git = opts.git ?? gitIn(root);
  const stats = { requests: 0, notModified: 0, errors: [] };
  const errors = [];

  if (opts.fetch !== false) {
    const ok = git(['fetch', '-q', '--prune', 'origin', '+refs/heads/main:refs/remotes/origin/main', '+refs/heads/claude/*:refs/remotes/origin/claude/*'], { timeout: 180000 });
    if (ok == null) errors.push('git fetch origin failed: facts from the last fetch');
  }
  const main = readMain(git, { owner });
  if (!main) errors.push('origin/main not found');
  const heads = main ? readHeads(git) : null;

  let prs = null;
  if (opts.github !== false) {
    const cacheFile = opts.cacheFile ?? defaultCacheFile(root);
    const cache = readCache(cacheFile);
    try {
      const gh = opts.gh ?? (await import('./github.mjs')).createGitHub({ userAgent: 'axf-stale-watchdog' });
      prs = await readPrs(gh, cache, repo, { pages: opts.pages ?? 2, want: opts.wantPrs ?? [], stats });
      writeCache(cacheFile, cache);
    } catch (e) { errors.push(`GitHub: ${str(e.message, 200)}`); prs = null; }
  }

  const branches = {};
  if (heads) {
    const names = new Set([...Object.keys(heads), ...Object.keys(main?.branches ?? {}), ...Object.values(prs ?? {}).map((p) => p.branch).filter(Boolean)]);
    const fetched = (n) => n.startsWith('claude/') || n === 'main' || !!heads[n];
    for (const name of names) {
      const head = heads[name] ?? '';
      const merged = main.branches[name] ?? (head && main.heads.has(head) ? { commit: main.heads.get(head), by: 'merge-commit', pr: 0 } : null);
      const ahead = head ? Number(git(['rev-list', '--count', `refs/remotes/origin/main..${head}`]) ?? -1) : -1;
      const landed = merged ? true : head && ahead > 0 ? false : null;
      branches[name] = {
        name, head, exists: head ? true : fetched(name) ? false : null,
        main: landed == null ? null : { landed, commit: merged?.commit ?? '', by: merged?.by ?? '' },
        pr: merged?.pr || Object.values(prs ?? {}).find((p) => p.branch === name)?.number || 0,
      };
    }
  }

  const alive = opts.alive !== undefined ? opts.alive : await liveBuildIds();
  errors.push(...stats.errors);
  return {
    $axf: FACTS_FRAME, at: new Date().toISOString(), repo,
    main: main ? { head: main.head, prs: main.prs, branches: main.branches } : null,
    prs, branches: heads ? branches : null,
    builds: buildFacts(opts.builds ?? [], alive), alive: alive ? [...alive] : null,
    github: { requests: stats.requests, notModified: stats.notModified, spent: stats.requests - stats.notModified },
    errors,
  };
}

/**
 * The classifier's facts for one row (stale-row@1 facts shape), from a gathered map. The PR comes from the row, else
 * its build, else its branch's PR; main from the PR's merge on main, else the branch's.
 */
export function factsForRow(raw, facts) {
  const row = normRow(raw);
  const b = row.build ? facts?.builds?.[row.build] ?? null : null;
  const branchName = row.branch || b?.branch || '';
  const br = branchName && facts?.branches ? facts.branches[branchName] ?? null : null;
  const prN = row.pr || b?.pr || br?.pr || 0;
  const pr = prN && facts?.prs ? facts.prs[prN] ?? null : null;
  const onMainByPr = prN && facts?.main ? facts.main.prs?.[prN] ?? null : null;
  const main = onMainByPr ? { landed: true, commit: onMainByPr.commit, by: onMainByPr.by } : br?.main ?? null;
  return {
    pr: pr ? { number: pr.number, state: pr.state, mergedAt: pr.mergedAt, mergeCommit: pr.mergeCommit, url: pr.url } : null,
    main,
    build: b ? { id: b.id, status: b.status, deleted: b.deleted, mergedAt: b.mergedAt } : row.build && facts?.builds ? { id: row.build, deleted: true } : null,
    branch: branchName && facts?.branches ? { name: branchName, exists: br ? br.exists : branchName.startsWith('claude/') ? false : null } : null,
    session: b && b.alive != null ? { alive: b.alive, id: b.alive ? row.build : '' } : null,
  };
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n) => argv.includes(`--${n}`);
  const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const f = await gatherFacts({ fetch: !flag('no-fetch'), github: !flag('no-github'), pages: Number(opt('pages')) || 2 });
  if (flag('json')) process.stdout.write(`${JSON.stringify(f, null, 1)}\n`);
  else {
    const n = (o) => (o ? Object.keys(o).length : 'unknown');
    console.log(`stale facts ${f.at} · ${f.repo}`);
    console.log(`main      ${f.main ? `${f.main.head.slice(0, 12)} · ${n(f.main.prs)} PRs on main` : 'unknown'}`);
    console.log(`branches  ${n(f.branches)}`);
    console.log(`PRs       ${n(f.prs)} · GitHub ${f.github.requests} requests, ${f.github.notModified} not modified (${f.github.spent} counted)`);
    console.log(`live      ${f.alive ? f.alive.join(', ') || 'none' : 'unknown here'}`);
    for (const e of f.errors) console.log(`! ${e}`);
  }
}
