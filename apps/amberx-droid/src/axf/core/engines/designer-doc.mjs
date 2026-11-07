/**
 * designer-doc@1 — the document every designer edits (designer@1, Brett Nov 7 2026: "Make it super powerful: full-blown
 * context menu, drag and drop, map-based."). One model for every add-on, so the host gives each of them the same
 * tree, canvas, selection, undo / redo, drag-and-drop and context menu, and an add-on only says which node kinds its
 * asset type has and how they read and write (the six families below ship here; an add-on for another type registers
 * its own family with `registerFamily`).
 *
 *   document   { $axf, type, id, name, addon, root, nodes: { id: { id, kind, parent, children, props, locked?, hidden? } },
 *                data (the asset's root-level fields), canvas: { nodeId: { x, y, w, h } }, selection: [ids], meta: { nextId, revision } }
 *   families   toolbar (root → group → item; widgets), banner (root → attachment), nav (root → section → item → item),
 *              appmenu (root → menu → item | separator → …), ctxmenu (root → target → item | separator → …), flat
 *              (widgets, the embed, every other type: the data alone). ACCEPTS says which children a kind takes;
 *              NODE_PROPS what the inspector edits and the validator requires.
 *   round trip docFromAsset(asset) → document; assetFromDoc(doc, base) → an asset@1 whose data validates with the
 *              shared validators (fixture: every starter of the six types survives the round trip unchanged).
 *   ops        addNode, removeNodes, moveNodes, setProps, setData, duplicate, group, ungroup, lock, hide, rename —
 *              pure: each returns a new document and never mutates the old one.
 *   selection  select (add / toggle / range), selectAll, selectKind, clearSelection, selectionBounds; multi-select
 *              everywhere (every op takes a list of ids).
 *   canvas     map-based layout: snapTo, place, nudge, align, distribute, autoLayout (a flow grid for a document that
 *              has no positions yet), zoomSteps, zoomFit, forward / backward (z = order among siblings).
 *   drops      parseDrop (the designer MIME, plain text, URLs, grid-hook@1 hooks, asset refs) → canDrop → applyDrop:
 *              move a node, add a palette node, turn an action / hook / text / asset / embed into the right node.
 *   history    createHistory, commit (coalesces quick edits of one label), undo, redo, canUndo, canRedo.
 *   menu       designerContextMenu: the right-click menu of a node or the canvas (edit, insert, arrange, clipboard,
 *              select, preview, help), every entry an action id Amber can run by voice; DESIGNER_KEYS = the shortcuts.
 *
 * Pure (no IO, no DOM, no clock: `at` is passed in). Kotlin twin deferred (Android on hold, spec/PORTING.md);
 * fixture spec/fixtures/designer.json (spec/check-designer.mjs).
 */
import { DESIGNER_DROP_MIME, DESIGNER_WIDGET_TYPES, EMBED_TYPE, assetTypeLabel, normalizeDesigner, parseAssetRef, slug } from './designer-rules.mjs';

export const DESIGNER_DOC_FRAME = 'designer-doc@1';
export const ROOT = 'root';
export const DOC_LIMITS = { nodes: 2000, depth: 6, label: 160, text: 400, selection: 500 };

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const uniq = (a) => [...new Set(a)];

/* ================================================================== families: node kinds per asset type */

const prop = (key, label, kind, extra = {}) => ({ key, label, kind, ...extra });
const MENU_ITEM_PROPS = [
  prop('id', 'Id', 'text', { required: true }), prop('label', 'Label', 'text'), prop('icon', 'Icon', 'icon'), prop('action', 'Action', 'action'), prop('shortcut', 'Shortcut', 'shortcut'),
  prop('requires', 'Needs permission', 'text'), prop('provider', 'Live list', 'text'), prop('badge', 'Badge counter', 'binding'), prop('checked', 'Check mark', 'binding'),
  prop('order', 'Order', 'number'), prop('before', 'Before', 'text'), prop('after', 'After', 'text'),
];
const SEPARATOR_PROPS = [prop('id', 'Id', 'text', { required: true }), prop('spacer', 'Gap instead of a rule', 'toggle')];

/**
 * One family = how a type's data becomes nodes and back. `structure` = the data keys the nodes stand for (everything
 * else is root `data`); `accepts` = child kinds per kind; `props` = the inspector fields per kind; `read` / `write`.
 */
const FAMILIES = new Map();
export function registerFamily(f) { FAMILIES.set(f.id, f); for (const t of f.types) TYPE_FAMILY.set(t, f.id); }
const TYPE_FAMILY = new Map();
export const familyOf = (type) => FAMILIES.get(TYPE_FAMILY.get(type) ?? 'flat');
export const familyIds = () => [...FAMILIES.keys()];

