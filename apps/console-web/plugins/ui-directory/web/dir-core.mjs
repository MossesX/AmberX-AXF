/**
 * The UI Directory page's pure logic (no React): the page state's shape, what the filters keep, and how action args
 * become filters. Shared by the page (page.tsx), its actions (index.tsx) and the self-test (test.mjs).
 */
import * as ud from '../../../../../framework/core/ui-directory.mjs';

export const FILTER_KEYS = ['q', 'app', 'kind', 'status', 'family'];
export const EMPTY = Object.freeze({ q: '', app: '', kind: '', status: '', family: '', open: [], all: false });

export const filtering = (f) => FILTER_KEYS.some((k) => !!f[k]);
const pick = (f) => ({ q: f.q, app: f.app, kind: f.kind, status: f.status, family: f.family });

/** The rows the filters keep. */
export const matches = (rows, f) => (filtering(f) ? ud.filterRows(rows, pick(f)) : rows);

/** The rows the filters keep, plus the app and plugin rows that name their groups in the tree. */
export function visibleRows(rows, f) {
  if (!filtering(f)) return rows;
  const hit = matches(rows, f);
  const keep = new Set(hit.map((r) => r.id));
  const groups = new Set(hit.map((r) => `${r.app}/${r.plugin}`));
  const apps = new Set(hit.map((r) => r.app));
  for (const r of rows) {
    if (r.kind === 'app' && apps.has(r.app)) keep.add(r.id);
    if (r.kind === 'plugin' && groups.has(`${r.app}/${r.plugin}`)) keep.add(r.id);
  }
  return rows.filter((r) => keep.has(r.id));
}

/** Action args → page filters: `key=value` sets a filter, bare words are the search; filters left out are cleared. */
export function filtersFromArgs(args) {
  const out = { q: '', app: '', kind: '', status: '', family: '' };
  const words = [];
  const parts = (Array.isArray(args) ? args : [args]).flatMap((a) => { let s = String(a ?? ''); try { s = decodeURIComponent(s); } catch { /* keep as is */ } return s.split(/\s+(?=\w+=)/); });
  for (const raw of parts) {
    const p = raw.trim();
    const m = /^(q|app|kind|status|family)=(.*)$/.exec(p);
    if (m) { if (m[1] === 'q') words.push(m[2].trim()); else out[m[1]] = m[2].trim(); }
    else if (p) words.push(p);
  }
  out.q = words.filter(Boolean).join(' ');
  return out;
}

/** The ids of every node that has children (what "expand all" opens). */
export function groupIds(nodes, out = []) {
  for (const n of nodes) if (n.children.length) { out.push(n.id); groupIds(n.children, out); }
  return out;
}

/** How many rows sit under a node. */
export const countUnder = (n) => n.children.reduce((s, c) => s + 1 + countUnder(c), 0);
