/**
 * Search, sort and multi-filter for the UI Manager's lists (thousands of elements, and the properties of one).
 * Pure: no Node or DOM imports, so the floating window (web/), the CLI, the REST routes and the MCP tools all run
 * this one function and answer the same way. Filters combine with AND across kinds and with OR inside one kind.
 */
import { CATEGORIES, elementTree, filterElements } from '../../../../../framework/core/engines/ui-manager-rules.mjs';

export const SORT_KEYS = ['label', 'kind', 'category', 'plugin', 'overrides'];
export const QUERY_LIMIT_MAX = 5000;

const CAT_ORDER = new Map(CATEGORIES.map((c, i) => [c.id, i]));
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean);
const yes = (v) => v === true || v === 'true' || v === '1' || v === 1;

/** Normalised query: unknown sort keys fall back to label, lists accept arrays or comma strings. */
export function normalizeQuery(raw = {}) {
  const sort = SORT_KEYS.includes(raw.sort) ? raw.sort : 'label';
  return {
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    kinds: list(raw.kinds ?? raw.kind),
    categories: list(raw.categories ?? raw.category),
    plugins: list(raw.plugins ?? raw.plugin),
    overriddenOnly: yes(raw.overriddenOnly ?? raw.overridden),
    onScreenOnly: yes(raw.onScreenOnly ?? raw.onScreen),
    sort,
    desc: yes(raw.desc),
  };
}

const cmp = (key) => (a, b) => {
  if (key === 'overrides') return (a.overrides ?? 0) - (b.overrides ?? 0);
  if (key === 'category') return (CAT_ORDER.get(a.category) ?? 99) - (CAT_ORDER.get(b.category) ?? 99);
  return String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
};

/** Sort by one key, label as the tie-break, descending when asked (the tie-break stays ascending). */
export function sortElements(elements, sort = 'label', desc = false) {
  const by = cmp(SORT_KEYS.includes(sort) ? sort : 'label');
  const byLabel = cmp('label');
  return [...elements].sort((a, b) => (desc ? -by(a, b) : by(a, b)) || byLabel(a, b) || a.id.localeCompare(b.id));
}

/**
 * Filter and sort. `visible` is the ids on screen now (onScreenOnly keeps only those); elements carry `overrides`
 * (a count) for overriddenOnly and the overrides sort.
 */
export function queryElements(elements, raw = {}, visible = []) {
  const qy = normalizeQuery(raw);
  const vis = new Set(visible);
  let out = filterElements(elements, qy.q);
  if (qy.kinds.length) out = out.filter((e) => qy.kinds.includes(e.kind));
  if (qy.categories.length) out = out.filter((e) => qy.categories.includes(e.category));
  if (qy.plugins.length) out = out.filter((e) => qy.plugins.includes(e.plugin ?? ''));
  if (qy.overriddenOnly) out = out.filter((e) => (e.overrides ?? 0) > 0);
  if (qy.onScreenOnly) out = out.filter((e) => vis.has(e.id));
  return sortElements(out, qy.sort, qy.desc);
}

/** The tree of a query: the same categories, each in the query's order (elementTree sorts by label; this re-sorts). */
export function queryTree(elements, raw = {}, visible = []) {
  const qy = normalizeQuery(raw);
  const hits = queryElements(elements, qy, visible);
  const rank = new Map(hits.map((e, i) => [e.id, i]));
  return elementTree(hits, visible).map((c) => ({ ...c, items: [...c.items].sort((a, b) => (rank.get(a.ref ?? a.id) ?? 0) - (rank.get(b.ref ?? b.id) ?? 0)) }));
}

/** Every filter value with its count, over the whole list (the chips show what each filter would keep). */
export function facets(elements) {
  const count = (key) => {
    const m = new Map();
    for (const e of elements) { const v = e[key] ?? ''; if (v) m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m].map(([value, n]) => ({ value, count: n })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };
  return { kinds: count('kind'), categories: count('category'), plugins: count('plugin'), overridden: elements.filter((e) => (e.overrides ?? 0) > 0).length };
}

/** The properties of one element: search over label, id, group, value and token; group filter; sort by label / group / changed. */
export const PROP_SORT_KEYS = ['group', 'label', 'changed'];
export function queryProps(rows, { q = '', groups = [], changedOnly = false, sort = 'group', desc = false } = {}) {
  const s = String(q).trim().toLowerCase();
  const gs = list(groups);
  let out = rows.filter((r) => (!gs.length || gs.includes(r.group)) && (!yes(changedOnly) || r.overridden)
    && (!s || [r.label, r.id, r.group, String(r.value), r.token ?? ''].some((x) => String(x).toLowerCase().includes(s))));
  if (sort !== 'group' || yes(desc)) {
    const by = sort === 'changed' ? (a, b) => Number(b.overridden) - Number(a.overridden) : sort === 'label' ? (a, b) => a.label.localeCompare(b.label) : () => 0;
    out = [...out].sort((a, b) => (yes(desc) ? -by(a, b) : by(a, b)) || 0);
  }
  return out;
}

/** One page of a long list. */
export function page(items, { limit = 0, offset = 0 } = {}) {
  const n = Math.max(0, Math.min(Number(limit) || QUERY_LIMIT_MAX, QUERY_LIMIT_MAX));
  const o = Math.max(0, Number(offset) || 0);
  return { items: items.slice(o, o + n), total: items.length, offset: o, limit: n };
}