/* ---- toolbar: root → group → item; widgets on the root ---- */
registerFamily({
  id: 'toolbar', types: ['toolbar'], structure: ['groups', 'widgets'],
  accepts: { [ROOT]: ['group', 'widget'], group: ['item'], item: [], widget: [] },
  labels: { group: 'Group', item: 'Button', widget: 'Widget' },
  props: {
    group: [prop('id', 'Id', 'text', { required: true }), prop('label', 'Label', 'text'), prop('provider', 'Live list', 'text'), prop('max', 'Max live buttons', 'number', { min: 1, max: 24 })],
    item: [prop('id', 'Id', 'text', { required: true }), prop('icon', 'Icon', 'icon', { required: true }), prop('label', 'Label', 'text', { required: true }), prop('action', 'Action', 'action', { required: true }), prop('requires', 'Needs permission', 'text'), prop('badge', 'Badge counter', 'binding'), prop('checked', 'Pressed when', 'binding'), prop('embed', 'Embed asset', 'asset', { options: [EMBED_TYPE] })],
    widget: [prop('type', 'Widget type', 'choice', { required: true, options: [...DESIGNER_WIDGET_TYPES, EMBED_TYPE] }), prop('id', 'Asset id', 'text', { required: true }), prop('at', 'Side', 'choice', { required: true, options: ['start', 'end'] }), prop('order', 'Order', 'number')],
  },
  read(data, add) {
    for (const g of Array.isArray(data.groups) ? data.groups : []) {
      const gid = add(ROOT, 'group', { ...(isObj(g) ? g : {}), items: undefined });
      for (const it of Array.isArray(g?.items) ? g.items : []) add(gid, 'item', isObj(it) ? it : {});
    }
    for (const w of Array.isArray(data.widgets) ? data.widgets : []) add(ROOT, 'widget', isObj(w) ? w : {});
  },
  write(doc, kids, propsOf) {
    const groups = kids(ROOT).filter((n) => n.kind === 'group').map((g) => ({ ...propsOf(g), items: kids(g.id).filter((n) => n.kind === 'item').map(propsOf) }));
    const widgets = kids(ROOT).filter((n) => n.kind === 'widget').map(propsOf);
    return { groups, ...(widgets.length ? { widgets } : {}) };
  },
});
/* ---- banner: root → attachment ---- */
registerFamily({
  id: 'banner', types: ['banner'], structure: ['attach'],
  accepts: { [ROOT]: ['attach'], attach: [] },
  labels: { attach: 'Attachment' },
  props: { attach: [prop('type', 'Asset type', 'choice', { required: true, options: [...DESIGNER_WIDGET_TYPES, 'badge', EMBED_TYPE] }), prop('id', 'Asset id', 'text', { required: true }), prop('at', 'Side', 'choice', { required: true, options: ['left', 'center', 'right'] }), prop('order', 'Order', 'number')] },
  read(data, add) { for (const a of Array.isArray(data.attach) ? data.attach : []) add(ROOT, 'attach', isObj(a) ? a : {}); },
  write(doc, kids, propsOf) { return { attach: kids(ROOT).filter((n) => n.kind === 'attach').map(propsOf) }; },
});
/* ---- nav: root → section → item → item ---- */
const NAV_ITEM_PROPS = [prop('id', 'Id', 'text', { required: true }), prop('label', 'Label', 'text', { required: true }), prop('icon', 'Icon', 'icon', { required: true }), prop('view', 'Opens view', 'view', { required: true }), prop('badge', 'Badge counter', 'binding'), prop('requires', 'Needs permission', 'text')];
registerFamily({
  id: 'nav', types: ['nav-menu'], structure: ['sections'],
  accepts: { [ROOT]: ['section'], section: ['item'], item: ['item'] },
  labels: { section: 'Section', item: 'Item' },
  props: { section: [prop('label', 'Label', 'text')], item: NAV_ITEM_PROPS },
  read(data, add) {
    const items = (parent, list) => { for (const it of Array.isArray(list) ? list : []) { const id = add(parent, 'item', { ...(isObj(it) ? it : {}), items: undefined }); items(id, it?.items); } };
    for (const s of Array.isArray(data.sections) ? data.sections : []) { const sid = add(ROOT, 'section', { ...(isObj(s) ? s : {}), items: undefined }); items(sid, s?.items); }
  },
  write(doc, kids, propsOf) {
    const items = (id) => kids(id).filter((n) => n.kind === 'item').map((n) => { const sub = items(n.id); return { ...propsOf(n), ...(sub.length ? { items: sub } : {}) }; });
    return { sections: kids(ROOT).filter((n) => n.kind === 'section').map((s) => ({ ...propsOf(s), items: items(s.id) })) };
  },
});
/* ---- app menu: root → menu → item | separator → … ---- */
const readMenuItems = (add) => { const walk = (parent, list) => { for (const it of Array.isArray(list) ? list : []) { if (!isObj(it)) continue; if (it.separator) { add(parent, 'separator', { id: it.id, spacer: it.spacer, separator: undefined }); continue; } const id = add(parent, 'item', { ...it, items: undefined }); walk(id, it.items); } }; return walk; };
const writeMenuItems = (kids, propsOf) => { const walk = (id) => kids(id).filter((n) => n.kind === 'item' || n.kind === 'separator').map((n) => { if (n.kind === 'separator') return { id: n.props.id ?? n.id, separator: true, ...(n.props.spacer ? { spacer: true } : {}) }; const sub = walk(n.id); return { ...propsOf(n), ...(sub.length ? { items: sub } : {}) }; }); return walk; };
registerFamily({
  id: 'appmenu', types: ['app-menu'], structure: ['menus'],
  accepts: { [ROOT]: ['menu'], menu: ['item', 'separator'], item: ['item', 'separator'], separator: [] },
  labels: { menu: 'Menu', item: 'Item', separator: 'Separator' },
  props: { menu: [prop('id', 'Id', 'text', { required: true }), prop('label', 'Label', 'text', { required: true }), prop('order', 'Order', 'number')], item: MENU_ITEM_PROPS, separator: SEPARATOR_PROPS },
  read(data, add) { const walk = readMenuItems(add); for (const m of Array.isArray(data.menus) ? data.menus : []) { const mid = add(ROOT, 'menu', { ...(isObj(m) ? m : {}), items: undefined }); walk(mid, m?.items); } },
  write(doc, kids, propsOf) { const walk = writeMenuItems(kids, propsOf); return { menus: kids(ROOT).filter((n) => n.kind === 'menu').map((m) => ({ ...propsOf(m), items: walk(m.id) })) }; },
});
/* ---- context menu: root → target → item | separator → … ---- */
registerFamily({
  id: 'ctxmenu', types: ['context-menu'], structure: ['targets'],
  accepts: { [ROOT]: ['target'], target: ['item', 'separator'], item: ['item', 'separator'], separator: [] },
  labels: { target: 'Target', item: 'Item', separator: 'Separator' },
  props: { target: [prop('name', 'Target name', 'text', { required: true })], item: MENU_ITEM_PROPS, separator: SEPARATOR_PROPS },
  read(data, add) { const walk = readMenuItems(add); for (const [name, list] of Object.entries(isObj(data.targets) ? data.targets : {})) { const tid = add(ROOT, 'target', { name }); walk(tid, list); } },
  write(doc, kids, propsOf) { const walk = writeMenuItems(kids, propsOf); const targets = {}; for (const t of kids(ROOT).filter((n) => n.kind === 'target')) targets[t.props.name ?? t.id] = walk(t.id); if (!targets.default) targets.default = []; return { targets }; },
});
/* ---- flat: the data alone (widgets, the embed, every other type) ---- */
registerFamily({ id: 'flat', types: [], structure: [], accepts: { [ROOT]: [] }, labels: {}, props: {}, read() {}, write() { return {}; } });

/** The node kinds a type's document has (the root aside). */
export const nodeKinds = (type) => Object.keys(familyOf(type).accepts).filter((k) => k !== ROOT);
/** The child kinds a node kind takes in a type's document. */
export const acceptsKinds = (type, kind) => [...(familyOf(type).accepts[kind] ?? [])];
/** The inspector fields of a node kind. */
export const nodeProps = (type, kind) => [...(familyOf(type).props[kind] ?? [])];
export const nodeKindLabel = (type, kind) => familyOf(type).labels[kind] ?? (kind === ROOT ? assetTypeLabel(type) : kind);

/* ================================================================== the document */

