#!/usr/bin/env node
/**
 * ci-status — the auto-lander's red-CI reader (auto-lander@1 kind `red-ci`, framework/spec/AUTO-LANDER.md).
 *
 * For one PR head it reads, from GitHub:
 *   - the head's check runs (GitHub Actions only, like the landing line's ciOf): success | failure | running | none;
 *   - for each failing job (first MAX_JOBS): the failing step (Actions job steps) and the first error annotations;
 *   - the open "CI build errors" issue (written by .github/workflows/android.yml on a failure): the comments that name
 *     this head or branch, first error lines of their log block.
 * and returns a short failure summary (job, step, first errors) for a fix session's brief (`text`, ≤ 2000 chars).
 *
 * GitHub calls go through the landing line's client (push banner land/land.mjs makeGitHub): every GET is ETag-cached
 * in the shared gh-cache.json (an unchanged answer is a free 304) and reads stop once fewer than its reserve of the
 * shared 5000/h limit is left. The limit is read first from /rate_limit (never billed).
 *
 *   node deploy/auto-lander/ci-status.mjs <head-sha|pr-number> [--branch b] [--json]
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGitHub, settings as landSettings } from '../../apps/console-web/plugins/push-banner/land/land.mjs';  // axf-plugin:push-banner

export const ISSUE_TITLE = 'CI build errors';
export const MAX_JOBS = 4;
export const MAX_ERRORS = 5;
export const TEXT_MAX = 2000;
const BAD = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale']);
const ERR_LINE = /(error|failed|✗|✖|assert|expected|exception|traceback|not ok|what went wrong)/i;

const clip = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

/** CI over a head's check runs (Actions only; a skipped run is not CI) → { ci, failing: [run] }. */
export function classify(runs) {
  const ours = (runs || []).filter((r) => (r?.app?.slug || 'github-actions') === 'github-actions' && r?.conclusion !== 'skipped');
  if (!ours.length) return { ci: 'none', failing: [] };
  if (ours.some((r) => r.status !== 'completed')) return { ci: 'running', failing: [] };
  const failing = ours.filter((r) => BAD.has(r.conclusion));
  return { ci: failing.length ? 'failure' : 'success', failing };
}

