/**
 * build-rows — how the dispatcher (pipeline.mjs) reads and writes build status: one build row at a time, or the rows
 * of the statuses it asks for. There is no pipeline status file (Nov 25 2026): status lives in the builds store only
 * (framework/cli/builds-store.mjs, the Postgres tables behind data-store@1), and nothing here reads or writes a
 * whole-document copy of it.
 *
 *   readBuild(id)                 one build by id or alias, or undefined
 *   updateBuild(id, fn, meta)     ONE per-build row update: fn(build) changes that build in place. On axf-data the save
 *                                 is a data-patch@1 of that build's rows only, checked against the rev it was read at
 *                                 (a conflict re-reads and re-applies), with its journal line in the same transaction.
 *   rowsByStatus(statuses)        the builds in those statuses (deleted ones left out), as { ...store head, builds }:
 *                                 what a tick plans over, never the settled history
 *
 * data-store@1 has no call that filters rows on the server yet, so rowsByStatus picks the rows out of one store read.
 * This file is the one place the dispatcher's reads move onto such a call when axf-data has it.
 */
import * as storeCore from '../../../../framework/plan/builds-store-core.mjs';
import { loadStore, withStore } from '../../../../framework/cli/builds-store.mjs';

/** Statuses of a build that waits for its turn or is being worked on (builds@1 and Pipeline 2.0): what a tick plans over. */
export const OPEN_STATUSES = Object.freeze(storeCore.STATUSES.filter((s) => !['built', 'landed', 'complete', 'escalated', 'archived'].includes(s)));

/** One build by its id or alias, as the store holds it now (with its `pipelineView`), or undefined. */
export function readBuild(id) { return storeCore.findBuild(loadStore(), id); }

/**
 * One per-build row update. fn(build) changes the build in place; it gets undefined when there is no such build (and
 * may throw to refuse the write). A build fn leaves untouched is not written. Every guard of a store write applies.
 * → what withStore returns ({ store, changes, rev, refused, flowRefused })
 */
export function updateBuild(id, fn, meta = {}) {
  return withStore((s) => { fn(storeCore.findBuild(s, id)); return s; }, { note: id, ...meta });
}

/**
 * The builds in the given statuses, deleted ones left out: { ...the store's head (rev, rules, meta), builds }.
 * The shape is the store's, so the planners take it as they took the store; the rows are only the ones asked for.
 */
export function rowsByStatus(statuses = OPEN_STATUSES) {
  const want = new Set(statuses);
  const s = loadStore();
  return { ...s, builds: s.builds.filter((b) => !b.deleted && want.has(b.status)) };
}