const propsOf = (n) => Object.fromEntries(Object.entries(n.props).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** An empty document of a type. */
export function newDoc({ type, id = '', name = '', addon = '', data = {} } = {}) {
  return { $axf: DESIGNER_DOC_FRAME, type: str(type, 40), id: str(id, 48), name: str(name, DOC_LIMITS.label) || str(id, 48), addon: str(addon, 40), root: ROOT, nodes: { [ROOT]: { id: ROOT, kind: ROOT, parent: null, children: [], props: {} } }, data: clone(isObj(data) ? data : {}), canvas: {}, selection: [], meta: { nextId: 1, revision: 0 } };
}
/** An asset read into a document: the family's nodes plus every other data field as root `data`. */
export function docFromAsset(asset, addon = '') {
  if (!isObj(asset) || !isObj(asset.data)) throw new Error('docFromAsset: an asset with data is needed');
  const fam = familyOf(asset.type);
  const doc = newDoc({ type: asset.type, id: asset.id, name: asset.name, addon });
  for (const [k, v] of Object.entries(asset.data)) if (!fam.structure.includes(k)) doc.data[k] = clone(v);
  doc.meta.keyOrder = Object.keys(asset.data); // so a re-saved asset keeps its field order (small diffs in git)
  const add = (parent, kind, props) => { const id = `n${doc.meta.nextId++}`; doc.nodes[id] = { id, kind, parent, children: [], props: Object.fromEntries(Object.entries(props ?? {}).filter(([, v]) => v !== undefined)) }; doc.nodes[parent].children.push(id); return id; };
  fam.read(asset.data, add);
  if (isObj(asset.designed) && asset.designed.uid) doc.meta.uid = asset.designed.uid;
  return doc;
}
/** The document written back as an asset@1 (`base` = the asset it came from: envelope fields are kept). */
export function assetFromDoc(doc, base = {}) {
  const fam = familyOf(doc.type);
  const kids = (id) => (doc.nodes[id]?.children ?? []).map((c) => doc.nodes[c]).filter((n) => n && !n.hidden);
  const merged = { ...clone(doc.data), ...fam.write(doc, kids, propsOf) };
  const order = Array.isArray(doc.meta?.keyOrder) ? doc.meta.keyOrder : [];
  const data = Object.fromEntries([...order.filter((k) => k in merged), ...Object.keys(merged).filter((k) => !order.includes(k))].map((k) => [k, merged[k]]));
  const out = { $axf: 'asset@1', ...(isObj(base) ? clone(base) : {}), type: doc.type, id: doc.id, name: doc.name || doc.id, version: str(base?.version, 20) || '1.0.0', data };
  delete out.designed;
  return out;
}

/** What is wrong with a document; [] when nothing (structure, kinds, parents, required props, selection, canvas). */
export function docErrors(doc) {
  const e = [];
  if (!isObj(doc)) return ['not a document'];
  if (doc.$axf !== DESIGNER_DOC_FRAME) e.push(`$axf must be ${DESIGNER_DOC_FRAME}`);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(String(doc.type))) e.push('type: an asset type');
  if (doc.id !== '' && !/^[a-z0-9][a-z0-9-]{1,47}$/.test(String(doc.id))) e.push('id: an asset id (or empty while new)');
  if (!isObj(doc.nodes) || !doc.nodes[ROOT]) return [...e, 'nodes: a root node is needed'];
  const fam = familyOf(doc.type);
  const ids = Object.keys(doc.nodes);
  if (ids.length > DOC_LIMITS.nodes) e.push(`nodes: more than ${DOC_LIMITS.nodes}`);
  for (const [id, n] of Object.entries(doc.nodes)) {
    if (!isObj(n) || n.id !== id) { e.push(`nodes.${id}: id mismatch`); continue; }
    if (id === ROOT) { if (n.parent !== null) e.push('root: has no parent'); }
    else {
      const p = doc.nodes[n.parent];
      if (!p) e.push(`nodes.${id}: parent "${n.parent}" is not in the document`);
      else { if (!p.children.includes(id)) e.push(`nodes.${id}: not in its parent's children`); if (!(fam.accepts[p.kind] ?? []).includes(n.kind)) e.push(`nodes.${id}: a ${p.kind} does not take a ${n.kind}`); }
      for (const f of fam.props[n.kind] ?? []) if (f.required && (n.props?.[f.key] === undefined || n.props[f.key] === '')) e.push(`nodes.${id}: ${f.label} is needed`);
    }
    for (const c of Array.isArray(n.children) ? n.children : []) if (!doc.nodes[c]) e.push(`nodes.${id}: child "${c}" is not in the document`);
    let d = 0; let cur = n; while (cur && cur.parent) { cur = doc.nodes[cur.parent]; if (++d > DOC_LIMITS.depth) { e.push(`nodes.${id}: deeper than ${DOC_LIMITS.depth}`); break; } }
  }
  for (const s of Array.isArray(doc.selection) ? doc.selection : []) if (!doc.nodes[s]) e.push(`selection: "${s}" is not in the document`);
  for (const c of Object.keys(isObj(doc.canvas) ? doc.canvas : {})) if (!doc.nodes[c]) e.push(`canvas: "${c}" is not in the document`);
  return e;
}

/* ================================================================== ops (pure: a new document every time) */

const touch = (doc) => { const d = clone(doc); d.meta.revision = (d.meta.revision ?? 0) + 1; return d; };
const descendants = (doc, id) => { const out = []; const walk = (x) => { for (const c of doc.nodes[x]?.children ?? []) { out.push(c); walk(c); } }; walk(id); return out; };
const isAncestor = (doc, a, b) => { let cur = doc.nodes[b]; while (cur && cur.parent) { if (cur.parent === a) return true; cur = doc.nodes[cur.parent]; } return false; };
const depthOf = (doc, id) => { let d = 0; let cur = doc.nodes[id]; while (cur && cur.parent) { d++; cur = doc.nodes[cur.parent]; } return d; };

