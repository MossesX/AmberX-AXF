/**
 * Plan Studio 2.0 page layouts (pure, no DOM): how the page's sections (Tree, Editor, Say, Trash) are laid out.
 *
 *   nav   – every section on one page, a nav menu of section links to jump between them (the default)
 *   tabs  – one framework TabGroup across the top, one section at a time
 *   dock  – IDE style: dockable panes, each with its own tab group; drag tabs between panes, drop into another tab
 *           group, split a pane on its edges, resize, close and reopen
 *
 * IDE arrangements start from a dock-layout@1 asset (the
 * framework's ten starters in framework/assets/dock-layout and any an app registers later), so new pane arrangements
 * are assets, not code. The registry is open (registerLayout). The dock state is plain JSON saved per user in the
 * console settings (plan-studio-2.dock), the layout pick in plan-studio-2.pageLayout; the plan-studio-2.layout /
 * plan-studio-2.dock actions read and write the same values (REST, MCP, CLI, voice).
 *
 * Dock tree: { kind: 'leaf', pane: '<pane id>' } | { kind: 'split', vertical, children: [tree…], weights: [n…] }
 * (`vertical` = children stacked top to bottom, as in dock-layout@1). Dock state: { tree, panes: { <id>: { tabs:
 * [section ids], active } }, closed: [section ids] }. Collapse all / Expand all live on the tree itself (tree-core).
 */

/** @typedef {{ id: string, label: string, icon: string, kind: 'nav' | 'tabs' | 'dock', preset?: string, hint?: string }} StudioLayout */

/** The page's sections, in nav order. Open list: a section added later only needs an entry here and a renderer. */
export const SECTIONS = [
  { id: 'tree', label: 'Tree', icon: 'branch' },
  { id: 'editor', label: 'Editor', icon: 'edit' },
  { id: 'say', label: 'Say', icon: 'mic' },
  { id: 'trash', label: 'Trash', icon: 'trash' },
];
export const SECTION_IDS = SECTIONS.map((s) => s.id);

/** @type {StudioLayout[]} */
const LAYOUTS = [
  { id: 'nav', label: 'Nav menu', icon: 'menu', kind: 'nav', hint: 'Every section on one page, with a nav menu of section links' },
  { id: 'tabs', label: 'Tabs', icon: 'list', kind: 'tabs', hint: 'A tab group across the top, one section at a time' },
  { id: 'ide', label: 'IDE', icon: 'layout', kind: 'dock', preset: 'ide', hint: 'Dockable panes, each with its own tabs: drag, split, resize, close' },
];

export const DEFAULT_LAYOUT = 'nav';
export const MIN_WEIGHT = 0.1;
export const PANE_LIMIT = 6;

export function layouts() { return LAYOUTS.slice(); }
/** Add (or replace) a layout. Returns a remover. */
export function registerLayout(l) {
  if (!l || typeof l.id !== 'string' || !['nav', 'tabs', 'dock'].includes(l.kind)) throw new Error('A layout needs an id and a kind (nav, tabs, dock).');
  const i = LAYOUTS.findIndex((x) => x.id === l.id);
  if (i >= 0) LAYOUTS[i] = { ...l }; else LAYOUTS.push({ ...l });
  return () => { const j = LAYOUTS.findIndex((x) => x.id === l.id); if (j >= 0) LAYOUTS.splice(j, 1); };
}
/** A layout by id, or by words ("ide", "tab group", "nav menu", "panes"); empty = the default; unknown = null. */
export function resolveLayout(q) {
  const t = String(q ?? '').trim().toLowerCase();
  if (!t) return LAYOUTS.find((l) => l.id === DEFAULT_LAYOUT);
  return LAYOUTS.find((l) => l.id === t)
    ?? LAYOUTS.find((l) => l.label.toLowerCase() === t)
    ?? (/(ide|dock|pane|split)/.test(t) ? LAYOUTS.find((l) => l.kind === 'dock') : /tab/.test(t) ? LAYOUTS.find((l) => l.kind === 'tabs') : /(nav|menu|stack|page)/.test(t) ? LAYOUTS.find((l) => l.kind === 'nav') : undefined)
    ?? null;
}
/** A section by id or label ("editor", "Trash"). */
export function resolveSection(q) {
  const t = String(q ?? '').trim().toLowerCase();
  return SECTIONS.find((s) => s.id === t || s.label.toLowerCase() === t)?.id ?? null;
}

