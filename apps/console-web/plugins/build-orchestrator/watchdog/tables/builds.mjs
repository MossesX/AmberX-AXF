/**
 * Watchdog table: the builds store's own rows (stale-row@1 kinds pending, queued, building).
 *
 * The three projections of _claude/builds/store.json (builds@1, framework/cli/builds-store.mjs) that a build sits in
 * while it is not finished: Pending (status pending), Queue (queued) and Building (running, waiting, blocked). Each
 * build becomes one classifier row { kind, id, build, pr, branch, status }; finished builds (built, complete,
 * archived, failed) are no rows to watch. Deleted builds are left alone (they live in the Deleted tab).
 *
 * read() → { table, rows, builds, wantPrs }: `builds` is every store record (the facts gatherer reads each build's
 * status, merged time, branch and PR from it), `wantPrs` the PR numbers the rows name.
 */
import { kindOfBuild, prNumber } from '../../../../../../framework/core/stale-rows.mjs';
import { guardStatus } from '../../../../../../framework/core/build-pipeline.mjs';

/** done-means-merged@1 statuses that need CI + verify evidence the watchdog does not have. */
const GUARDED = Object.freeze(['landed', 'built', 'complete']);

export const TABLE = Object.freeze({ id: 'builds', label: 'Builds store (Pending, Queue, Building)', kinds: ['pending', 'queued', 'building'] });

/** One builds@1 record → a classifier row, or null when the build is no row to watch. */
export function rowOf(b) {
  if (!b || typeof b !== 'object' || !b.id || b.deleted) return null;
  const kind = kindOfBuild(b);
  if (!kind) return null;
  return { kind, id: String(b.id), build: String(b.id), pr: prNumber(b.pr), branch: String(b.branch ?? ''), status: String(b.status ?? ''), title: String(b.title ?? '') };
}

/** Rows from a store object (pure). */
export function rowsFrom(store) {
  const builds = Array.isArray(store?.builds) ? store.builds : [];
  return builds.map(rowOf).filter(Boolean);
}

/** Read the store (no lock: a read never waits on a writer) and map it. `store` overrides the read (tests). */
export async function read({ store } = {}) {
  const s = store ?? (await import('../../../../../../framework/cli/builds-store.mjs')).readStoreNow();
  const rows = rowsFrom(s);
  return { table: TABLE.id, rows, builds: Array.isArray(s?.builds) ? s.builds : [], wantPrs: rows.map((r) => r.pr).filter(Boolean) };
}

/** Builds the watchdog never writes: a session may be on them (the orchestrator and the reconciler own those). */
export const HANDS_OFF = Object.freeze(['running', 'waiting']);

/**
 * Apply verdicts in ONE store write (withStore: under the store lock, journalled, live to main through builds-live):
 *   complete → the merged PR is recorded (pr, mergedAt, landed.pr / sha / mergedAt) and the status settles by the
 *              store's own rule. done-means-merged@1: landed / complete also need CI green on the merge commit and the
 *              verify, which the watchdog never claims, so a build whose steps are all ticked goes to landing (the
 *              lander checks CI and the verify finishes it); with steps still open it stays and says why
 *   remove   → archived, with the reason in a note
 * Every touched build gets a build note naming the watchdog and the evidence. Running / waiting builds are never
 * touched. `withStore` / `settle` override the store (tests). Returns each verdict with { applied, why, status }.
 */
export async function apply(verdicts, { by = 'watchdog', withStore, settle } = {}) {
  const ws = withStore ?? (await import('../../../../../../framework/cli/builds-store.mjs')).withStore;
  const settleStatus = settle ?? (await import('../../../../../../framework/plan/builds-merge-core.mjs')).settleStatus;
  const out = [];
  ws((s) => {
    const now = new Date().toISOString();
    for (const v of verdicts) {
      const b = (s.builds ?? []).find((x) => x.id === v.row.id && !x.deleted);
      if (!b) { out.push({ ...v, applied: false, why: 'build not found' }); continue; }
      if (HANDS_OFF.includes(b.status)) { out.push({ ...v, applied: false, why: `the build is ${b.status}: left to the orchestrator` }); continue; }
      if (b.status !== v.row.status) { out.push({ ...v, applied: false, why: `the build moved to ${b.status} since the read` }); continue; }
      const before = b.status;
      if (v.action === 'complete' && b.mergedAt && b.pr === `#${v.row.pr}` && !settleStatus({ ...b, steps: b.steps }, now)) {
        out.push({ ...v, applied: false, noop: true, why: `merge already recorded; status stays ${b.status} until every step is ticked` }); continue;
      }
      if (v.action === 'complete') {
        if (v.row.pr) b.pr = `#${v.row.pr}`;
        if (!b.mergedAt) b.mergedAt = v.mergedAt || now;
        b.landed = { ...(b.landed ?? {}), pr: v.row.pr || b.landed?.pr || 0, mergedAt: b.mergedAt, ...(v.mergeCommit && !b.landed?.sha ? { sha: v.mergeCommit } : {}) };
        settleStatus(b, now);
        // the store's guard would refuse landed / complete without CI + verify: hand the build to the lander instead
        if (GUARDED.includes(b.status) && !guardStatus({ ...b, status: before }, b.status).ok) {
          b.status = guardStatus({ ...b, status: before }, 'landing').ok ? 'landing' : before;
          b.builtAt = b.status === 'landing' ? (b.builtAt || now) : '';
        }
      } else if (v.action === 'remove') {
        b.status = 'archived';
      }
      const changed = b.status !== before;
      b.notes = Array.isArray(b.notes) ? b.notes : [];
      b.notes.push({ text: `Watchdog: ${v.line}${changed ? ` (${before} → ${b.status})` : ` (status stays ${b.status}: steps still open)`}`.slice(0, 2000), at: now });
      b.updatedAt = now;
      out.push({ ...v, applied: true, status: b.status, why: changed ? '' : `merge recorded; status stays ${b.status} until every step is ticked` });
    }
    return s;
  }, { by, action: 'stale-watchdog', note: `${verdicts.length} stale row(s)` });
  return out;
}
