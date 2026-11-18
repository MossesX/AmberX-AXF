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
import { guardStatus, normLanded } from '../../../../../../framework/core/build-pipeline.mjs';

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
 * The status a build settles to once its merge is recorded, under the done-means-merged@1 guard (pure: `b` is not
 * changed). The store's own rule gives landed / complete once every step is ticked, but the watchdog only knows the
 * PR merged and its merge commit, never CI on that commit or a verify: so a build the rule would call landed goes to
 * `landing` (the auto-lander proves CI green on the merge commit and sets landed), and one with steps still open
 * keeps its status. Returns { status, landed }.
 */
export function settledStatus(b, v, now, settleStatus) {
  const x = { ...b, steps: b.steps, pr: v.row?.pr ? `#${v.row.pr}` : b.pr, mergedAt: b.mergedAt || v.mergedAt || now };
  const landed = normLanded({ ...(normLanded(b.landed) ?? {}), pr: v.row?.pr || normLanded(b.landed)?.pr || 0, sha: normLanded(b.landed)?.sha || v.mergeCommit || '', mergedAt: x.mergedAt, ci: normLanded(b.landed)?.ci === 'success' ? 'success' : 'unknown' });
  x.landed = landed;
  settleStatus(x, now);
  if (x.status !== b.status && !guardStatus({ ...x, status: b.status }, x.status).ok) {
    x.status = guardStatus({ ...x, status: b.status }, 'landing').ok ? 'landing' : b.status;
  }
  return { status: x.status, landed };
}

/**
 * Apply verdicts in ONE store write (withStore: under the store lock, journalled, live to main through builds-live):
 *   complete → the merged PR is recorded (pr, mergedAt, landed.sha = the merge commit) and the status settles by the
 *              store's own rule under the done-means-merged@1 guard (settledStatus: landing once every step is ticked,
 *              the auto-lander sets landed when CI on the merge commit is green; otherwise it stays and says why)
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
      if (v.action === 'complete' && b.mergedAt && b.pr === `#${v.row.pr}` && settledStatus(b, v, now, settleStatus).status === b.status) {
        out.push({ ...v, applied: false, noop: true, why: `merge already recorded; status stays ${b.status} until every step is ticked` }); continue;
      }
      if (v.action === 'complete') {
        if (v.row.pr) b.pr = `#${v.row.pr}`;
        if (!b.mergedAt) b.mergedAt = v.mergedAt || now;
        const s2 = settledStatus(b, v, now, settleStatus);
        if (s2.landed) b.landed = s2.landed;
        b.status = s2.status;
        if (['landing', 'landed', 'complete'].includes(b.status) && !b.builtAt) b.builtAt = now;
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
