/**
 * Orchestrator demo — the dry-run landing line. It asks the real auto-lander@1 decision table
 * (framework/core/auto-lander.mjs) what to do with a demo build's simulated PR (CI red / clash / green) and records
 * the answer and every "would do" in its own ledger, so the demo shows the real decisions without a PR, a branch push,
 * a fix session on a Claude account or the merge queue. It refuses any build without the demo- prefix.
 *
 * The demo branch and PR are simulated names (`demo/<build>`, `demo-pr:<build>`); nothing is created on GitHub.
 */
import { decide, normPolicy } from '../../../../framework/core/auto-lander.mjs';
import { isDemoId } from '../../../../framework/core/demo-build.mjs';

export const LEDGER = 'lander.json';

const guard = (id) => { if (!isDemoId(id)) throw Object.assign(new Error(`dry-run lander refused: ${id} is not a demo build`), { code: 'not-demo-build' }); };

/** A simulated PR snapshot (gate-rules snapshot shape) for a demo build. */
export function snapshot(id, { ci = 'success', conflicts = [], failing = [] } = {}) {
  guard(id);
  return { number: 1, state: 'open', draft: false, fork: false, ci, conflicts, failing, ui: '', landHeld: '', removed: '' };
}

export const branchOf = (id) => `demo/${id}`;
export const prOf = (id) => `demo-pr:${id}`;

export function dryLander({ data }) {
  const read = () => { const l = data.read(LEDGER, null); return l && Array.isArray(l.entries) ? l : { $axf: 'demo-lander@1', entries: [], branches: [] }; };
  const write = (l) => data.write(LEDGER, l);
  const policy = normPolicy({ enabled: true, mergeMain: true, fixSessions: true, land: true, maxAttempts: 3 });
  return {
    /** The auto-lander's decision for the build in this simulated state, recorded as a dry-run entry. */
    decide(build, snap, attempts = [], at = new Date().toISOString()) {
      guard(build.id);
      const d = decide({ build: build.id, pr: prOf(build.id), state: 'waiting', at }, snap, attempts, policy, { at });
      const l = read();
      l.entries.push({ build: build.id, at, action: d.action, kind: d.kind ?? '', reason: d.reason ?? '', dryRun: true });
      if (!l.branches.includes(branchOf(build.id))) l.branches.push(branchOf(build.id));
      write(l);
      return d;
    },
    /** What landing would do: recorded only, never merged. */
    land(build, at = new Date().toISOString()) {
      guard(build.id);
      const l = read();
      const e = { build: build.id, at, action: 'land', kind: 'land', reason: `dry run: would merge ${prOf(build.id)} (${branchOf(build.id)}) into main; nothing merged`, dryRun: true };
      l.entries.push(e); write(l);
      return e;
    },
    entries: (id = '') => read().entries.filter((e) => !id || e.build === id),
    branches: () => read().branches,
    /** Forget the dry-run entries and simulated branches (all, or only these builds). */
    cleanup(ids = null) {
      const l = read();
      const drop = (id) => isDemoId(id) && (!ids || ids.includes(id));
      const removed = l.branches.filter((b) => drop(b.replace(/^demo\//, '')));
      write({ ...l, entries: l.entries.filter((e) => !drop(e.build)), branches: l.branches.filter((b) => !removed.includes(b)) });
      return removed;
    },
  };
}
