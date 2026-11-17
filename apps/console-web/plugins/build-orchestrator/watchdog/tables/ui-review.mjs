/**
 * Watchdog table: UI Review items (stale-row@1 kind ui-review), from the plugin that provides service:ui-review@1
 * (its review.mjs: `review.mjs list`). Every open review item (not approved, not already closed as landed) that names a
 * PR, branch or build is one row { kind: <the UI Review row kind>, id: <item id>, build, pr, branch, status }. Design-pack decisions
 * (pack:*) and items that name nothing to check are no rows.
 *
 * read() → { table, rows, wantPrs, available }.
 */
import { pathToFileURL } from 'node:url';
import { entryOf, providerOf } from '../providers.mjs';

export const TABLE = Object.freeze({ id: 'ui-review', label: 'UI Review', kinds: ['ui-review'], capability: 'ui-review@1' });  // axf-not-plugin:ui-review (the stale-row@1 row kind)
export const ENTRY = ['review.mjs'];
const OPEN = (s) => s !== 'approved';

/** One ui-review-item@1 → a classifier row, or null. */
export function rowOf(it) {
  if (!it || typeof it !== 'object' || !it.id || String(it.id).startsWith('pack:')) return null;
  if (!OPEN(String(it.status ?? '')) || it.landed) return null;
  const pr = Number(String(it.pr ?? '').replace(/^#/, '')) || 0;
  const branch = String(it.branch ?? ''); const build = String(it.build ?? '');
  if (!pr && !branch && !build) return null;
  return { kind: 'ui-review', id: String(it.id), build, pr, branch, status: String(it.status ?? ''), title: String(it.name ?? it.title ?? '') };  // axf-not-plugin:ui-review (the stale-row@1 row kind)
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

/**
 * Apply verdicts: close each item as landed (complete) or removed (remove) through the provider's closeLanded (status
 * kept, never approved). A `complete` whose PR is still open is skipped: an open PR's review is Brett's call.
 * Returns each verdict with { applied, why }.
 */
export async function apply(verdicts, { by = 'watchdog', closeLanded } = {}) {
  let close = closeLanded;
  if (!close) { const r = await reviewModule(); if (!r?.mod?.closeLanded) return verdicts.map((v) => ({ ...v, applied: false, why: 'no UI Review provider with closeLanded' })); close = r.mod.closeLanded; }
  const out = [];
  for (const v of verdicts) {
    if (v.action === 'complete' && v.prState === 'open') { out.push({ ...v, applied: false, why: 'its PR is still open' }); continue; }
    const r = close([v.row.id], { how: v.action === 'complete' ? 'landed' : 'removed', pr: v.row.pr, by, why: v.line });
    out.push({ ...v, applied: r.changed.length > 0, why: r.changed.length ? '' : 'already closed or gone' });
  }
  return out;
}