/* ---------------------------------------------------------------- dock tree */

const paneIds = (tree) => (!tree ? [] : tree.kind === 'leaf' ? [tree.pane] : tree.children.flatMap(paneIds));
export { paneIds };

function clampWeights(w, n) {
  const ws = Array.from({ length: n }, (_, i) => (Number.isFinite(w?.[i]) && w[i] > 0 ? w[i] : 1));
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  const norm = ws.map((x) => Math.max(MIN_WEIGHT, x / sum));
  const s2 = norm.reduce((a, b) => a + b, 0);
  return norm.map((x) => x / s2);
}

/** Drop empty splits, fold one-child splits, keep weights sane. */
export function normalizeTree(tree, keep = () => true) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.kind === 'leaf') return typeof tree.pane === 'string' && keep(tree.pane) ? { kind: 'leaf', pane: tree.pane } : null;
  if (tree.kind !== 'split' || !Array.isArray(tree.children)) return null;
  const kids = []; const ws = [];
  tree.children.forEach((c, i) => { const n = normalizeTree(c, keep); if (n) { kids.push(n); ws.push(tree.weights?.[i] ?? 1); } });
  if (!kids.length) return null;
  if (kids.length === 1) return kids[0];
  return { kind: 'split', vertical: !!tree.vertical, children: kids, weights: clampWeights(ws, kids.length) };
}

/** Turn a dock-layout@1 preset tree (numbered panes) into a dock, spreading the sections over its panes in order. */
export function fromPreset(preset, sections) {
  const n = Math.max(1, Math.min(PANE_LIMIT, Number(preset?.panes) || 1, sections.length || 1));
  const conv = (t) => (!t ? null : t.kind === 'leaf' ? (t.pane <= n ? { kind: 'leaf', pane: `p${t.pane}` } : null) : { kind: 'split', vertical: !!t.vertical, children: (t.children ?? []).map(conv), weights: t.weights ?? [] });
  const panes = {};
  for (let i = 1; i <= n; i++) panes[`p${i}`] = { tabs: [], active: '' };
  const main = Math.min(n, Math.max(1, Number(preset?.main) || 1));
  // the main pane gets the first (and biggest) share; the rest one or two each
  const per = Math.max(1, Math.floor(sections.length / n));
  let k = 0;
  const order = [main, ...Array.from({ length: n }, (_, i) => i + 1).filter((x) => x !== main)];
  order.forEach((p, i) => {
    const take = i === 0 ? sections.length - per * (n - 1) : per;
    panes[`p${p}`].tabs = sections.slice(k, k + take); k += take;
  });
  const tree = normalizeTree(conv(preset?.tree ?? { kind: 'leaf', pane: 1 }));
  return normalizeDock({ tree: tree ?? { kind: 'leaf', pane: 'p1' }, panes, closed: [] }, sections);
}

/** Every section exactly once (in a pane or closed), no empty panes, a valid active tab per pane. */
export function normalizeDock(dock, sections) {
  const known = new Set(sections);
  const seen = new Set();
  const panes = {};
  for (const [id, p] of Object.entries(dock?.panes ?? {})) {
    const tabs = (Array.isArray(p?.tabs) ? p.tabs : []).filter((t) => known.has(t) && !seen.has(t) && seen.add(t));
    if (tabs.length) panes[id] = { tabs, active: tabs.includes(p.active) ? p.active : tabs[0] };
  }
  const closed = (Array.isArray(dock?.closed) ? dock.closed : []).filter((t) => known.has(t) && !seen.has(t) && seen.add(t));
  let tree = normalizeTree(dock?.tree, (id) => !!panes[id]);
  // panes the tree lost: add them on the right
  for (const id of Object.keys(panes)) if (!paneIds(tree).includes(id)) tree = tree ? { kind: 'split', vertical: false, children: [tree, { kind: 'leaf', pane: id }], weights: [0.7, 0.3] } : { kind: 'leaf', pane: id };
  // sections nobody has (a new section, a lost one): into the first pane
  const missing = sections.filter((s) => !seen.has(s));
  if (missing.length) {
    const first = paneIds(tree)[0];
    if (first) panes[first] = { ...panes[first], tabs: [...panes[first].tabs, ...missing] };
    else { panes.p1 = { tabs: missing, active: missing[0] }; tree = { kind: 'leaf', pane: 'p1' }; }
  }
  return { tree: normalizeTree(tree, (id) => !!panes[id]), panes, closed };
}

