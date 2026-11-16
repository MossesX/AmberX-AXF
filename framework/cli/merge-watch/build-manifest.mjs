/**
 * merge-watch@1 host: a shipped-manifest@1 for one mapped landing (map-commit.mjs).
 *
 *   build       the store record (with build-origin's words when the record has none); a build the store never had gets
 *               a record from what is known (branch id, PR title); a landing with no build is unlinked: `main-<sha9>`,
 *               titled by its subject, said = the commit subjects (verbatim: false, source: git)
 *   said        build-origin@1 only: Brett's words are never made up from a paraphrase
 *   mergedAt    the PR's merged_at; else the landing commit's time.   landedAt: the landing commit's time
 *   landedCommit, commits, files, areas, pr, branch: from the mapped landing
 *   tests       the CI runs on the merge sha (GitHub Actions: one line per workflow, pass / fail / unknown) plus the test
 *               lines of the build report
 *   report      _claude/builds/reports/<id>.md when it exists (also its "Open" items)
 *
 * Returns { id, record, manifest, overlay, unlinked }: `manifest` is complete and valid on its own (dry runs, a host with
 * no store); `overlay` is what shipped.mjs ship(id, { manifest: overlay }) takes when the build goes through the store.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as MW from '../../core/merge-watch.mjs';
import * as SM from '../../core/shipped-manifest.mjs';
import { parseReport } from '../shipped.mjs';
import { githubGet, GITHUB_REPO } from './map-commit.mjs';
import { REPO_ROOT } from './walk.mjs';

const CI_RESULT = { success: 'pass', failure: 'fail', cancelled: 'fail', timed_out: 'fail', skipped: 'skip', neutral: 'skip' };

/** One test line per CI workflow run on the sha (the newest run of each workflow). */
export async function ciTestsOf(sha, { github = githubGet, repo = GITHUB_REPO } = {}) {
  const body = await github(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=20`);
  const runs = Array.isArray(body?.workflow_runs) ? body.workflow_runs : [];
  const newest = new Map();
  for (const r of runs) if (!newest.has(r.name) || newest.get(r.name).run_number < r.run_number) newest.set(r.name, r);
  return [...newest.values()].map((r) => ({ name: `CI: ${r.name}`, command: r.html_url || '', result: r.status !== 'completed' ? 'unknown' : CI_RESULT[r.conclusion] || 'unknown', detail: r.status !== 'completed' ? r.status : r.conclusion || '' }));
}

export function reportFor(id, { root = REPO_ROOT } = {}) {
  if (!id) return { report: '', tests: [], open: [] };
  const rel = `_claude/builds/reports/${id}.md`;
  if (!existsSync(join(root, rel))) return { report: '', tests: [], open: [] };
  try { const p = parseReport(readFileSync(join(root, rel), 'utf8')); return { report: rel, tests: p.tests, open: p.open }; } catch { return { report: rel, tests: [], open: [] }; }
}

const withOrigin = (rec, origin) => (origin && !String(rec.origin?.said || '').trim() ? { ...rec, origin: { ...(rec.origin || {}), ...origin } } : rec);

/**
 * mapped = map-commit.mjs mapCommit() result. ctx = { store, origins, github, root, now, prev (the build's current manifest) }.
 */
export async function buildManifest(mapped, { store, origins = {}, github = githubGet, repo = GITHUB_REPO, root = REPO_ROOT, now = new Date().toISOString(), prev = null, ci = true } = {}) {
  const e = mapped.entry; const pr = mapped.pr;
  const unlinked = !mapped.build?.id;
  const id = unlinked ? `main-${e.sha.slice(0, 9)}` : mapped.build.id;
  const rec0 = (Array.isArray(store?.builds) ? store.builds : []).find((b) => b && !b.deleted && b.id === id);
  const record = withOrigin(rec0 ?? { id, title: unlinked ? e.subject : (pr?.title || id), branch: e.branch, steps: [], origin: null }, origins[id]);
  const rep = reportFor(unlinked ? '' : id, { root });
  const ciTests = ci ? await ciTestsOf(e.sha, { github, repo }) : [];
  const mergedAt = SM.iso(pr?.mergedAt) || e.at;
  const found = {
    branch: e.branch, landedCommit: e.sha, landedAt: e.at, mergedAt, commits: e.commits, files: mapped.files,
    pr: e.pr ? { repo: 'amberx-axf', number: e.pr, ...(pr?.url ? { url: pr.url } : {}) } : undefined,
    report: rep.report, tests: [...ciTests, ...rep.tests], open: rep.open,
  };
  let manifest = SM.manifestFromBuild(record, found, { now, source: 'orchestrator', by: 'merge-watch', prev });
  // a landing's own time and PR beat whatever the record had from an earlier landing
  manifest = SM.normManifest({ ...manifest, landedCommit: e.sha, landedAt: e.at, mergedAt, ...(unlinked ? { said: MW.fallbackSaid(e, mapped.subjects ?? []) ?? manifest.said } : {}) }, { now });
  const overlay = {
    ...MW.toManifestOverlay(e, { known: new Set([id]) }),
    build: { id, title: record.title || '' }, mergedAt, landedAt: e.at, files: mapped.files,
    ...(found.tests.length ? { tests: found.tests } : {}), ...(rep.report ? { report: rep.report } : {}),
  };
  return { id, record, manifest, overlay, unlinked, valid: SM.validateManifest(manifest) };
}