/** The first error-looking lines of a log excerpt (code blocks first). */
export function firstErrors(text, max = MAX_ERRORS) {
  const t = String(text || '');
  const blocks = [...t.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const lines = (blocks.length ? blocks.join('\n') : t).split('\n').map((l) => l.trim()).filter(Boolean);
  const hits = lines.filter((l) => ERR_LINE.test(l) && !/^at\s/.test(l));
  return (hits.length ? hits : lines.slice(-max)).slice(0, max).map((l) => clip(l, 240));
}

/** The summary as text for a brief. */
export function summaryText(s) {
  if (s.ci !== 'failure') return `CI on ${String(s.head).slice(0, 9)}: ${s.ci}.`;
  const out = [`CI is red on ${String(s.head).slice(0, 9)}${s.branch ? ` (${s.branch})` : ''}:`];
  for (const j of s.jobs) {
    out.push(`- ${j.job}${j.step ? ` › ${j.step}` : ''}${j.conclusion !== 'failure' ? ` (${j.conclusion})` : ''}`);
    for (const e of j.errors) out.push(`    ${e}`);
  }
  if (s.more) out.push(`- … and ${s.more} more failing job${s.more === 1 ? '' : 's'}`);
  if (s.issue?.errors?.length) { out.push(`From "${ISSUE_TITLE}" #${s.issue.number}:`); for (const e of s.issue.errors) out.push(`    ${e}`); }
  return clip(out.join('\n'), TEXT_MAX);
}

/**
 * Read CI for a head → { ci, head, branch, pr, jobs: [{ job, step, conclusion, url, errors }], more, issue, text, calls }.
 *   head    the commit sha (or give pr and it is read from the PR)
 *   gh      a GitHub client (method, path) → data; default the landing line's ETag-cached one
 */
export async function ciStatus({ head = '', pr = 0, branch = '', gh = null, s = landSettings(), log = () => {} } = {}) {
  const client = gh || makeGitHub(s);
  const slug = s.slug;
  try { await client('GET', '/rate_limit'); } catch (e) { log(`rate_limit: ${e.message}`); }
  if (!head && pr) { const p = await client('GET', `/repos/${slug}/pulls/${pr}`); head = p?.head?.sha || ''; branch ||= p?.head?.ref || ''; }
  if (!head) throw Object.assign(new Error('ci-status needs a head sha or a PR number'), { code: 'invalid' });
  const runs = await client('GET', `/repos/${slug}/commits/${head}/check-runs?per_page=100`);
  const { ci, failing } = classify(runs?.check_runs || []);
  const jobs = [];
  for (const r of failing.slice(0, MAX_JOBS)) {
    const j = { job: clip(r.name, 120), step: '', conclusion: r.conclusion, url: r.html_url || '', errors: [] };
    try {
      const job = await client('GET', `/repos/${slug}/actions/jobs/${r.id}`);
      const st = (job?.steps || []).find((x) => BAD.has(x.conclusion));
      if (st) j.step = clip(st.name, 160);
    } catch (e) { log(`job ${r.id}: ${e.message}`); }
    try {
      const ann = await client('GET', `/repos/${slug}/check-runs/${r.id}/annotations?per_page=50`);
      j.errors = (Array.isArray(ann) ? ann : []).filter((a) => a.annotation_level === 'failure' && !/Process completed with exit code/i.test(a.message || ''))
        .slice(0, MAX_ERRORS).map((a) => clip(`${a.path && a.path !== '.github' ? `${a.path}${a.start_line ? `:${a.start_line}` : ''}: ` : ''}${String(a.message || '').split('\n')[0]}`, 240));
    } catch (e) { log(`annotations ${r.id}: ${e.message}`); }
    if (!j.errors.length && r.output?.summary) j.errors = firstErrors(r.output.summary);
    jobs.push(j);
  }
  let issue = null;
  if (ci === 'failure') {
    try {
      const list = await client('GET', `/repos/${slug}/issues?state=open&per_page=50`);
      const it = (Array.isArray(list) ? list : []).find((x) => x.title === ISSUE_TITLE && !x.pull_request);
      if (it) {
        const page = Math.max(1, Math.ceil((it.comments || 0) / 100));
        const comments = it.comments ? await client('GET', `/repos/${slug}/issues/${it.number}/comments?per_page=100&page=${page}`) : [];
        const mine = (Array.isArray(comments) ? comments : []).filter((c) => String(c.body || '').includes(head) || (branch && String(c.body || '').includes(`\`${branch}\``)));
        const last = mine[mine.length - 1];
        issue = { number: it.number, url: last?.html_url || it.html_url || '', errors: last ? firstErrors(last.body) : [] };
      }
    } catch (e) { log(`issue: ${e.message}`); }
  }
  const out = { ci, head, branch, pr: Number(pr) || 0, jobs, more: Math.max(0, failing.length - jobs.length), issue, calls: client.calls ?? 0 };
  client.save?.();
  return { ...out, text: summaryText(out) };
}

// ------------------------------------------------------------------ CLI

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2); const json = a.includes('--json');
  const opt = (k) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : ''; };
  const ref = a.find((x, i) => !x.startsWith('--') && a[i - 1] !== '--branch') || '';
  const isPr = /^\d{1,7}$/.test(ref);
  ciStatus({ head: isPr ? '' : ref, pr: isPr ? Number(ref) : 0, branch: opt('branch'), log: (m) => process.stderr.write(`${m}\n`) })
    .then((r) => { process.stdout.write(`${json ? JSON.stringify(r, null, 1) : r.text}\n`); process.exitCode = r.ci === 'failure' ? 3 : 0; })
    .catch((e) => { process.stderr.write(`${e.message}\n`); process.exitCode = e.code === 'invalid' ? 2 : 1; });
}
