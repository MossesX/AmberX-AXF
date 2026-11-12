#!/usr/bin/env node
/**
 * branch-drift — how far each build branch is behind (and ahead of) main (Brett, Nov 12 2026: "I need all the build
 * tables and the orchestrator to list how many commits they are behind main").
 *
 *   behind = git rev-list --count <branch>..origin/main     commits on main the branch does not have
 *   ahead  = git rev-list --count origin/main..<branch>     commits on the branch main does not have
 *
 * The branch is read from the local ref (refs/heads/<b>, the VPS worktree) and from the pushed ref
 * (refs/remotes/origin/<b>, refreshed by builds-reconcile every 10 min); when both exist the fresher one wins (fewer
 * commits behind). Counts are cached by (main sha, branch sha) in the git common dir, so a read is one for-each-ref
 * plus a rev-list only for refs that moved: a main push changes the main sha and every count refreshes on the next read.
 * refresh() fetches origin/main (the dispatcher tick calls it, at most once a minute) so a push shows within a minute.
 *
 *   node framework/cli/branch-drift.mjs [branch…] [--json]        counts for the given branches (default: every claude/* branch)
 *   … refresh [--json]                                           fetch origin/main now, then print the main sha
 *
 * budgetMs bounds a cold read: past it, uncached branches come back null and the result says partial: true.
 * A build with no branch, or a branch that exists nowhere here, has no counts (the tables show a dash).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '../..');
export const SCHEMA = 'branch-drift@1';
export const MAIN_REF = 'refs/remotes/origin/main';
const FETCH_EVERY_MS = 60e3;
const MAX_ENTRIES = 2000;
const MAX_STEP_COMMITS = 200; // main moved by more than this since the cached count: count afresh
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,200}$/;

const git = (cwd, args, timeout = 20e3) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout });

function commonDir(root) {
  const r = git(root, ['rev-parse', '--git-common-dir']);
  if (r.status !== 0) return '';
  const d = r.stdout.trim();
  return isAbsolute(d) ? d : join(root, d);
}
const cacheFile = (root, env) => env.AXF_BRANCH_DRIFT_CACHE || (commonDir(root) ? join(commonDir(root), 'axf-branch-drift.json') : '');
const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
function writeJson(f, v) { try { mkdirSync(dirname(f), { recursive: true }); const t = `${f}.${process.pid}.tmp`; writeFileSync(t, JSON.stringify(v)); renameSync(t, f); } catch { /* read-only checkout: counts are recomputed next time */ } }

