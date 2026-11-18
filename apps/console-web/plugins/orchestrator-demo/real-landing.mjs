/**
 * Orchestrator demo — the REAL landing (Nov 18 2026, build auto-lander-never-wait-missing-ui-review). Brett: "If it
 * recorded the test of the pipeline and didn't merge it on its own, then the test failed."
 *
 * The demo's landing act no longer only says what it would merge: through the console's own routes it creates a demo
 * branch with one commit (a line in _claude/builds/demo/landings.md), opens the PR, puts it in the real merge queue, and
 * the act passes only when the queue has merged it. Every call is a push-banner route the console UI, MCP and the CLI
 * use too; nothing merges here, the merge queue merges. Only demo- builds (branch demo/<build>) are ever touched.
 *
 *   land({ build, runId, at })  → { ok, pr, branch, url, why }   create the branch, open the PR, queue it
 *   merged(build)               → true once the merge queue lists the PR as merged (the ledger remembers it)
 *   cleanup(ids)                → deletes the demo branches still unmerged (the queue tidies merged ones)
 * The ledger (real-landings.json in the plugin data folder) is what the summary, the cleanup and the tests read.
 */
import { isDemoId } from '../../../../framework/core/demo-build.mjs';

export const LEDGER = 'real-landings.json';
export const FILE_PATH = '_claude/builds/demo/landings.md';
export const DEFAULT_SLUG = 'MossesX/AmberX-AXF';
export const branchOf = (build) => `demo/${build}`;

const guard = (id) => { if (!isDemoId(id)) throw Object.assign(new Error(`real landing refused: ${id} is not a demo build`), { code: 'not-demo-build' }); };
const why = (r, fallback) => String(r?.detail || r?.error || r?.message || fallback).slice(0, 300);

export function realLanding({ call, data, slug = process.env.AXF_LAND_REPO_SLUG || DEFAULT_SLUG }) {
  const read = () => { const l = data.read(LEDGER, null); return l && Array.isArray(l.entries) ? l : { $axf: 'demo-real-landings@1', entries: [] }; };
  const write = (l) => data.write(LEDGER, l);
  return {
    kind: 'real',
    async land({ build, runId = '', at = new Date().toISOString() }) {
      guard(build);
      const branch = branchOf(build);
      const line = `${at} ${runId || build}: landed by the orchestrator demo (${build}). The real merge queue merged this line.`;
      const b = await call('POST', '/api/plugins/push-banner/demo-branch', { repo: slug, branch, build, path: FILE_PATH, line, message: `Orchestrator demo: ${build} lands for real` });
      if (!b || b.ok === false) return { ok: false, branch, pr: 0, url: '', why: `the console could not create ${branch}: ${why(b, 'no answer')}` };
      const pr = await call('POST', '/api/plugins/push-banner/pr', { repo: slug, branch });
      const number = Number(pr?.number) || 0;
      if (!number) return { ok: false, branch, pr: 0, url: '', why: `no PR for ${branch}: ${why(pr, 'the console did not answer')}` };
      const q = await call('POST', '/api/plugins/push-banner/queue/add', { pr: number });
      const queued = !!q && q.ok !== false;
      const e = { build, branch, pr: number, url: String(pr?.url || ''), sha: String(b.sha || ''), at, queued, merged: false, mergedAt: '' };
      const l = read(); l.entries = [...l.entries.filter((x) => x.build !== build), e]; write(l);
      return { ok: queued, branch, pr: number, url: e.url, why: queued ? '' : `the merge queue did not take #${number}: ${why(q, 'no answer')}` };
    },
    async merged(build) {
      const e = read().entries.find((x) => x.build === build);
      if (!e) return false;
      if (e.merged) return true;
      const q = await call('GET', '/api/plugins/push-banner/queue');
      const m = (Array.isArray(q?.merged) ? q.merged : []).find((x) => Number(x?.pr) === e.pr);
      if (!m) return false;
      const l = read(); l.entries = l.entries.map((x) => (x.build === build ? { ...x, merged: true, mergedAt: String(m.at || '') } : x)); write(l);
      return true;
    },
    entry: (build) => read().entries.find((x) => x.build === build) || null,
    entries: () => read().entries,
    /** Delete the demo branches still unmerged (their PRs close with the branch); merged ones the queue tidies. */
    async cleanup(ids = null) {
      const l = read(); const gone = [];
      for (const e of l.entries) {
        if (ids && !ids.includes(e.build)) continue;
        if (!e.merged) await call('POST', '/api/plugins/push-banner/demo-branch/delete', { repo: slug, branch: e.branch });
        gone.push(e.branch);
      }
      write({ ...l, entries: l.entries.filter((e) => !gone.includes(e.branch)) });
      return gone;
    },
  };
}