const nextPaneId = (dock) => { let i = 1; while (dock.panes[`p${i}`]) i++; return `p${i}`; };
const paneOf = (dock, tab) => Object.keys(dock.panes).find((id) => dock.panes[id].tabs.includes(tab)) ?? null;
export { paneOf };

function replaceLeaf(tree, pane, fn) {
  if (!tree) return tree;
  if (tree.kind === 'leaf') return tree.pane === pane ? fn(tree) : tree;
  return { ...tree, children: tree.children.map((c) => replaceLeaf(c, pane, fn)) };
}
function withoutTab(dock, tab) {
  const panes = {};
  for (const [id, p] of Object.entries(dock.panes)) {
    const tabs = p.tabs.filter((t) => t !== tab);
    panes[id] = { tabs, active: p.active === tab ? (tabs[Math.max(0, p.tabs.indexOf(tab) - 1)] ?? tabs[0] ?? '') : p.active };
  }
  return { ...dock, panes, closed: dock.closed.filter((t) => t !== tab) };
}

/** Show one tab in its pane. */
export function activate(dock, tab, sections) {
  const p = paneOf(dock, tab);
  if (!p) return reopen(dock, tab, sections);
  return { ...dock, panes: { ...dock.panes, [p]: { ...dock.panes[p], active: tab } } };
}

/** Move a tab into a pane's tab group at an index (end when absent). */
export function moveTab(dock, tab, toPane, index, sections) {
  if (!dock.panes[toPane]) return dock;
  const d = withoutTab(dock, tab);
  const tabs = d.panes[toPane].tabs.slice();
  const at = Number.isInteger(index) ? Math.max(0, Math.min(tabs.length, index)) : tabs.length;
  tabs.splice(at, 0, tab);
  d.panes[toPane] = { tabs, active: tab };
  return normalizeDock(d, sections);
}

/** Reorder one pane's tabs. */
export function reorder(dock, pane, order, sections) {
  const p = dock.panes[pane];
  if (!p) return dock;
  const tabs = order.filter((t) => p.tabs.includes(t));
  for (const t of p.tabs) if (!tabs.includes(t)) tabs.push(t);
  return normalizeDock({ ...dock, panes: { ...dock.panes, [pane]: { ...p, tabs } } }, sections);
}

/** Split a pane on one side and put a tab there (dropping a tab on a pane edge). */
export function splitWith(dock, tab, pane, side, sections) {
  if (!dock.panes[pane] || !['left', 'right', 'top', 'bottom'].includes(side)) return dock;
  if (Object.keys(dock.panes).length >= PANE_LIMIT) return moveTab(dock, tab, pane, undefined, sections);
  const src = paneOf(dock, tab);
  if (src === pane && dock.panes[pane].tabs.length < 2) return dock; // splitting a pane with its only tab: nothing moves
  const d = withoutTab(dock, tab);
  const id = nextPaneId(d);
  d.panes[id] = { tabs: [tab], active: tab };
  const vertical = side === 'top' || side === 'bottom';
  const before = side === 'left' || side === 'top';
  d.tree = replaceLeaf(d.tree, pane, (leaf) => ({ kind: 'split', vertical, children: before ? [{ kind: 'leaf', pane: id }, leaf] : [leaf, { kind: 'leaf', pane: id }], weights: [0.5, 0.5] }));
  return normalizeDock(d, sections);
}

/** Close a pane: its tabs go to the closed list (reopen them from the toolbar). Never closes the last pane. */
export function closePane(dock, pane, sections) {
  if (!dock.panes[pane] || Object.keys(dock.panes).length < 2) return dock;
  const gone = dock.panes[pane].tabs;
  const panes = { ...dock.panes }; delete panes[pane];
  return normalizeDock({ ...dock, panes, closed: [...dock.closed, ...gone] }, sections);
}

/** Close one tab (to the closed list). The last open tab stays. */
export function closeTab(dock, tab, sections) {
  const open = Object.values(dock.panes).reduce((n, p) => n + p.tabs.length, 0);
  if (open < 2 || !paneOf(dock, tab)) return dock;
  const d = withoutTab(dock, tab);
  return normalizeDock({ ...d, closed: [...d.closed, tab] }, sections);
}

