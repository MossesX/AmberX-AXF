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

/** The note left on a build whose PR merged but whose merge commit the watchdog could not read. */
export const NO_SHA_NOTE = 'Watchdog: the PR merged but its merge commit is unknown (GitHub did not return merge_commit_sha); the build is left as it is until the merge evidence can be read (done-means-merged@1).';

/**
 * The status a merged build settles to under done-means-merged@1, without writing it. `settleStatus` derives landed
 * once every step is ticked and mergedAt is set; landed needs the merge commit and CI green on it (guardStatus), so a
 * build whose CI on the merge commit is not known yet goes to landing (the lander's CI-on-main check takes it to
 * landed); complete is never set here, only by the feature verify. Returns the status (unchanged when nothing fits).
 */
export function mergedTarget(b, { settleStatus, guardStatus, now }) {
  const x = { ...b, steps: b.steps, landed: b.landed ? { ...b.landed } : b.landed };
  settleStatus(x, now);
  let to = x.status === 'complete' || x.status === 'built' ? 'landed' : x.status;
  if (to === b.status) return b.status;
  if (to === 'landed' && !guardStatus({ ...x, status: b.status }, 'landed').ok) to = 'landing';
  if (to === 'landing' && !guardStatus({ ...x, status: b.status }, 'landing').ok) return b.status;
  return to;
}

/**
 * Apply verdicts in ONE store write (withStore: under the store lock, journalled, live to main through builds-live):
 *   complete → the merge evidence is recorded (pr, mergedAt, landed.sha / pr / mergedAt from the PR's merge commit)
 *              and the build moves to landed (CI on the merge commit known green) or landing (CI not known yet);
 *              steps still open keep the status. Complete is never set: only the feature verify sets it
 *              (done-means-merged@1). No merge commit → nothing moves; one note says why.
 *   remove   → archived, with the reason in a note
 * Every touched build gets a build note naming the watchdog and the evidence. Running / waiting builds are never
 * touched. `withStore` / `settle` override the store (tests). Returns each verdict with { applied, why, status }.
 */
export async function apply(verdicts, { by = 'watchdog', withStore, settle, guard } = {}) {
  const ws = withStore ?? (await import('../../../../../../framework/cli/builds-store.mjs')).withStore;
  const settleStatus = settle ?? (await import('../../../../../../framework/plan/builds-merge-core.mjs')).settleStatus;
  const guardStatus = guard ?? (await import('../../../../../../framework/core/build-pipeline.mjs')).guardStatus;
  const out = [];
  ws((s) => {
    const now = new Date().toISOString();
    for (const v of verdicts) {
      const b = (s.builds ?? []).find((x) => x.id === v.row.id && !x.deleted);
      if (!b) { out.push({ ...v, applied: false, why: 'build not found' }); continue; }
      if (HANDS_OFF.includes(b.status)) { out.push({ ...v, applied: false, why: `the build is ${b.status}: left to the orchestrator` }); continue; }
      if (b.status !== v.row.status) { out.push({ ...v, applied: false, why: `the build moved to ${b.status} since the read` }); continue; }
      const before = b.status;
      if (v.action === 'complete') {
        const sha = String(v.mergeCommit || b.landed?.sha || '');
        if (!sha) {
          b.notes = Array.isArray(b.notes) ? b.notes : [];
          if (!b.notes.some((n) => n?.text === NO_SHA_NOTE)) { b.notes.push({ text: NO_SHA_NOTE, at: now }); b.updatedAt = now; }
          out.push({ ...v, applied: false, why: 'merge commit unknown: left as is' }); continue;
        }
        const prN = Number(v.row.pr) || 0;
        const mergedAt = b.mergedAt || v.mergedAt || now;
        const evidence = { ...(b.landed ?? {}), pr: prN || b.landed?.pr || 0, sha, mergedAt, ...(v.ci && !b.landed?.ci ? { ci: v.ci, ciAt: now } : {}) };
        const recorded = b.mergedAt && b.pr === `#${prN}` && b.landed?.sha === sha;
        const to = mergedTarget({ ...b, pr: prN ? `#${prN}` : b.pr, mergedAt, landed: evidence }, { settleStatus, guardStatus, now });
        if (recorded && to === before) { out.push({ ...v, applied: false, noop: true, why: `merge already recorded; status stays ${b.status} until every step is ticked` }); continue; }
        if (prN) b.pr = `#${prN}`;
        b.mergedAt = mergedAt;
        b.landed = evidence;
        b.status = to;
        if (['landing', 'landed'].includes(to) && !b.builtAt) b.builtAt = now;
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
