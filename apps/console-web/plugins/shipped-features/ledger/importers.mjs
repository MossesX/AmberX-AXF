/**
 * Shipped features: importers. Back to the first commit of AmberX-AXF and axHub, from what actually happened:
 *
 *   journal   the builds store journal through build-hook@1 (every build, its steps, his words, PR, merge)
 *   prs       merged pull requests: git merge commits ("Merge pull request #N"), squash merges ("… (#N)"), or the
 *             GitHub API when a token is set (GITHUB_TOKEN). A PR that belongs to a build (branch / build PR) dates
 *             that build's features (mergedAt, merge commit); a PR with no build becomes a feature of its own, or an
 *             edit when it changes a feature that already exists.
 *   commits   first-parent commits on main from before pull requests were used (feature-like subjects only:
 *             status, merge, [skip ci], chore and docs commits are not features), source import, confidence guessed
 *   seed      data/features-seed.json: the AI split of history into features (name, description, type, app,
 *             plugin, prs, builds, commits), merged last so it wins on wording. Optional.
 *
 * Every importer only adds or merges; nothing it writes removes a date, build, PR or prompt (feature-ledger@1 merge).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../../../framework/core/feature-ledger.mjs';
import * as D from './db.mjs';
import { applyEvents, plugins } from './apply.mjs';
import { HOUSEKEEPING, editFrom, matchFeature, scopeFromText, scopeOf } from './plan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SEED = join(HERE, '..', 'data', 'features-seed.json');
const MERGE_RE = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const SQUASH_RE = /\(#(\d+)\)\s*$/;
const NOT_A_FEATURE = /^(merge\b|revert\b|builds live|status:|wip\b|checkpoint|chore|docs?\b|style|ci\b|bump|sync\b|claude-sync|tracker|update (status|threads|tracker|handoff)|threads\b|journal)|\[skip ci\]/i;
const CONVENTIONAL = /^(feat|fix|chore|refactor|docs|test|ci|build|perf|style)(\([^)]*\))?!?:\s*/i;