/** Reopen a closed section: in a new pane on the right (or the last pane when the limit is reached). */
export function reopen(dock, tab, sections) {
  if (!dock.closed.includes(tab)) return dock;
  const d = { ...dock, closed: dock.closed.filter((t) => t !== tab) };
  const ids = paneIds(d.tree);
  if (ids.length >= PANE_LIMIT || !d.tree) {
    const last = ids[ids.length - 1];
    if (!last) return normalizeDock({ tree: { kind: 'leaf', pane: 'p1' }, panes: { p1: { tabs: [tab], active: tab } }, closed: d.closed }, sections);
    return moveTab({ ...d, panes: { ...d.panes } }, tab, last, undefined, sections);
  }
  const id = nextPaneId(d);
  return normalizeDock({ ...d, panes: { ...d.panes, [id]: { tabs: [tab], active: tab } }, tree: { kind: 'split', vertical: false, children: [d.tree, { kind: 'leaf', pane: id }], weights: [0.7, 0.3] } }, sections);
}

/** Move the weight between child `index` and `index + 1` of the split at `path` by `delta` (a fraction of the split). */
export function resize(dock, path, index, delta) {
  const walk = (t, depth) => {
    if (!t || t.kind !== 'split') return t;
    if (depth === path.length) {
      const w = t.weights.slice();
      if (index < 0 || index + 1 >= w.length) return t;
      const pair = w[index] + w[index + 1];
      const a = Math.max(MIN_WEIGHT, Math.min(pair - MIN_WEIGHT, w[index] + delta));
      w[index] = a; w[index + 1] = pair - a;
      return { ...t, weights: w };
    }
    return { ...t, children: t.children.map((c, i) => (i === path[depth] ? walk(c, depth + 1) : c)) };
  };
  return { ...dock, tree: walk(dock.tree, 0) };
}

/** Which drop zone a point is in, as fractions of the pane (x, y in 0..1); `inHeader` = over the pane's tab row. */
export function dropZone(x, y, inHeader, edge = 0.22) {
  if (inHeader) return 'header';
  const d = { left: x, right: 1 - x, top: y, bottom: 1 - y };
  const [side, dist] = Object.entries(d).sort((a, b) => a[1] - b[1])[0];
  return dist < edge ? side : 'centre';
}

/** Apply a drop: header / centre join the pane's tab group, an edge splits the pane. */
export function applyDrop(dock, tab, pane, zone, sections, index) {
  if (zone === 'header' || zone === 'centre') return paneOf(dock, tab) === pane && zone === 'header' ? dock : moveTab(dock, tab, pane, index, sections);
  return splitWith(dock, tab, pane, zone, sections);
}

/** The two-pane fallback when no dock-layout asset is registered: tree on the left, the rest on the right. */
export const FALLBACK_PRESET = { panes: 2, main: 1, tree: { kind: 'split', vertical: false, children: [{ kind: 'leaf', pane: 1 }, { kind: 'leaf', pane: 2 }], weights: [3, 2] } };

/**
 * One dock op by name, as the plan-studio-2.dock action and the CLI take it: move:<section>:<pane>[:<index>],
 * split:<section>:<pane>:<side>, close-pane:<pane>, close:<section>, reopen:<section>, show:<section>,
 * reorder:<pane>:<a,b,c>. Returns the new dock, or throws with the list of ops.
 */
export function runDockOp(dock, op, args, sections) {
  const [a = '', b = '', c = ''] = args;
  const sec = (x) => resolveSection(x) ?? x;
  switch (op) {
    case 'move': return moveTab(dock, sec(a), b, c === '' ? undefined : Number(c), sections);
    case 'split': return splitWith(dock, sec(a), b, c, sections);
    case 'close-pane': return closePane(dock, a, sections);
    case 'close': return closeTab(dock, sec(a), sections);
    case 'reopen': return reopen(dock, sec(a), sections);
    case 'show': return activate(dock, sec(a), sections);
    case 'reorder': return reorder(dock, a, b.split(',').map(sec), sections);
    default: throw new Error('Dock ops: move:<section>:<pane>[:<index>], split:<section>:<pane>:<left|right|top|bottom>, close-pane:<pane>, close:<section>, reopen:<section>, show:<section>, reorder:<pane>:<a,b,c>, reset.');
  }
}
