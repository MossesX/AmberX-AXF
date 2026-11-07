/**
 * Glossary & Index — pure model (no React, no DOM): filter, rank, sort, the A–Z glossary letters and the index tree.
 * The catalog (glossary-catalog@1) is built on the server by catalog.mjs; this file only shapes it for the views.
 */

export interface ApiRef { kind: 'rest' | 'mcp' | 'cli'; name: string; route?: string }
export interface Entry {
  id: string;
  term: string;
  kind: string;
  category: string;
  summary: string;
  detail?: string;
  source?: string;
  plugin?: string;
  app?: string;
  where?: string[];
  api?: ApiRef[];
  related?: string[];
  children?: string[];
  keywords: string[];
  draft?: boolean;
  generic?: boolean;
  linkedFrom?: string[];
}
export interface Catalog { $axf: string; generatedAt: string; hash: string; kinds: Record<string, string>; counts: Record<string, number>; total: number; generic: number; entries: Entry[] }

export type View = 'glossary' | 'index' | 'grid';
export type SortBy = 'az' | 'za' | 'kind' | 'category';
export const VIEWS: { value: View; label: string; icon: string }[] = [
  { value: 'glossary', label: 'Glossary', icon: 'type' },
  { value: 'index', label: 'Index', icon: 'list' },
  { value: 'grid', label: 'Grid', icon: 'grid' },
];
export const SORTS: { value: SortBy; label: string }[] = [
  { value: 'az', label: 'A to Z' },
  { value: 'za', label: 'Z to A' },
  { value: 'kind', label: 'By kind' },
  { value: 'category', label: 'By category' },
];
/** Settings keys (lib-settings; values are strings / booleans). */
export const KEYS = { view: 'glossary.view', sort: 'glossary.sort', kind: 'glossary.kind', drafts: 'glossary.showDrafts', limit: 'glossary.pageSize' } as const;
export const PAGE_SIZES = [100, 250, 500, 1000];

export interface Filter { q: string; kind: string; drafts: boolean; undescribed?: boolean }

/** Every word must appear somewhere (term, summary, keywords, category, id); the score puts exact and leading term hits first. */
export function score(e: Entry, words: string[]): number {
  if (!words.length) return 1;
  const term = e.term.toLowerCase();
  const hay = `${term} ${e.summary.toLowerCase()} ${e.keywords.join(' ')} ${e.category.toLowerCase()} ${e.id}`;
  let s = 0;
  for (const w of words) {
    if (!hay.includes(w)) return 0;
    s += term === w ? 50 : term.startsWith(w) ? 20 : term.includes(w) ? 10 : e.keywords.includes(w) ? 4 : 1;
  }
  return s + (e.kind === 'concept' ? 5 : e.kind === 'plugin' ? 3 : 0);
}

export function filterEntries(entries: Entry[], f: Filter): Entry[] {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out: [number, Entry][] = [];
  for (const e of entries) {
    if (f.kind && e.kind !== f.kind) continue;
    if (!f.drafts && e.draft) continue;
    if (f.undescribed && !e.generic) continue;
    const s = score(e, words);
    if (s > 0) out.push([s, e]);
  }
  if (words.length) out.sort((a, b) => b[0] - a[0] || a[1].term.localeCompare(b[1].term));
  return out.map((x) => x[1]);
}

const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
export function sortEntries(entries: Entry[], by: SortBy, kinds: Record<string, string>): Entry[] {
  const order = Object.keys(kinds);
  const list = [...entries];
  if (by === 'az') list.sort((a, b) => cmp(a.term, b.term));
  else if (by === 'za') list.sort((a, b) => cmp(b.term, a.term));
  else if (by === 'kind') list.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || cmp(a.term, b.term));
  else list.sort((a, b) => cmp(a.category, b.category) || cmp(a.term, b.term));
  return list;
}

/** The glossary's letter for a term: A–Z, or # for anything starting with a digit or symbol. */
export function letterOf(term: string): string {
  const c = term.replace(/^[^A-Za-z0-9]+/, '').charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

export function byLetter(entries: Entry[]): { letter: string; entries: Entry[] }[] {
  const m = new Map<string, Entry[]>();
  for (const e of entries) {
    const l = letterOf(e.term);
    if (!m.has(l)) m.set(l, []);
    m.get(l)!.push(e);
  }
  return [...m.entries()].sort((a, b) => (a[0] === '#' ? 1 : b[0] === '#' ? -1 : a[0].localeCompare(b[0]))).map(([letter, list]) => ({ letter, entries: list }));
}

export interface IndexNode { key: string; label: string; count: number; children: IndexNode[]; entries: Entry[] }

/** The book-style index: categories split on "›" into a tree, entries at the leaves, counts summed up the tree. */
export function indexTree(entries: Entry[]): IndexNode[] {
  const root: IndexNode = { key: '', label: '', count: 0, children: [], entries: [] };
  for (const e of entries) {
    let node = root;
    const parts = e.category.split('›').map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      const key = node.key ? `${node.key}›${p}` : p;
      let child = node.children.find((c) => c.key === key);
      if (!child) { child = { key, label: p, count: 0, children: [], entries: [] }; node.children.push(child); }
      node = child;
    }
    node.entries.push(e);
  }
  const finish = (n: IndexNode): number => {
    n.children.sort((a, b) => cmp(a.label, b.label));
    n.entries.sort((a, b) => cmp(a.term, b.term));
    n.count = n.entries.length + n.children.reduce((s, c) => s + finish(c), 0);
    return n.count;
  };
  finish(root);
  return root.children;
}

/** Group entries by kind for the grid, in the catalog's kind order. */
export function byKind(entries: Entry[], kinds: Record<string, string>): { kind: string; label: string; entries: Entry[] }[] {
  const m = new Map<string, Entry[]>();
  for (const e of entries) { if (!m.has(e.kind)) m.set(e.kind, []); m.get(e.kind)!.push(e); }
  const order = Object.keys(kinds);
  return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([kind, list]) => ({ kind, label: kinds[kind] ?? kind, entries: list }));
}

/** The pieces of an API reference shown on an entry, grouped REST / MCP / CLI. */
export function apiGroups(api: ApiRef[] | undefined): { kind: string; label: string; names: string[] }[] {
  const labels: Record<string, string> = { rest: 'REST', mcp: 'MCP tool', cli: 'Command line' };
  const out: { kind: string; label: string; names: string[] }[] = [];
  for (const k of ['rest', 'mcp', 'cli']) {
    const names = (api ?? []).filter((a) => a.kind === k).map((a) => a.name);
    if (names.length) out.push({ kind: k, label: labels[k] ?? k, names });
  }
  return out;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