/** Add a node under `parent` at `index` (end by default). Refused (null) when the parent does not take the kind or the document is full. */
export function addNode(doc, parent, kind, props = {}, index = -1) {
  const fam = familyOf(doc.type);
  const p = doc.nodes[parent];
  if (!p || !(fam.accepts[p.kind] ?? []).includes(kind)) return null;
  if (Object.keys(doc.nodes).length >= DOC_LIMITS.nodes || depthOf(doc, parent) + 1 > DOC_LIMITS.depth) return null;
  const d = touch(doc);
  const id = `n${d.meta.nextId++}`;
  const defaults = Object.fromEntries((fam.props[kind] ?? []).filter((f) => f.required && f.key === 'id').map(() => ['id', uniqueAssetId(d, slug(props.label ?? props.name ?? kind) || kind)]));
  d.nodes[id] = { id, kind, parent, children: [], props: { ...defaults, ...Object.fromEntries(Object.entries(props ?? {}).filter(([, v]) => v !== undefined)) } };
  const at = index < 0 || index > d.nodes[parent].children.length ? d.nodes[parent].children.length : index;
  d.nodes[parent].children.splice(at, 0, id);
  return { doc: d, id };
}
/** An asset-facing id (`props.id`) no other node in the document uses. */
export function uniqueAssetId(doc, base) {
  const used = new Set(Object.values(doc.nodes).map((n) => n.props?.id).filter(Boolean));
  let id = base || 'item'; let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  return id;
}
/** Remove nodes (and everything under them); the root never goes. */
export function removeNodes(doc, ids) {
  const d = touch(doc);
  const gone = new Set();
  for (const id of uniq(ids)) { if (id === ROOT || !d.nodes[id]) continue; gone.add(id); for (const c of descendants(d, id)) gone.add(c); }
  for (const id of gone) { const p = d.nodes[d.nodes[id].parent]; if (p) p.children = p.children.filter((c) => c !== id); delete d.nodes[id]; delete d.canvas[id]; }
  d.selection = d.selection.filter((s) => !gone.has(s));
  return d;
}
/** Move nodes under `parent` at `index` (keeping their order; `index` counts siblings before the move). Refused (null) when any node can't go there. */
export function moveNodes(doc, ids, parent, index = -1) {
  const fam = familyOf(doc.type);
  const p = doc.nodes[parent];
  const list = uniq(ids).filter((id) => id !== ROOT && doc.nodes[id]);
  if (!p || !list.length) return null;
  for (const id of list) { const n = doc.nodes[id]; if (!(fam.accepts[p.kind] ?? []).includes(n.kind) || id === parent || isAncestor(doc, id, parent)) return null; if (depthOf(doc, parent) + 1 + Math.max(0, ...descendants(doc, id).map((c) => depthOf(doc, c) - depthOf(doc, id))) > DOC_LIMITS.depth) return null; }
  const d = touch(doc);
  const ordered = list.sort((a, b) => { const pa = d.nodes[a].parent, pb = d.nodes[b].parent; return pa === pb ? d.nodes[pa].children.indexOf(a) - d.nodes[pa].children.indexOf(b) : 0; });
  let at = index < 0 ? Infinity : index;
  for (const id of ordered) { const op = d.nodes[d.nodes[id].parent]; const i = op.children.indexOf(id); if (op.id === parent && i < at) at--; op.children.splice(i, 1); }
  at = Math.min(Math.max(0, at), d.nodes[parent].children.length);
  d.nodes[parent].children.splice(at, 0, ...ordered);
  for (const id of ordered) d.nodes[id].parent = parent;
  return d;
}
/** Set props on nodes (`undefined` / null / '' removes a prop). */
export function setProps(doc, ids, patch) {
  const d = touch(doc);
  for (const id of uniq(ids)) { const n = d.nodes[id]; if (!n || id === ROOT) continue; for (const [k, v] of Object.entries(isObj(patch) ? patch : {})) { if (v === undefined || v === null || v === '') delete n.props[k]; else n.props[k] = clone(v); } }
  return d;
}
/** Set root-level data fields (`undefined` removes). */
export function setData(doc, patch) {
  const d = touch(doc);
  for (const [k, v] of Object.entries(isObj(patch) ? patch : {})) { if (v === undefined) delete d.data[k]; else d.data[k] = clone(v); }
  return d;
}
/** Rename the asset (name) and, when `id` is given, its id. */
export function renameDoc(doc, name, id) { const d = touch(doc); if (typeof name === 'string') d.name = name.slice(0, DOC_LIMITS.label); if (typeof id === 'string' && /^[a-z0-9][a-z0-9-]{1,47}$/.test(id)) d.id = id; return d; }
/** Duplicate nodes (each right after its original, subtrees included, asset ids made unique). Returns { doc, ids }. */
export function duplicate(doc, ids) {
  let d = touch(doc);
  const made = [];
  for (const id of uniq(ids)) {
    const n = d.nodes[id]; if (!n || id === ROOT) continue;
    const copy = (src, parent, index) => {
      const nid = `n${d.meta.nextId++}`;
      const props = clone(src.props);
      if (props.id) props.id = uniqueAssetId(d, `${props.id}-copy`.replace(/-copy-copy$/, '-copy'));
      d.nodes[nid] = { id: nid, kind: src.kind, parent, children: [], props, ...(src.locked ? { locked: true } : {}), ...(src.hidden ? { hidden: true } : {}) };
      d.nodes[parent].children.splice(index, 0, nid);
      if (d.canvas[src.id]) d.canvas[nid] = { ...d.canvas[src.id], x: d.canvas[src.id].x + 16, y: d.canvas[src.id].y + 16 };
      src.children.forEach((c, i) => copy(d.nodes[c], nid, i));
      return nid;
    };
    made.push(copy(n, n.parent, d.nodes[n.parent].children.indexOf(id) + 1));
  }
  d.selection = made;
  return { doc: d, ids: made };
}
/** Wrap sibling nodes in a new node of `kind` (a toolbar group, a menu item with a submenu) where the parent takes it. Null when it can't. */
export function group(doc, ids, kind, props = {}) {
  const list = uniq(ids).filter((id) => id !== ROOT && doc.nodes[id]);
  if (!list.length) return null;
  const parent = doc.nodes[list[0]].parent;
  if (list.some((id) => doc.nodes[id].parent !== parent)) return null;
  const fam = familyOf(doc.type);
  if (!(fam.accepts[doc.nodes[parent].kind] ?? []).includes(kind) || list.some((id) => !(fam.accepts[kind] ?? []).includes(doc.nodes[id].kind))) return null;
  const first = Math.min(...list.map((id) => doc.nodes[parent].children.indexOf(id)));
  const added = addNode(doc, parent, kind, { label: 'Group', ...props }, first);
  if (!added) return null;
  const d = moveNodes(added.doc, list, added.id, -1);
  if (!d) return null;
  d.selection = [added.id];
  return { doc: d, id: added.id };
}
/** Replace a node by its children (where the grandparent takes them). Null when it can't. */
export function ungroup(doc, id) {
  const n = doc.nodes[id]; if (!n || id === ROOT || !n.parent) return null;
  const fam = familyOf(doc.type);
  const gp = doc.nodes[n.parent];
  if (n.children.some((c) => !(fam.accepts[gp.kind] ?? []).includes(doc.nodes[c].kind))) return null;
  const at = gp.children.indexOf(id);
  const moved = n.children.length ? moveNodes(doc, n.children, gp.id, at) : touch(doc);
  if (!moved) return null;
  const d = removeNodes(moved, [id]);
  d.selection = [...n.children];
  return d;
}
export const lockNodes = (doc, ids, locked = true) => { const d = touch(doc); for (const id of uniq(ids)) if (d.nodes[id] && id !== ROOT) { if (locked) d.nodes[id].locked = true; else delete d.nodes[id].locked; } return d; };
export const hideNodes = (doc, ids, hidden = true) => { const d = touch(doc); for (const id of uniq(ids)) if (d.nodes[id] && id !== ROOT) { if (hidden) d.nodes[id].hidden = true; else delete d.nodes[id].hidden; } return d; };
/** Move nodes one step among their siblings (z order on the map = order in the list). */
export function stepNodes(doc, ids, dir) {
  const d = touch(doc);
  const list = uniq(ids).filter((id) => id !== ROOT && d.nodes[id]);
  const byParent = new Map();
  for (const id of list) { const p = d.nodes[id].parent; if (!byParent.has(p)) byParent.set(p, []); byParent.get(p).push(id); }
  for (const [p, kids] of byParent) {
    const ch = d.nodes[p].children;
    const idx = kids.map((k) => ch.indexOf(k)).sort((a, b) => (dir === 'forward' ? b - a : a - b));
    for (const i of idx) { const j = dir === 'forward' ? i + 1 : i - 1; if (j < 0 || j >= ch.length || kids.includes(ch[j])) continue; [ch[i], ch[j]] = [ch[j], ch[i]]; }
  }
  return d;
}

/* ================================================================== selection (multi-select everywhere) */