const utc = (at) => { const t = Date.parse(at); return Number.isFinite(t) ? new Date(t).toISOString().replace('.000Z', 'Z') : ''; };
const git = (cwd, args) => { try { return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
export const repoPath = (repo) => (L.normRepo(repo) === 'axhub' ? process.env.AXF_AXHUB_REPO || '' : D.REPO_ROOT);
const mainRef = (cwd) => (git(cwd, ['rev-parse', '--verify', '-q', 'origin/main']).trim() ? 'origin/main' : 'main');

// ------------------------------------------------------------------ journal

export async function importJournal(db) {
  const { journalEvents } = await import('../../../../../framework/cli/build-hooks.mjs');
  const ev = journalEvents().map((e) => ({ ...e, source: 'import' }));
  return { events: ev.length, applied: applyEvents(db, ev) };
}

// ------------------------------------------------------------------ pull requests

/** Merged PRs from git history: [{ repo, number, title, branch, mergedAt, mergeCommit, body, files }]. */
export function prsFromGit(repo, { cwd = repoPath(repo), files = true, max = 5000, known = new Set() } = {}) {
  if (!cwd || !existsSync(cwd)) return [];
  const out = git(cwd, ['log', mainRef(cwd), '--first-parent', `-n${max}`, '--format=%H%x1f%P%x1f%cI%x1f%an%x1f%s%x1f%b%x1e']);
  const prs = [];
  for (const rec of out.split('\x1e')) {
    const [sha, parents, at, author, subject, body] = rec.replace(/^\n/, '').split('\x1f'); if (!sha) continue;
    const m = subject.match(MERGE_RE) || subject.match(SQUASH_RE); if (!m) continue;
    const merge = MERGE_RE.test(subject);
    const ps = parents.trim().split(' ');
    const title = merge ? (body || '').split('\n')[0].trim() || subject : subject.replace(SQUASH_RE, '').trim();
    const f = files && !known.has(L.prKey(repo, Number(m[1]))) ? git(cwd, ['diff', '--name-only', `${ps[0]}`, sha]).split('\n').filter(Boolean).slice(0, 400) : [];
    prs.push({ repo, number: Number(m[1]), title, branch: merge ? m[2] : '', mergedAt: utc(at), mergeCommit: sha, author, body: merge ? (body || '').split('\n').slice(1).join('\n').trim() : body, files: f });
  }
  return prs;
}

/** Merged PRs from the GitHub API (needs GITHUB_TOKEN); files for at most `fileLimit` PRs not already known. */
export async function prsFromGitHub(repo, { token = process.env.GITHUB_TOKEN, known = new Set(), fileLimit = 40, pages = 30 } = {}) {
  if (!token) return [];
  const gh = L.REPOS[L.normRepo(repo)]?.github; if (!gh) return [];
  const get = async (path) => { const r = await fetch(`https://api.github.com/repos/${gh}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'axf-shipped-features' } }); if (!r.ok) throw new Error(`GitHub ${r.status} ${path}`); return r.json(); };
  const prs = []; let budget = fileLimit;
  for (let page = 1; page <= pages; page += 1) {
    const batch = await get(`/pulls?state=closed&base=main&per_page=100&page=${page}`);
    for (const p of batch) {
      if (!p.merged_at) continue;
      let files = [];
      if (!known.has(L.prKey(repo, p.number)) && budget > 0) { budget -= 1; try { files = (await get(`/pulls/${p.number}/files?per_page=100`)).map((f) => f.filename); } catch { /* keep going */ } }
      prs.push({ repo, number: p.number, title: p.title, branch: p.head?.ref || '', mergedAt: p.merged_at, mergeCommit: p.merge_commit_sha || '', author: p.user?.login || '', body: p.body || '', createdAt: p.created_at, url: p.html_url, files });
    }
    if (batch.length < 100) break;
  }
  return prs;
}

/** One merged PR → the ledger: date its build's features, else a feature of its own (or an edit of an existing one). */
export function applyPr(db, pr, { existing = D.listFeatures(db), builds = D.listBuilds(db) } = {}) {
  const p = D.putPr(db, pr); if (!p) return 'skip';
  const build = builds.find((b) => (b.pr === p.number && b.repo === p.repo) || (p.branch && b.branch && b.branch === p.branch));
  if (build) {
    D.putPr(db, { ...p, build: build.id, profile: build.profile });
    let n = 0;
    for (const f of D.featuresOfBuild(db, build.key)) {
      if (!f.builds.some((x) => x.id === build.id && x.role === 'added')) continue;
      const to = f.status === 'cancelled' ? f.status : L.laterStatus(f.status, 'merged');
      D.putFeature(db, { ...f, status: to, mergedAt: f.mergedAt || p.mergedAt, mergeCommit: f.mergeCommit || p.mergeCommit, prs: [...f.prs, { repo: p.repo, number: p.number, role: 'added' }], files: f.files.length ? f.files : p.files.slice(0, 60) }, { replace: true, why: `PR ${p.key} merged` });
      n += 1;
    }
    for (const e of D.editsOfBuild(db, build.id)) D.putEdit(db, { ...e, status: L.laterStatus(e.status, 'merged'), mergedAt: e.mergedAt || p.mergedAt, pr: e.pr || p.number, commit: e.commit || p.mergeCommit });
    return n ? 'dated' : 'build';
  }
  const title = p.title.replace(CONVENTIONAL, '').trim();
  if (!title || NOT_A_FEATURE.test(p.title) || HOUSEKEEPING.test(title)) return 'noise';
  // a PR the ledger already holds (as feature or edit) changes nothing
  if (existing.some((f) => f.prs.some((x) => x.repo === p.repo && x.number === p.number))) return 'known';
  const scope = p.files.length ? scopeOf(p.files, p.repo) : { ...scopeFromText(`${p.title} ${p.body}`, plugins(), p.repo), type: '' };
  const cand = { name: title.length > 120 ? `${title.slice(0, 117).trim()}…` : title, description: p.body.slice(0, 2000), type: L.normType((p.title.match(CONVENTIONAL) || [])[1] || scope.type || 'new-feature'), app: scope.app || (p.repo === 'axhub' ? 'axhub' : ''), plugin: scope.plugin, repo: p.repo, files: p.files.slice(0, 60), source: 'import' };
  const hit = matchFeature(cand, existing, { text: `${p.title} ${p.body.slice(0, 2000)}` });
  if (hit) {
    D.putEdit(db, { ...editFrom(cand, hit, { pr: p.number, commit: p.mergeCommit, at: p.mergedAt, mergedAt: p.mergedAt, status: 'merged' }), id: `e-${hit.id.replace(/^f-/, '')}--${p.repo}-pr${p.number}` });
    return 'edit';
  }
  const f = D.putFeature(db, { ...cand, status: 'merged', plannedAt: p.createdAt || p.mergedAt, mergedAt: p.mergedAt, mergeCommit: p.mergeCommit, prs: [{ repo: p.repo, number: p.number, role: 'added' }], confidence: 'guessed' }, { why: `import PR ${p.key}` });
  if (f) existing.push(f);
  return 'feature';
}

export async function importPrs(db, repo, opts = {}) {
  const known = new Set(D.listPrs(db).map((p) => p.key));
  let prs = prsFromGit(repo, { known, ...opts });
  let via = 'git';
  if (!prs.length) { if (!process.env.GITHUB_TOKEN) return { repo, via: 'none', prs: 0, note: L.normRepo(repo) === 'axhub' ? 'set AXF_AXHUB_REPO to an axHub checkout, or GITHUB_TOKEN' : 'no git history and no GITHUB_TOKEN' }; prs = await prsFromGitHub(repo, { known, ...opts }); via = 'github'; }
  prs.sort((a, b) => String(a.mergedAt).localeCompare(String(b.mergedAt)));
  const tally = {}; const existing = D.listFeatures(db); const builds = D.listBuilds(db);
  D.tx(db, () => { for (const p of prs) { const r = applyPr(db, p, { existing, builds }); tally[r] = (tally[r] || 0) + 1; } });
  return { repo, via, prs: prs.length, ...tally };
}

// ------------------------------------------------------------------ commits before pull requests

export function importCommits(db, repo, { cwd = repoPath(repo), max = 20000 } = {}) {
  if (!cwd || !existsSync(cwd)) return { repo, commits: 0 };
  const firstPr = D.listPrs(db).filter((p) => p.repo === L.normRepo(repo) && p.mergedAt).map((p) => p.mergedAt).sort()[0] || '';
  const out = git(cwd, ['log', mainRef(cwd), '--first-parent', '--reverse', `-n${max}`, '--no-merges', '--format=%H%x1f%cI%x1f%s']);
  const existing = D.listFeatures(db); let features = 0; let edits = 0; let n = 0;
  D.tx(db, () => {
    for (const line of out.split('\n')) {
      const [sha, rawAt, subject] = line.split('\x1f'); if (!sha || !subject) continue; const at = utc(rawAt);
      if (firstPr && at >= firstPr) break; // from the first PR on, features come from PRs and builds
      n += 1;
      if (NOT_A_FEATURE.test(subject) || SQUASH_RE.test(subject)) continue;
      const files = git(cwd, ['show', '--name-only', '--format=', sha]).split('\n').filter(Boolean).slice(0, 200);
      const scope = scopeOf(files, repo); const name = subject.replace(CONVENTIONAL, '').trim(); if (!name || HOUSEKEEPING.test(name)) continue;
      const cand = { name, type: L.normType((subject.match(CONVENTIONAL) || [])[1] || scope.type || 'new-feature'), app: scope.app || (L.normRepo(repo) === 'axhub' ? 'axhub' : ''), plugin: scope.plugin, repo: L.normRepo(repo), files, source: 'import' };
      const hit = matchFeature(cand, existing, { text: subject });
      if (hit) { D.putEdit(db, { ...editFrom(cand, hit, { commit: sha, at, mergedAt: at, status: 'merged' }), id: `e-${hit.id.replace(/^f-/, '')}--${sha.slice(0, 12)}` }); edits += 1; continue; }
      const f = D.putFeature(db, { ...cand, status: 'merged', plannedAt: at, mergedAt: at, mergeCommit: sha, commits: [sha], confidence: 'guessed' }, { why: `import commit ${sha.slice(0, 7)}` });
      if (f) { existing.push(f); features += 1; }
    }
  });
  return { repo, commits: n, features, edits };
}

// ------------------------------------------------------------------ seed (AI split of history)

export function readSeed(file = SEED) { try { const j = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(j.features) ? j : { features: [], edits: [] }; } catch { return { features: [], edits: [] }; } }
export function importSeed(db, file = SEED) {
  const s = readSeed(file); let features = 0; let edits = 0;
  D.tx(db, () => {
    for (const f of s.features) if (D.putFeature(db, { source: 'import', confidence: 'guessed', ...f }, { why: 'seed' })) features += 1;
    for (const e of s.edits || []) if (D.putEdit(db, { source: 'import', ...e })) edits += 1;
  });
  return { features, edits };
}

// ------------------------------------------------------------------ everything, in order

export async function importAll(db, { repos = ['amberx-axf', 'axhub'], log = () => {} } = {}) {
  const report = { journal: await importJournal(db) }; log(`journal: ${JSON.stringify(report.journal)}`);
  for (const r of repos) { try { report[`prs:${r}`] = await importPrs(db, r); } catch (e) { report[`prs:${r}`] = { repo: r, error: e.message }; } log(`prs ${r}: ${JSON.stringify(report[`prs:${r}`])}`); }
  for (const r of repos) { report[`commits:${r}`] = importCommits(db, r); log(`commits ${r}: ${JSON.stringify(report[`commits:${r}`])}`); }
  report.seed = importSeed(db); log(`seed: ${JSON.stringify(report.seed)}`);
  D.setMeta(db, 'imported_at', new Date().toISOString());
  const since = D.listFeatures(db).map((f) => f.plannedAt || f.mergedAt).filter(Boolean).sort()[0]; if (since) D.setMeta(db, 'since', since);
  return report;
}
