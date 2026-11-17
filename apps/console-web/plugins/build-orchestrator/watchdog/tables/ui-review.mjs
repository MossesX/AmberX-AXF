/**
 * Watchdog table: UI Review items (stale-row@1 kind ui-review), from the plugin that provides service:ui-review@1
 * (its review.mjs: `review.mjs list`). Every open review item (not approved, not already closed as landed) that names a
 * PR, branch or build is one row { kind: 'ui-review', id: <item id>, build, pr, branch, status }. Design-pack decisions
 * (pack:*) and items that name nothing to check are no rows.
 *
 * read() → { table, rows, wantPrs, available }.
 */
import { pathToFileURL } from 'node:url';
import { entryOf, providerOf } from '../providers.mjs';

export const TABLE = Object.freeze({ id: 'ui-review', label: 'UI Review', kinds: ['ui-review'], capability: 'ui-review@1' });
export const ENTRY = ['review.mjs'];
const OPEN = (s) => s !== 'approved';

/** One ui-review-item@1 → a classifier row, or null. */
export function rowOf(it) {
  if (!it || typeof it !== 'object' || !it.id || String(it.id).startsWith('pack:')) return null;
  if (!OPEN(String(it.status ?? '')) || it.landed) return null;
  const pr = Number(String(it.pr ?? '').replace(/^#/, '')) || 0;
  const branch = String(it.branch ?? ''); const build = String(it.build ?? '');
  if (!pr && !branch && !build) return null;
  return { kind: 'ui-review', id: String(it.id), build, pr, branch, status: String(it.status ?? ''), title: String(it.name ?? it.title ?? '') };
}
export const rowsFrom = (items) => (Array.isArray(items) ? items : []).map(rowOf).filter(Boolean);

/** The provider's review module (loadDoc, saveDoc, dataDir), or null. */
export async function reviewModule() {
  const p = providerOf(TABLE.capability);
  const f = entryOf(p, ENTRY);
  if (!f) return null;
  if (p.dataDir && !process.env.AXF_UI_REVIEW_DIR) process.env.AXF_UI_REVIEW_DIR = p.dataDir;
  return { provider: p, mod: await import(pathToFileURL(f).href) };
}

/** Read the items. `items` overrides the read (tests). */
export async function read({ items } = {}) {
  let list = items; let provider = '';
  if (!list) {
    const r = await reviewModule();
    if (!r) return { table: TABLE.id, rows: [], wantPrs: [], available: false, why: 'no plugin provides service:ui-review@1' };
    provider = r.provider.id;
    list = r.mod.loadDoc().items;
  }
  const rows = rowsFrom(list);
  return { table: TABLE.id, rows, wantPrs: rows.map((r) => r.pr).filter(Boolean), available: true, provider };
}
