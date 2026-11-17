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
