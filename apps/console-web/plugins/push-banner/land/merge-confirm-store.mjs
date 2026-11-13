/**
 * The push banner's side of merge-confirm@1 (framework/spec/MERGE-CONFIRM.md): every merge call this plugin makes is
 * recorded as pending-github-confirmation first and is "merged" only once a read-back from GitHub proves it (state
 * MERGED, merged_at, merge_commit_sha, the commit on main). A merge API 200 alone never counts.
 *
 * This folder runs on the host with node built-ins only (land.test.mjs), so the record, the read-back and the shared
 * store are the framework's: framework/cli/merge-confirm.mjs, run as a child process with --json. Its store
 * (<console root>/.axf-console/merge-confirm/records.json) is shared with every other merge path (deploy scripts,
 * builds-live), which is why it is framework data and not this plugin's.
 *
 *   mergeAndConfirm(s, gh, { repo, pr, path, by, build, sha, method })  request → merge call → called → one read-back
 *   requestMerge / recordCall / confirmNow / recheck / getConfirm / listConfirm / tickConfirm   the CLI, one call each
 *   isMerged(rec)   the one question before anything is counted, dropped from a queue or redeployed
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

export const PENDING = 'pending-github-confirmation';
export const isMerged = (rec) => !!rec && typeof rec === 'object' && rec.state === 'merged';
export const isPending = (rec) => !!rec && (rec.state === PENDING || rec.state === 'merge-requested');
const repoOf = (r) => String(r || '').toLowerCase();

/** Runs framework/cli/merge-confirm.mjs <args> --json; the parsed answer, or { ok: false, error }. `s.mergeConfirm` = a stub for tests. */
export function cli(s, args) {
  if (typeof s?.mergeConfirm === 'function') return s.mergeConfirm(args);
  const r = spawnSync(process.execPath, [join(s.repo, 'framework/cli/merge-confirm.mjs'), ...args.map(String), '--json'], { encoding: 'utf8', timeout: 90000, env: process.env });
  const text = (r.stdout || '').trim().split('\n').pop() || '';
  try { return JSON.parse(text); } catch { return { ok: false, error: (r.stderr || r.error?.message || 'merge-confirm did not answer').trim().slice(0, 300) }; }
}
const rec = (v) => (v && v.$axf === 'merge-confirm@1' ? v : null);

export const requestMerge = (s, { repo, pr, path, by = '', build = '', url = '' }) => rec(cli(s, ['request', repo, pr, '--path', path, ...(by ? ['--by', by] : []), ...(build ? ['--build', build] : []), ...(url ? ['--url', url] : [])]));
/** `call` = { status, merged, sha, message } or null (no answer). */
export const recordCall = (s, repo, pr, call) => rec(cli(s, ['called', repo, pr, ...(call ? ['--status', call.status || 0, ...(call.merged ? ['--merged'] : []), ...(call.sha ? ['--sha', call.sha] : []), ...(call.message ? ['--message', String(call.message).slice(0, 200)] : [])] : ['--none'])]));
export const confirmNow = (s, repo, pr, { path = 'reconcile', by = '' } = {}) => rec(cli(s, ['confirm', repo, pr, '--path', path, ...(by ? ['--by', by] : [])]));
export const recheck = (s, repo, pr, by = '') => rec(cli(s, ['recheck', repo, pr, ...(by ? ['--by', by] : [])]));
export const getConfirm = (s, repo, pr) => rec(cli(s, ['status', repo, pr]));
export const listConfirm = (s) => { const r = cli(s, ['list']); return Array.isArray(r?.records) ? r.records : []; };
/** The poller (one per round): read back what is due, time out the rest. `{ checked, merged, unconfirmed, failed, pending, alert }`. */
export const tickConfirm = (s) => { const r = cli(s, ['tick']); return r && Array.isArray(r.alert) ? r : { checked: 0, merged: [], unconfirmed: [], failed: [], pending: 0, alert: [], errors: [{ error: r?.error || 'tick failed' }] }; };

/**
 * The one merge flow for this plugin: record the request, make the merge call (`gh('PUT', …)`), record its answer and
 * read the PR back once. Answers the merge-confirm@1 record: `merged` only with GitHub's proof, else
 * pending-github-confirmation (the poller keeps reading) or merge-failed (GitHub refused and the PR is still open).
 */
export async function mergeAndConfirm(s, gh, { repo, pr, path, by = '', build = '', url = '', sha = '', method = 'squash', title = '' }) {
  const slug = repoOf(repo);
  const asked = requestMerge(s, { repo: slug, pr, path, by, build, url });
  if (!asked) return { $axf: 'merge-confirm@1', state: 'merge-failed', repo: slug, pr, why: 'could not record the merge request (framework/cli/merge-confirm.mjs)', error: true };
  let call = null;
  try {
    const r = await gh('PUT', `/repos/${repo}/pulls/${pr}/merge`, { merge_method: method, ...(sha ? { sha } : {}), ...(title ? { commit_title: title } : {}) });
    call = { status: 200, merged: r?.merged === true, sha: r?.sha || '', message: r?.message || '' };
  } catch (e) {
    call = e?.status ? { status: e.status, merged: false, sha: '', message: String(e.message || '').slice(0, 200) } : null;
  }
  recordCall(s, slug, pr, call);
  return confirmNow(s, slug, pr, { path, by }) || { ...asked, state: PENDING };
}