/** Every local and origin ref → sha, in one git call. */
function refShas(root) {
  const r = git(root, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes/origin']);
  const m = new Map();
  if (r.status !== 0) return m;
  for (const line of r.stdout.split('\n')) { const i = line.indexOf(' '); if (i > 0) m.set(line.slice(0, i), line.slice(i + 1).trim()); }
  return m;
}

/** owner/name of the origin remote when it is on GitHub (for the compare link), else ''. */
export function githubRepo(root = REPO_ROOT) {
  const u = git(root, ['remote', 'get-url', 'origin']).stdout?.trim() || '';
  const m = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(u);
  return m ? m[1] : '';
}

/** Normalise what a build record holds (claude/x, origin/claude/x, refs/heads/claude/x) to the branch name. */
export function branchName(b) {
  const s = typeof b === 'string' ? b.trim().replace(/^refs\/(heads|remotes\/origin)\//, '').replace(/^origin\//, '') : '';
  return s && BRANCH_RE.test(s) && !s.includes('..') ? s : '';
}

/** One drift record as every table, the API and the CLI show it. null = no branch / branch not found (a dash). */
export const NONE = null;

/**
 * Counts for many branches at once: { [branch]: { behind, ahead, ref, sha, main } | null }, plus the main sha.
 * Reads the cache; computes only refs whose (main, branch) shas changed since; writes the cache back.
 */
export function driftFor(branches, { root = REPO_ROOT, env = process.env, budgetMs = 0 } = {}) {
  const until = budgetMs > 0 ? Date.now() + budgetMs : Infinity;
  const names = [...new Set((branches ?? []).map(branchName).filter(Boolean))];
  const shas = refShas(root);
  const main = shas.get(MAIN_REF) || '';
  const out = { main, repo: githubRepo(root), at: new Date().toISOString(), branches: {} };
  if (!main) { for (const n of names) out.branches[n] = NONE; return out; }
  const f = cacheFile(root, env);
  const cache = (f && readJson(f)) || {};
  const entries = cache.$axf === SCHEMA && cache.entries && typeof cache.entries === 'object' ? cache.entries : {};
  let dirty = false;
  const valid = (h) => h && Number.isInteger(h.behind) && Number.isInteger(h.ahead) && typeof h.main === 'string' && /^[0-9a-f]{40,64}$/.test(h.main);
  // entries are keyed by branch sha: { main, behind, ahead, at }. When main moved forward since (the usual case: a push),
  // the new main commits N = old..main are few: for each, one for-each-ref --contains says which branch shas hold it (k).
  // Then behind = behind_old + |N| - k and ahead = ahead_old - k, with no walk of any branch's distance from main.
  const wanted = new Set(names.flatMap((n) => [`refs/heads/${n}`, `refs/remotes/origin/${n}`].map((r) => shas.get(r)).filter(Boolean)));
  const byOld = new Map();
  for (const sha of wanted) { const h = entries[sha]; if (valid(h) && h.main !== main) { if (!byOld.has(h.main)) byOld.set(h.main, []); byOld.get(h.main).push(sha); } }
  for (const [old, group] of byOld) {
    if (Date.now() > until) break;
    if (git(root, ['merge-base', '--is-ancestor', old, main]).status !== 0) continue; // main was rewritten: full count below
    const r = git(root, ['rev-list', main, `^${old}`]);
    const fresh = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : null;
    if (!fresh || fresh.length > MAX_STEP_COMMITS) continue;
    const held = new Map(group.map((s) => [s, 0]));
    let failed = false;
    for (const c of fresh) {
      const q = git(root, ['for-each-ref', '--contains', c, '--format=%(objectname)', 'refs/heads', 'refs/remotes/origin']);
      if (q.status !== 0) { failed = true; break; }
      for (const s of new Set(q.stdout.split('\n').filter(Boolean))) if (held.has(s)) held.set(s, held.get(s) + 1);
    }
    if (failed) continue;
    for (const [s, k] of held) { const h = entries[s]; entries[s] = { main, behind: h.behind + fresh.length - k, ahead: Math.max(0, h.ahead - k), at: Date.now() }; }
    dirty = true;
  }
  const count = (sha) => {
    const hit = entries[sha];
    if (valid(hit) && hit.main === main) return hit;
    if (Date.now() > until) { out.partial = true; return null; } // over budget: the next read (or the tick) fills it in
    let v = null;
    if (!v) {
      const r = git(root, ['rev-list', '--left-right', '--count', `${main}...${sha}`]);
      const m = r.status === 0 ? /^(\d+)\s+(\d+)/.exec(r.stdout.trim()) : null;
      if (!m) return null;
      v = { main, behind: Number(m[1]), ahead: Number(m[2]), at: Date.now() };
    }
    entries[sha] = v; dirty = true;
    return v;
  };
  for (const n of names) {
    let best = NONE;
    for (const ref of [`refs/heads/${n}`, `refs/remotes/origin/${n}`]) {
      const sha = shas.get(ref); if (!sha) continue;
      const c = count(sha); if (!c) continue;
      if (!best || c.behind < best.behind || (c.behind === best.behind && c.ahead > best.ahead)) best = { behind: c.behind, ahead: c.ahead, ref: ref.replace(/^refs\/(heads|remotes)\//, ''), sha };
    }
    out.branches[n] = best ? { ...best, main } : NONE;
  }
  if (dirty && f) {
    const keys = Object.keys(entries);
    if (keys.length > MAX_ENTRIES) { keys.sort((a, b) => (entries[a].at ?? 0) - (entries[b].at ?? 0)); for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[k]; }
    writeJson(f, { $axf: SCHEMA, fetchedAt: cache.fetchedAt ?? 0, entries });
  }
  return out;
}

/** The drift fields a build row carries: behindMain / aheadMain (null when there is no branch), driftRef, compareUrl. */
export function driftFields(branch, drift) {
  const name = branchName(branch); const d = drift?.branches?.[name] ?? null;
  // the compare view: what main has that the branch lacks, and the branch's own commits (GitHub's two-dot compare)
  const compareUrl = d && drift?.repo ? `https://github.com/${drift.repo}/compare/${encodeURIComponent(name).replace(/%2F/g, '/')}...main` : '';
  return { behindMain: d ? d.behind : null, aheadMain: d ? d.ahead : null, driftRef: d ? d.ref : '', compareUrl };
}

/** Fetch origin/main when the last fetch is older than a minute (or always with force). Returns the main sha. */
export function refresh({ root = REPO_ROOT, env = process.env, force = false, now = Date.now() } = {}) {
  const f = cacheFile(root, env);
  const cache = (f && readJson(f)) || { $axf: SCHEMA, entries: {} };
  const last = Number(cache.fetchedAt) || 0;
  let fetched = false; let error = '';
  if (force || now - last >= FETCH_EVERY_MS) {
    const r = git(root, ['fetch', '-q', 'origin', `+refs/heads/main:${MAIN_REF}`], 60e3);
    fetched = r.status === 0; error = fetched ? '' : (r.stderr || r.stdout || 'git fetch failed').trim().slice(0, 300);
    if (f) writeJson(f, { $axf: SCHEMA, entries: {}, ...cache, fetchedAt: now });
  }
  const main = git(root, ['rev-parse', '-q', '--verify', MAIN_REF]).stdout?.trim() || '';
  return { fetched, error, main, fetchedAt: new Date(fetched || !last ? now : last).toISOString() };
}

/** "Far behind" for highlighting: the same threshold everywhere (tables, cards, CLI). */
export const FAR_BEHIND = 50;

function main(argv) {
  const json = argv.includes('--json'); const args = argv.filter((a) => a !== '--json');
  if (args[0] === 'refresh') { const r = refresh({ force: true }); console.log(json ? JSON.stringify({ ok: !r.error, ...r }) : r.error ? `fetch failed: ${r.error}` : `origin/main ${r.main.slice(0, 10)}`); return r.error ? 1 : 0; }
  let names = args;
  if (!names.length) names = [...refShas(REPO_ROOT).keys()].filter((r) => /^refs\/(heads|remotes\/origin)\/claude\//.test(r)).map(branchName);
  const d = driftFor(names);
  if (json) { console.log(JSON.stringify({ ok: true, $axf: SCHEMA, ...d })); return 0; }
  const rows = Object.entries(d.branches).sort((a, b) => (b[1]?.behind ?? -1) - (a[1]?.behind ?? -1));
  console.log([`origin/main ${d.main.slice(0, 10) || '(missing)'}`, ...rows.map(([n, v]) => `  ${n.padEnd(60)} ${v ? `${String(v.behind).padStart(4)} behind · ${v.ahead} ahead${v.behind >= FAR_BEHIND ? ' · FAR BEHIND' : ''}` : '   — (no ref here)'}`)].join('\n'));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
