/**
 * Watchdog table: the merge queue (stale-row@1 kind merge-queue), from the plugin that provides
 * service:axf.merge-queue@1 (its merge-queue.mjs state: `land.mjs queue list`). Every entry in the line (`items`) and
 * every open PR waiting to join it (`waiting`) is one row { kind: 'merge-queue', id: <pr>, build, pr, branch, status }.
 * A PR that is both in the line and waiting is one row.
 *
 * read() → { table, rows, wantPrs, provider } ; `available: false` when no plugin provides the merge queue here.
 */
import { pathToFileURL } from 'node:url';
import { entryOf, providerOf } from '../providers.mjs';

export const TABLE = Object.freeze({ id: 'merge-queue', label: 'Merge queue', kinds: ['merge-queue'], capability: 'axf.merge-queue@1' });
export const ENTRY = ['land/merge-queue.mjs', 'merge-queue.mjs'];

/** One queue entry (merge-queue@1 item or waiting line) → a classifier row, or null. */
export function rowOf(x, where = 'items') {
  const pr = Number(String(x?.pr ?? '').replace(/^#/, '')) || 0;
  if (!pr) return null;
  return { kind: 'merge-queue', id: String(pr), build: String(x.build ?? ''), pr, branch: String(x.branch ?? ''), status: String(x.state ?? (where === 'items' ? 'queued' : 'waiting')), title: String(x.title ?? ''), where };
}

/** Rows from a merge-queue@1 state (pure). */
export function rowsFrom(state) {
  const seen = new Set(); const rows = [];
  for (const where of ['items', 'waiting']) {
    for (const x of Array.isArray(state?.[where]) ? state[where] : []) {
      const r = rowOf(x, where); if (!r || seen.has(r.id)) continue;
      seen.add(r.id); rows.push(r);
    }
  }
  return rows;
}

/** The provider's queue module (readQueue, queueControl, settings), or null. */
export async function queueModule() {
  const p = providerOf(TABLE.capability);
  const f = entryOf(p, ENTRY);
  if (!f) return null;
  if (p.dataDir && !process.env.AXF_PUSH_BANNER_DIR) process.env.AXF_PUSH_BANNER_DIR = p.dataDir;
  return { provider: p, mod: await import(pathToFileURL(f).href) };
}

/** Read the queue state. `state` overrides the read (tests). */
export async function read({ state } = {}) {
  let st = state; let provider = '';
  if (!st) {
    const q = await queueModule();
    if (!q) return { table: TABLE.id, rows: [], wantPrs: [], available: false, why: 'no plugin provides service:axf.merge-queue@1' };
    provider = q.provider.id;
    st = q.mod.readQueue(q.mod.settings ? q.mod.settings() : (await import(pathToFileURL(entryOf(q.provider, ['land/land.mjs'])).href)).settings());
  }
  const rows = rowsFrom(st);
  return { table: TABLE.id, rows, wantPrs: rows.map((r) => r.pr), available: true, provider };
}