const siblingsBetween = (doc, a, b) => { const pa = doc.nodes[a]?.parent, pb = doc.nodes[b]?.parent; if (!pa || pa !== pb) return [b]; const ch = doc.nodes[pa].children; const [i, j] = [ch.indexOf(a), ch.indexOf(b)].sort((x, y) => x - y); return ch.slice(i, j + 1); };
/** Select a node: alone, added (`add`), toggled (`toggle`), or every sibling from the last selected one to it (`range`). */
export function select(doc, id, { add = false, toggle = false, range = false } = {}) {
  if (!doc.nodes[id] || id === ROOT) return clearSelection(doc);
  const d = clone(doc);
  const cur = d.selection;
  if (range && cur.length) d.selection = uniq([...cur, ...siblingsBetween(d, cur.at(-1), id)]);
  else if (toggle) d.selection = cur.includes(id) ? cur.filter((s) => s !== id) : [...cur, id];
  else if (add) d.selection = uniq([...cur, id]);
  else d.selection = [id];
  d.selection = d.selection.slice(0, DOC_LIMITS.selection);
  return d;
}
export const clearSelection = (doc) => ({ ...clone(doc), selection: [] });
/** Every child of `parent` (the root's children by default). */
export const selectAll = (doc, parent = ROOT) => ({ ...clone(doc), selection: [...(doc.nodes[parent]?.children ?? [])].slice(0, DOC_LIMITS.selection) });
/** Every node of one kind. */
export const selectKind = (doc, kind) => ({ ...clone(doc), selection: Object.values(doc.nodes).filter((n) => n.kind === kind).map((n) => n.id).slice(0, DOC_LIMITS.selection) });
/** The selection without nodes whose ancestor is also selected (ops act once per subtree). */
export const topSelection = (doc) => doc.selection.filter((id) => !doc.selection.some((o) => o !== id && isAncestor(doc, o, id)));
/** The bounding box of the selected nodes on the canvas, or null when none is placed. */
export function selectionBounds(doc, ids = doc.selection) {
  const rects = ids.map((id) => doc.canvas[id]).filter(Boolean);
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

/* ================================================================== canvas (map-based) */

export const CANVAS_CELL = { w: 160, h: 48, gap: 16, columns: 4 };
export const snapTo = (v, grid, on = true) => (on && grid > 0 ? Math.round(v / grid) * grid : Math.round(v));
/** Place a node on the map (snapped when the interface says so). */
export function place(doc, id, rect, ui = normalizeDesigner({})) {
  if (!doc.nodes[id] || id === ROOT) return doc;
  const d = clone(doc);
  const prev = d.canvas[id] ?? { x: 0, y: 0, w: CANVAS_CELL.w, h: CANVAS_CELL.h };
  const r = { ...prev, ...(isObj(rect) ? rect : {}) };
  d.canvas[id] = { x: Math.max(0, snapTo(r.x, ui.canvas.grid, ui.canvas.snap)), y: Math.max(0, snapTo(r.y, ui.canvas.grid, ui.canvas.snap)), w: Math.max(8, snapTo(r.w, ui.canvas.grid, ui.canvas.snap)), h: Math.max(8, snapTo(r.h, ui.canvas.grid, ui.canvas.snap)) };
  return d;
}
/** Nudge placed nodes by (dx, dy) grid steps (arrow keys; shift = 10 steps). */
export function nudge(doc, ids, dx, dy, ui = normalizeDesigner({})) {
  let d = doc;
  for (const id of uniq(ids)) if (d.canvas[id] && !d.nodes[id]?.locked) d = place(d, id, { x: d.canvas[id].x + dx * ui.canvas.grid, y: d.canvas[id].y + dy * ui.canvas.grid }, ui);
  return d;
}
export const ALIGN_EDGES = ['left', 'center', 'right', 'top', 'middle', 'bottom'];
/** Align placed nodes to an edge of their bounding box. */
export function align(doc, ids, edge, ui = normalizeDesigner({})) {
  const b = selectionBounds(doc, ids); if (!b) return doc;
  let d = doc;
  for (const id of uniq(ids)) {
    const r = d.canvas[id]; if (!r || d.nodes[id]?.locked) continue;
    const to = edge === 'left' ? { x: b.x } : edge === 'right' ? { x: b.x + b.w - r.w } : edge === 'center' ? { x: b.x + (b.w - r.w) / 2 } : edge === 'top' ? { y: b.y } : edge === 'bottom' ? { y: b.y + b.h - r.h } : edge === 'middle' ? { y: b.y + (b.h - r.h) / 2 } : {};
    d = place(d, id, to, { ...ui, canvas: { ...ui.canvas, snap: false } });
  }
  return d;
}
/** Spread placed nodes evenly along an axis between the first and the last. */
export function distribute(doc, ids, axis = 'x', ui = normalizeDesigner({})) {
  const list = uniq(ids).filter((id) => doc.canvas[id]).sort((a, b) => doc.canvas[a][axis] - doc.canvas[b][axis]);
  if (list.length < 3) return doc;
  const size = axis === 'x' ? 'w' : 'h';
  const first = doc.canvas[list[0]], last = doc.canvas[list.at(-1)];
  const span = last[axis] - (first[axis] + first[size]);
  const inner = list.slice(1, -1).reduce((n, id) => n + doc.canvas[id][size], 0);
  const gap = (span - inner) / (list.length - 1);
  let d = doc; let cur = first[axis] + first[size] + gap;
  for (const id of list.slice(1, -1)) { d = place(d, id, { [axis]: cur }, { ...ui, canvas: { ...ui.canvas, snap: false } }); cur += doc.canvas[id][size] + gap; }
  return d;
}
/** A flow grid for every root child that has no place yet (a document opened for the first time gets a map). */
export function autoLayout(doc, { cell = CANVAS_CELL, columns = CANVAS_CELL.columns, gap = CANVAS_CELL.gap, all = false } = {}) {
  const d = clone(doc);
  const kids = d.nodes[ROOT].children;
  let i = 0;
  for (const id of kids) {
    if (!all && d.canvas[id]) { i++; continue; }
    const n = d.nodes[id];
    const h = cell.h + (n.children.length ? Math.min(6, n.children.length) * Math.round(cell.h / 2) : 0);
    d.canvas[id] = { x: (i % columns) * (cell.w + gap), y: Math.floor(i / columns) * (cell.h * 2 + gap), w: cell.w, h };
    i++;
  }
  return d;
}
/** The zoom steps an interface allows (percent). */
export function zoomSteps(ui = normalizeDesigner({})) {
  const steps = [10, 25, 33, 50, 67, 75, 100, 125, 150, 200, 300, 400, 600, 800].filter((z) => z >= ui.canvas.zoomMin && z <= ui.canvas.zoomMax);
  return steps.length ? steps : [100];
}
/** The zoom (percent) that fits a bounding box into a viewport, clamped to the interface's range. */
export function zoomFit(bounds, viewport, ui = normalizeDesigner({}), pad = 24) {
  if (!bounds || !viewport || bounds.w <= 0 || bounds.h <= 0) return 100;
  const z = Math.floor(Math.min((viewport.w - pad * 2) / bounds.w, (viewport.h - pad * 2) / bounds.h) * 100);
  return Math.max(ui.canvas.zoomMin, Math.min(ui.canvas.zoomMax, z));
}

/* ================================================================== drag and drop */

export const DROP_POSITIONS = ['before', 'after', 'inside'];
/**
 * What was dropped: the designer MIME (a JSON payload: { kind: node | palette | asset | action | hook | embed | text | file, … }),
 * `application/json` with a grid-hook@1 `{ kind, id }` or an action `{ action }`, a `text/uri-list` https URL (an embed),
 * `text/plain` that is an asset ref, an action id or plain text, or files. `types` = { mime: string } as read from the event.
 */
export function parseDrop(types, files = []) {
  const t = isObj(types) ? types : {};
  const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const own = t[DESIGNER_DROP_MIME] ? json(t[DESIGNER_DROP_MIME]) : null;
  if (isObj(own)) {
    if (own.kind === 'node' && Array.isArray(own.ids)) return { kind: 'node', ids: own.ids.map(String).slice(0, DOC_LIMITS.selection) };
    if (own.kind === 'palette' && typeof own.node === 'string') return { kind: 'palette', node: own.node, ...(isObj(own.props) ? { props: own.props } : {}) };
    if (own.kind === 'asset' && parseAssetRef(own.ref)) return { kind: 'asset', ref: own.ref, ...(str(own.label) ? { label: str(own.label, 160) } : {}) };
    if (own.kind === 'action' && typeof own.action === 'string') return { kind: 'action', action: own.action, ...(str(own.label) ? { label: str(own.label, 160) } : {}), ...(str(own.icon) ? { icon: str(own.icon, 40) } : {}) };
    if (own.kind === 'hook' && isObj(own.hook)) return { kind: 'hook', hook: { id: str(own.hook.id, 80), label: str(own.hook.label, 160), icon: str(own.hook.icon, 40), action: str(own.hook.action, 200) } };
    if (own.kind === 'embed' && (parseAssetRef(own.ref) || isObj(own.target))) return { kind: 'embed', ...(own.ref ? { ref: own.ref } : {}), ...(isObj(own.target) ? { target: own.target } : {}) };
    if (own.kind === 'text' && typeof own.text === 'string') return { kind: 'text', text: own.text.slice(0, DOC_LIMITS.text) };
  }
  const j = t['application/json'] ? json(t['application/json']) : null;
  if (isObj(j)) {
    if (typeof j.action === 'string') return { kind: 'action', action: j.action, ...(str(j.label) ? { label: str(j.label, 160) } : {}) };
    if (typeof j.kind === 'string' && typeof j.id === 'string' && !('ids' in j)) return { kind: 'hook', hook: { id: `${j.kind}:${j.id}`, label: str(j.title ?? j.label, 160) || `${j.kind} ${j.id}`, icon: str(j.icon, 40), action: str(j.action, 200) || `row.open:${j.kind}:${j.id}` } };
  }
  const uri = str(t['text/uri-list'], 2000).split(/\r?\n/).find((l) => l && !l.startsWith('#'));
  if (uri && /^https:\/\//i.test(uri)) return { kind: 'embed', target: { kind: 'url', url: uri } };
  const plain = str(t['text/plain'], DOC_LIMITS.text).trim();
  if (plain) {
    if (parseAssetRef(plain)) return { kind: 'asset', ref: plain };
    if (/^[a-z][a-z0-9._-]*(:[^\s<>"'`]{0,160})?$/.test(plain) && plain.includes('.')) return { kind: 'action', action: plain };
    return { kind: 'text', text: plain };
  }
  const f = Array.isArray(files) ? files.filter((x) => isObj(x) && typeof x.name === 'string') : [];
  if (f.length) return { kind: 'file', name: str(f[0].name, 200), type: str(f[0].type, 80) };
  return null;
}
/** The node a drop becomes in a type's document, by payload kind and the kind the target accepts; null when nothing fits. */
export function dropNode(doc, payload, childKinds) {
  const kinds = Array.isArray(childKinds) ? childKinds : [];
  const pick = (...wanted) => wanted.find((k) => kinds.includes(k)) ?? null;
  const label = (s) => str(s, DOC_LIMITS.label);
  if (!payload) return null;
  if (payload.kind === 'palette') return kinds.includes(payload.node) ? { kind: payload.node, props: { ...(payload.props ?? {}) } } : null;
  if (payload.kind === 'action') { const k = pick('item'); return k ? { kind: k, props: { label: label(payload.label) || payload.action.split(':')[0].split('.').pop(), icon: payload.icon || 'zap', action: payload.action } } : null; }
  if (payload.kind === 'hook') { const k = pick('item'); return k ? { kind: k, props: { label: payload.hook.label || payload.hook.id, icon: payload.hook.icon || 'link', action: payload.hook.action, hook: payload.hook.id } } : null; }
  if (payload.kind === 'text') { const k = pick('item', 'section', 'menu', 'group', 'target'); return k ? { kind: k, props: k === 'target' ? { name: slug(payload.text) } : { label: label(payload.text), ...(k === 'item' ? { icon: 'type' } : {}) } } : null; }
  if (payload.kind === 'asset' || payload.kind === 'embed') {
    const ref = payload.ref ? parseAssetRef(payload.ref) : null;
    const isEmbed = payload.kind === 'embed' || ref?.type === EMBED_TYPE;
    const isWidget = ref && (DESIGNER_WIDGET_TYPES.includes(ref.type) || ref.type === 'badge');
    if (kinds.includes('widget') && (isWidget || isEmbed) && ref) return { kind: 'widget', props: { type: ref.type, id: ref.id, at: 'end' } };
    if (kinds.includes('attach') && (isWidget || isEmbed) && ref) return { kind: 'attach', props: { type: ref.type, id: ref.id, at: 'right' } };
    const k = pick('item');
    if (!k) return null;
    if (isEmbed) return { kind: k, props: { label: label(payload.label) || ref?.id || 'Embed', icon: 'box', action: ref ? `embed.open:${ref.id}` : `embed.url:${payload.target?.url ?? ''}`, ...(ref ? { embed: ref.id } : {}) } };
    return ref ? { kind: k, props: { label: label(payload.label) || ref.id, icon: 'layers', action: `swap:${ref.type}:${ref.id}` } } : null;
  }
  if (payload.kind === 'file') return null;
  return null;
}
/**
 * May this be dropped here? `target` = { node, position } (before / after a node, or inside it) or { canvas: { x, y } }
 * (on the map = inside the root). `addon` says which payload kinds its canvas takes. Answers { ok, reason?, parent, index, as? }.
 */
export function canDrop(doc, addon, payload, target) {
  if (!payload) return { ok: false, reason: 'nothing to drop' };
  const drops = Array.isArray(addon?.drops) ? addon.drops : [];
  if (drops.length && !drops.includes(payload.kind)) return { ok: false, reason: `${addon?.label ?? 'this designer'} does not take a ${payload.kind} drop` };
  let parent = ROOT, index = -1;
  if (isObj(target) && target.node && doc.nodes[target.node]) {
    const n = doc.nodes[target.node];
    if (target.position === 'inside' || target.node === ROOT) parent = target.node;
    else { parent = n.parent; index = doc.nodes[parent].children.indexOf(target.node) + (target.position === 'after' ? 1 : 0); }
  } else if (isObj(target) && isObj(target.canvas)) { parent = ROOT; }
  else return { ok: false, reason: 'no target' };
  if (doc.nodes[parent]?.locked) return { ok: false, reason: 'locked' };
  const kinds = acceptsKinds(doc.type, doc.nodes[parent].kind);
  if (payload.kind === 'node') {
    const ids = payload.ids.filter((id) => doc.nodes[id] && id !== ROOT);
    if (!ids.length) return { ok: false, reason: 'those nodes are not in this document' };
    for (const id of ids) { if (id === parent || isAncestor(doc, id, parent)) return { ok: false, reason: 'a node cannot go inside itself' }; if (!kinds.includes(doc.nodes[id].kind)) return { ok: false, reason: `a ${doc.nodes[parent].kind} does not take a ${doc.nodes[id].kind}` }; if (doc.nodes[id].locked) return { ok: false, reason: 'locked' }; }
    return { ok: true, parent, index, as: 'node' };
  }
  if (payload.kind === 'file') return familyOf(doc.type).id === 'flat' && doc.type === EMBED_TYPE && /\.json$/i.test(payload.name) ? { ok: true, parent, index, as: 'manifest' } : { ok: false, reason: 'only an embed takes a JSON manifest file' };
  const node = dropNode(doc, payload, kinds);
  if (!node) return { ok: false, reason: kinds.length ? `nothing here takes a ${payload.kind}` : `a ${assetTypeLabel(doc.type).toLowerCase()} has no parts to drop into` };
  return { ok: true, parent, index, as: node.kind };
}
/** Apply a drop (after canDrop). Returns { doc, ids } or { doc, error }. A map drop also places the node where it landed. */
export function applyDrop(doc, addon, payload, target, ui = normalizeDesigner({})) {
  const can = canDrop(doc, addon, payload, target);
  if (!can.ok) return { doc, error: can.reason };
  let d = doc; let ids = [];
  if (can.as === 'node') { const moved = moveNodes(doc, payload.ids, can.parent, can.index); if (!moved) return { doc, error: 'cannot move there' }; d = moved; ids = payload.ids.filter((id) => d.nodes[id]); }
  else if (can.as === 'manifest') { d = setData(doc, { manifest: payload.name }); }
  else { const node = dropNode(doc, payload, acceptsKinds(doc.type, doc.nodes[can.parent].kind)); const added = addNode(doc, can.parent, node.kind, node.props, can.index); if (!added) return { doc, error: 'cannot add there' }; d = added.doc; ids = [added.id]; }
  if (isObj(target?.canvas) && ids.length) { const b = selectionBounds(d, ids); const dx = target.canvas.x - (b?.x ?? target.canvas.x), dy = target.canvas.y - (b?.y ?? target.canvas.y); for (const id of ids) d = place(d, id, d.canvas[id] ? { x: d.canvas[id].x + dx, y: d.canvas[id].y + dy } : { x: target.canvas.x, y: target.canvas.y, w: CANVAS_CELL.w, h: CANVAS_CELL.h }, ui); }
  if (ids.length) d.selection = ids;
  return { doc: d, ids };
}
/** The drag payload a designer writes for its own nodes (set it under DESIGNER_DROP_MIME). */
export const nodeDragPayload = (ids) => JSON.stringify({ kind: 'node', ids: uniq(ids) });
/** The palette entries of a type's document: one per node kind the root (or `parent`) takes. */
export const palette = (type, parentKind = ROOT) => acceptsKinds(type, parentKind).map((k) => ({ node: k, label: nodeKindLabel(type, k), payload: JSON.stringify({ kind: 'palette', node: k }) }));

/* ================================================================== history (undo / redo) */

export function createHistory(doc, limit = 100) { return { limit: Math.max(1, limit), past: [], present: doc, future: [], lastLabel: '', lastAt: 0 }; }
/** Record a new state. Quick edits with one label (dragging, typing) within `coalesceMs` replace the last state instead of stacking. */
export function commit(h, doc, { label = '', at = 0, coalesceMs = 0 } = {}) {
  if (doc === h.present) return h;
  const coalesce = coalesceMs > 0 && label && label === h.lastLabel && at - h.lastAt <= coalesceMs && h.past.length;
  const past = coalesce ? h.past : [...h.past, { doc: h.present, label: h.lastLabel }].slice(-h.limit);
  return { ...h, past, present: doc, future: [], lastLabel: label, lastAt: at };
}
export const canUndo = (h) => h.past.length > 0;
export const canRedo = (h) => h.future.length > 0;
export function undo(h) {
  if (!canUndo(h)) return h;
  const prev = h.past.at(-1);
  return { ...h, past: h.past.slice(0, -1), present: prev.doc, future: [{ doc: h.present, label: h.lastLabel }, ...h.future], lastLabel: prev.label, lastAt: 0 };
}
export function redo(h) {
  if (!canRedo(h)) return h;
  const next = h.future[0];
  return { ...h, past: [...h.past, { doc: h.present, label: h.lastLabel }].slice(-h.limit), present: next.doc, future: h.future.slice(1), lastLabel: next.label, lastAt: 0 };
}
/** What Undo / Redo would do, for the menu: the labels of the last and next states. */
export const historyLabels = (h) => ({ undo: canUndo(h) ? h.lastLabel || 'Undo' : '', redo: canRedo(h) ? h.future[0].label || 'Redo' : '' });

/* ================================================================== the designer's context menu + keys */

export const DESIGNER_KEYS = Object.freeze({
  'ctrl+z': 'designer.undo', 'ctrl+shift+z': 'designer.redo', 'ctrl+y': 'designer.redo', delete: 'designer.delete', backspace: 'designer.delete', 'ctrl+d': 'designer.duplicate', 'ctrl+a': 'designer.selectAll',
  'ctrl+g': 'designer.group', 'ctrl+shift+g': 'designer.ungroup', 'ctrl+c': 'designer.copy', 'ctrl+x': 'designer.cut', 'ctrl+v': 'designer.paste', escape: 'designer.clear', enter: 'designer.edit', f2: 'designer.rename',
  arrowleft: 'designer.nudge:-1:0', arrowright: 'designer.nudge:1:0', arrowup: 'designer.nudge:0:-1', arrowdown: 'designer.nudge:0:1', 'shift+arrowleft': 'designer.nudge:-10:0', 'shift+arrowright': 'designer.nudge:10:0', 'shift+arrowup': 'designer.nudge:0:-10', 'shift+arrowdown': 'designer.nudge:0:10',
  'ctrl+]': 'designer.forward', 'ctrl+[': 'designer.backward', 'ctrl+l': 'designer.lock', 'ctrl+h': 'designer.hide', 'ctrl+=': 'designer.zoom:in', 'ctrl+-': 'designer.zoom:out', 'ctrl+0': 'designer.zoom:fit', 'ctrl+s': 'designer.save', 'ctrl+p': 'designer.preview',
});
/** The verbs the designer's actions use (`designer.<verb>[:args]`). */
export const DESIGNER_VERBS = uniq(Object.values(DESIGNER_KEYS).map((a) => a.split(':')[0].split('.')[1])).concat(['insert', 'wrap', 'align', 'distribute', 'autoLayout', 'snap', 'grid', 'selectKind', 'selectChildren', 'unlock', 'show', 'properties', 'help', 'open', 'new', 'publish']).sort();

/**
 * The right-click menu of a node (`ctx.node`) or of the canvas (`ctx.canvas`). Sections follow the designer interface
 * (`ui.context.*`); `clipboard` says whether Paste has something; `history` gives Undo / Redo their labels; `addon`
 * says what may be inserted. Entries carry `tip` tooltips and action ids (`designer.<verb>:<args>`), so the same menu
 * works on a mouse, a finger and by voice.
 */
export function designerContextMenu(doc, addon, ctx = {}, ui = normalizeDesigner({}), { clipboard = false, history = null } = {}) {
  const items = [];
  const sep = (id) => items.push({ id, separator: true });
  const sel = ctx.node && doc.nodes[ctx.node] ? (doc.selection.includes(ctx.node) ? topSelection(doc) : [ctx.node]) : topSelection(doc);
  const many = sel.length > 1;
  const n = ctx.node && doc.nodes[ctx.node] ? doc.nodes[ctx.node] : null;
  const kindLabel = (k) => nodeKindLabel(doc.type, k);
  const insertMenu = (parentKind, where, label) => { const kinds = acceptsKinds(doc.type, parentKind).filter((k) => !addon?.nodes || addon.nodes.includes(k)); return kinds.length ? [{ id: `insert-${where}`, label, icon: 'plus', items: kinds.map((k) => ({ id: `insert-${where}-${k}`, label: kindLabel(k), action: `designer.insert:${k}:${where}` })) }] : []; };
  const hl = history ? historyLabels(history) : { undo: '', redo: '' };
  if (n && n.id !== ROOT) {
    items.push({ id: 'edit', label: many ? `Edit ${sel.length} ${kindLabel(n.kind).toLowerCase()}s…` : `Edit ${kindLabel(n.kind).toLowerCase()}…`, icon: 'edit', action: 'designer.properties', tip: 'Open the inspector on the selection' });
    if (!many) items.push({ id: 'rename', label: 'Rename', icon: 'type', action: 'designer.rename', tip: 'F2' });
    if (ui.context.insert) { items.push(...insertMenu(doc.nodes[n.parent]?.kind ?? ROOT, 'before', 'Insert before ▸'), ...insertMenu(doc.nodes[n.parent]?.kind ?? ROOT, 'after', 'Insert after ▸'), ...insertMenu(n.kind, 'inside', 'Insert inside ▸')); }
    sep('s1');
    if (ui.context.clipboard) items.push({ id: 'cut', label: 'Cut', icon: 'scissors', action: 'designer.cut', tip: 'Ctrl+X' }, { id: 'copy', label: 'Copy', icon: 'copy', action: 'designer.copy', tip: 'Ctrl+C' }, { id: 'paste', label: 'Paste', icon: 'clipboard', action: `designer.paste:after`, tip: clipboard ? 'Ctrl+V' : 'Nothing copied yet', ...(clipboard ? {} : { disabled: true }) });
    items.push({ id: 'duplicate', label: 'Duplicate', icon: 'copy', action: 'designer.duplicate', tip: 'Ctrl+D' }, { id: 'delete', label: many ? `Delete ${sel.length}` : 'Delete', icon: 'trash', action: 'designer.delete', tip: 'Delete' });
    sep('s2');
    const wrapKinds = acceptsKinds(doc.type, doc.nodes[n.parent]?.kind ?? ROOT).filter((k) => acceptsKinds(doc.type, k).includes(n.kind));
    if (wrapKinds.length) items.push({ id: 'group', label: `Wrap in ${kindLabel(wrapKinds[0]).toLowerCase()}`, icon: 'folder', action: `designer.group:${wrapKinds[0]}`, tip: 'Ctrl+G' });
    if (!many && n.children.length && acceptsKinds(doc.type, doc.nodes[n.parent]?.kind ?? ROOT).some((k) => n.children.every((c) => doc.nodes[c].kind === k))) items.push({ id: 'ungroup', label: 'Ungroup', icon: 'folder-minus', action: 'designer.ungroup', tip: 'Ctrl+Shift+G' });
    if (ui.context.arrange) {
      const arr = [{ id: 'forward', label: 'Bring forward', action: 'designer.forward', tip: 'Ctrl+]' }, { id: 'backward', label: 'Send backward', action: 'designer.backward', tip: 'Ctrl+[' }];
      if (many && ui.canvas.mode !== 'flow') arr.push({ id: 'a-sep', separator: true }, ...ALIGN_EDGES.map((e) => ({ id: `align-${e}`, label: `Align ${e}`, action: `designer.align:${e}` })), { id: 'd-sep', separator: true }, { id: 'dist-x', label: 'Distribute horizontally', action: 'designer.distribute:x' }, { id: 'dist-y', label: 'Distribute vertically', action: 'designer.distribute:y' });
      items.push({ id: 'arrange', label: 'Arrange ▸', icon: 'move', items: arr });
    }
    items.push({ id: 'lock', label: n.locked ? 'Unlock' : 'Lock', icon: 'lock', action: n.locked ? 'designer.unlock' : 'designer.lock', tip: 'Ctrl+L' }, { id: 'hide', label: n.hidden ? 'Show' : 'Hide', icon: 'eye', action: n.hidden ? 'designer.show' : 'designer.hide', tip: 'Hidden parts are left out of the saved asset' });
    sep('s3');
    items.push({ id: 'select', label: 'Select ▸', icon: 'check-square', items: [{ id: 'select-all', label: 'All', action: 'designer.selectAll', tip: 'Ctrl+A' }, { id: 'select-kind', label: `All ${kindLabel(n.kind).toLowerCase()}s`, action: `designer.selectKind:${n.kind}` }, ...(n.children.length ? [{ id: 'select-children', label: 'Children', action: `designer.selectChildren:${n.id}` }] : [])] });
  } else {
    if (ui.context.clipboard) items.push({ id: 'paste', label: 'Paste here', icon: 'clipboard', action: 'designer.paste:here', tip: clipboard ? 'Ctrl+V' : 'Nothing copied yet', ...(clipboard ? {} : { disabled: true }) });
    if (ui.context.insert) items.push(...insertMenu(ROOT, 'inside', 'Insert ▸'));
    items.push({ id: 'select-all', label: 'Select all', icon: 'check-square', action: 'designer.selectAll', tip: 'Ctrl+A' });
    sep('s1');
    if (ui.canvas.mode !== 'flow') items.push({ id: 'auto-layout', label: 'Auto layout', icon: 'grid', action: 'designer.autoLayout', tip: 'Lay every part out on the map' }, { id: 'snap', label: 'Snap to grid', icon: 'magnet', action: 'designer.snap', checked: 'setting:axf.designer.canvas.snap' }, { id: 'grid', label: 'Show grid', icon: 'grid', action: 'designer.grid', checked: 'setting:axf.designer.canvas.grid' });
    items.push({ id: 'zoom', label: 'Zoom ▸', icon: 'zoom-in', items: [{ id: 'zoom-fit', label: 'Fit', action: 'designer.zoom:fit', tip: 'Ctrl+0' }, { id: 'zoom-100', label: '100%', action: 'designer.zoom:100' }, { id: 'zoom-in', label: 'Zoom in', action: 'designer.zoom:in', tip: 'Ctrl+=' }, { id: 'zoom-out', label: 'Zoom out', action: 'designer.zoom:out', tip: 'Ctrl+-' }] });
  }
  sep('s4');
  items.push({ id: 'undo', label: hl.undo ? `Undo ${hl.undo}` : 'Undo', icon: 'undo', action: 'designer.undo', tip: 'Ctrl+Z', ...(hl.undo ? {} : { disabled: true }) }, { id: 'redo', label: hl.redo ? `Redo ${hl.redo}` : 'Redo', icon: 'redo', action: 'designer.redo', tip: 'Ctrl+Shift+Z', ...(hl.redo ? {} : { disabled: true }) });
  if (ui.context.preview) items.push({ id: 'preview', label: 'Preview', icon: 'eye', action: 'designer.preview', tip: 'Ctrl+P', preview: doc.id ? `${doc.type}/${doc.id}` : undefined });
  if (ui.context.help) items.push({ id: 'help', label: 'Help', icon: 'help', action: `help.explain:designer:${doc.type}${n && n.id !== ROOT ? `/${n.kind}` : ''}` });
  return items.filter((it, i, a) => !(it.separator && (i === 0 || i === a.length - 1 || a[i - 1]?.separator)));
}
