/**
 * inline-edit-tokens@1 — element token addressing (build inline-element-editing-plugin-right-click-any-el s1, Fable).
 *
 * Every framework element gets ONE stable token path, derived from what the framework already renders: the chrome
 * roots (`.fx-menubar`, `.fx-nav`, `.fx-toolbar`, `.fx-banner`, `.fx-tabs`, `.fx-ctx`, `.fx-dialog`, a view), the
 * `data-axf-*` ids the components stamp on menus, items, groups, widgets and tabs, and the `fx-<block>__<part>` class of
 * every drawn part (label, icon, badge, chevron, …). Nothing here names a plugin folder; a plugin opts its own parts
 * in with `data-axf-el-root` / `data-axf-el` (below). Brett (Nov 10 2026): "Right-click elements right down to the
 * child … Same with navigation menus, toolbars, banners, widgets, every single thing."
 *
 * Path grammar (docs/contracts/inline-edit-tokens.md):
 *
 *   path     = segment ("/" segment)*
 *   segment  = name [":" id]              name: [a-z][a-z0-9-]*   id: encoded, see encodeId()
 *   root     = the first segment: <kind>:<instance>   e.g. app-menu:app · toolbar:app · nav-menu:app · banner:app
 *
 *   app-menu:app/menu:assets/panel/item:cycle/item:next-color/label
 *   nav-menu:app/section:system/item:settings/badge
 *   toolbar:app/group:edit/item:undo/icon
 *   banner:app/side:right/widget:clock%2Fdigital-12h
 *
 * An element's path is its root plus the segments of its ancestors and its own, in DOM order; a segment equal to the
 * one just before it is written once (the `li` of a menu item and its button both say `item:<id>`: one path, the li is
 * the element the chain highlights). Structural wrappers (`.fx-menubar__item`, `.fx-menu__li`, `.fx-nav__sub`, …)
 * contribute nothing. An element with no segment of its own has no path of its own: a hit on it resolves to the
 * nearest ancestor that has one (the "deepest child" rule of the capture layer).
 *
 * Pure: no DOM API beyond the four members of ElementLike below, so it runs the same in a browser, jsdom and a test's
 * plain objects. Kotlin twin deferred (Android on hold, framework/spec/PORTING.md).
 */

export const INLINE_EDIT_FRAME = 'inline-edit-tokens@1';

/** Opt-in markers for anything the tables below don't know (plugin parts, app views): the canonical attributes. */
export const EL_ROOT_ATTR = 'data-axf-el-root'; // "<kind>:<instance>" on a root element
export const EL_ATTR = 'data-axf-el';           // "<name>[:<id>]" on any descendant

/** @typedef {{ tagName: string, getAttribute(name: string): string | null, classList: { contains(c: string): boolean }, parentElement: ElementLike | null }} ElementLike */

const NAME = /^[a-z][a-z0-9-]*$/;
const ID_SAFE = /^[A-Za-z0-9._@-]+$/;

/** An id as it appears in a path: `/`, `:`, `%`, spaces and anything outside [A-Za-z0-9._@-] are percent-encoded. */
export const encodeId = (id) => String(id).replace(/[^A-Za-z0-9._@-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
export const decodeId = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
export const isSafeId = (s) => ID_SAFE.test(s);

/**
 * Root kinds: how a root element is recognised and where its instance id comes from (first attribute that is set,
 * else `fallback`). `className` is matched with classList.contains, so variant classes (`fx-nav--rail`) don't matter.
 * `type` is the asset type the root's tokens belong to (asset-customize@1 target), `label` is for the dialog.
 */
export const ELEMENT_ROOTS = {
  'app-menu': { classes: ['fx-menubar'], instance: ['data-axf-menubar'], fallback: 'app', type: 'app-menu', label: 'Application menu' },
  'nav-menu': { classes: ['fx-nav'], instance: ['data-axf-nav'], fallback: 'app', type: 'nav-menu', label: 'Navigation menu' },
  toolbar: { classes: ['fx-toolbar'], instance: ['data-axf-toolbar', 'data-axf-toolbar-asset'], fallback: 'app', type: 'toolbar', label: 'Toolbar' },
  banner: { classes: ['fx-banner'], instance: ['data-axf-banner'], fallback: 'app', type: 'banner', label: 'Banner' },
  'tab-group': { classes: ['fx-tabs', 'fx-tabgroup__bar'], instance: ['data-axf-tab-group'], fallback: 'app', type: 'tab-group', label: 'Tab group' },
  'context-menu': { classes: ['fx-ctx'], instance: ['data-axf-context'], fallback: 'app', type: 'context-menu', label: 'Context menu' },
  dialog: { classes: ['fx-dialog'], instance: ['data-axf-dialog'], fallback: 'app', type: 'dialog', label: 'Dialog' },
  view: { classes: ['fx-main__inner'], instance: ['data-axf-view'], fallback: 'home', type: 'container', label: 'Screen' },
  window: { classes: ['fx-window'], instance: ['data-axf-window'], fallback: 'app', type: 'container', label: 'Window' },
};
export const ELEMENT_ROOT_KINDS = Object.keys(ELEMENT_ROOTS);

/**
 * Segment sources: an attribute on the element → the segment name; the attribute's value is the id. Listed in the order
 * they are tried (the first attribute present wins), so an element never contributes two segments.
 */
export const ELEMENT_SEGMENTS = [
  { attr: 'data-axf-menu-btn', name: 'menu', role: 'item' },          // a menu bar button (AppMenu)
  { attr: 'data-axf-menu', name: 'menu', role: 'group', also: { name: 'panel', role: 'group' } }, // its open dropdown: menu:<id>/panel
  { attr: 'data-axf-item', name: 'item', role: 'item' },               // a menu row's li (MenuList, AppMenu)
  { attr: 'data-axf-menu-item', name: 'item', role: 'item' },         // a menu row's button (AppMenu)
  { attr: 'data-axf-live-row', name: 'item', role: 'item' },          // a live row (approvals, builds…) in a menu
  { attr: 'data-axf-row-button', name: 'button', role: 'item' },      // a button on a live row
  { attr: 'data-axf-nav-section', name: 'section', role: 'group' },
  { attr: 'data-axf-nav-item', name: 'item', role: 'item' },
  { attr: 'data-axf-toolbar-group', name: 'group', role: 'group' },
  { attr: 'data-axf-toolbtn', name: 'item', role: 'item' },
  { attr: 'data-axf-toolbar-widget', name: 'widget', role: 'item' },
  { attr: 'data-axf-banner-item', name: 'widget', role: 'item' },
  { attr: 'data-axf-banner-more', name: 'widget', role: 'item' },
  { attr: 'data-axf-tab', name: 'tab', role: 'item' },
  { attr: 'data-axf-widget-fields', name: 'widget', role: 'group' },
  { attr: EL_ATTR, name: null, role: null },                          // opt-in: the value is "<name>[:<id>]"
];

/** Classes that are a segment of their own without an id (a side of a banner, the dropdown panel, the strip). */
export const ELEMENT_CLASS_SEGMENTS = [
  { cls: 'fx-dropdown', name: 'panel', role: 'group' },
  { cls: 'fx-menu__sub', name: 'submenu', role: 'group' },
  { cls: 'fx-nav__sheet', name: 'sheet', role: 'group' },
  { cls: 'fx-banner__side', name: 'side', role: 'group', idFrom: ['is-left', 'is-center', 'is-right'] },
  { cls: 'fx-toolbar__widgets', name: 'widgets', role: 'group', idFrom: ['is-start', 'is-end'] },
  { cls: 'fx-banner__more', name: 'more', role: 'group' },
  { cls: 'fx-nav__head', name: 'head', role: 'group' },
  { cls: 'fx-menu__details', name: 'details', role: 'group' },
];

/** Structural wrappers: never a segment (the `__part` rule below skips them). */
export const ELEMENT_STRUCTURAL = new Set([
  'fx-menubar__item', 'fx-menu__li', 'fx-menu__live', 'fx-menu__scroll', 'fx-menu__row', 'fx-menu__live-main',
  'fx-nav__group', 'fx-nav__sub', 'fx-nav__sub-inner', 'fx-nav__sheet-head', 'fx-main__inner',
  'fx-toolbar__group', 'fx-toolbar__widget', 'fx-banner__item', 'fx-banner__more-item', 'fx-banner__more-btn', 'fx-banner-strip__widgets',
  'fx-tabs__more', 'fx-tabs__fold', 'fx-toolbar__fold', 'fx-dropdown--phone',
]);

/** Part names by class, when the `fx-<block>__<part>` rule would give a poor name. */
export const ELEMENT_PART_ALIASES = {
  'fx-icon': 'icon',
  'fx-nav__text': 'label',
  'fx-nav__chev': 'chevron',
  'fx-banner__name': 'label',
  'fx-widget-logo__text': 'label',
  'fx-widget-status__dot': 'dot',
  'fx-menu__sep': 'separator',
  'fx-menu__spacer': 'spacer',
  'fx-nav__resize': 'resize',
};

/** Blocks whose `__part` classes are parts (anything else `fx-x__y` is left alone: layout primitives, forms). */
const PART_BLOCKS = new Set(['fx-menubar', 'fx-menu', 'fx-nav', 'fx-navs', 'fx-toolbar', 'fx-toolbtn', 'fx-banner', 'fx-tabs', 'fx-tab', 'fx-ctx', 'fx-dialog', 'fx-window', 'fx-widget-logo', 'fx-widget-status', 'fx-widget-counter', 'fx-widget-label', 'fx-widget-link', 'fx-widget-button', 'fx-widget-progress', 'fx-widget-avatar', 'fx-widget-theme', 'fx-widget-search']);
/** Widget body classes: `fx-widget-<type>` → part `body` with the widget type as its id. */
const WIDGET_BODY = /^fx-widget-([a-z-]+)$/;
/** Role by part name (text-like / icon-like / badge / separator), for the token set each part gets. */
export const PART_ROLES = {
  label: 'text', text: 'text', shortcut: 'text', header: 'text', title: 'text', name: 'text', detail: 'text', hint: 'text', eyebrow: 'text',
  icon: 'icon', chevron: 'icon', dot: 'icon', logo: 'icon', brand: 'icon', check: 'icon', mark: 'icon',
  badge: 'badge', count: 'badge', pop: 'badge',
  separator: 'separator', sep: 'separator', spacer: 'separator', divider: 'separator', resize: 'separator',
};

const classesOf = (el) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const has = (el, c) => (el.classList ? el.classList.contains(c) : classesOf(el).includes(c));

/** The root this element IS (not an ancestor): `{ kind, instance }` or null. */
export function rootOf(el) {
  const own = el.getAttribute(EL_ROOT_ATTR);
  if (own) {
    const m = /^([a-z][a-z0-9-]*):(.+)$/.exec(own);
    if (m) return { kind: m[1], instance: isSafeId(m[2]) ? m[2] : encodeId(m[2]) };
  }
  for (const [kind, spec] of Object.entries(ELEMENT_ROOTS)) {
    if (!spec.classes.some((c) => has(el, c))) continue;
    let instance = '';
    for (const a of spec.instance) { const v = el.getAttribute(a); if (v) { instance = v; break; } }
    return { kind, instance: encodeId(instance || spec.fallback) };
  }
  return null;
}

/** The segment this element contributes on its own (not the root): `{ name, id?, role }` or null. */
export function segmentOf(el) {
  for (const s of ELEMENT_SEGMENTS) {
    const v = el.getAttribute(s.attr);
    if (v === null || v === undefined) continue;
    if (s.name === null) { // opt-in "<name>[:<id>]"
      const m = /^([a-z][a-z0-9-]*)(?::(.+))?$/.exec(v);
      if (!m) continue;
      return { name: m[1], id: m[2] ? encodeId(m[2]) : undefined, role: m[2] ? 'item' : 'part' };
    }
    return { name: s.name, id: encodeId(v), role: s.role, ...(s.also ? { also: s.also } : {}) };
  }
  for (const c of ELEMENT_CLASS_SEGMENTS) {
    if (!has(el, c.cls)) continue;
    const id = c.idFrom?.find((k) => has(el, k));
    return { name: c.name, id: id ? id.replace(/^is-/, '') : undefined, role: c.role };
  }
  const classes = classesOf(el);
  for (const c of classes) {
    if (ELEMENT_STRUCTURAL.has(c)) return null;
    if (ELEMENT_PART_ALIASES[c]) { const name = ELEMENT_PART_ALIASES[c]; return { name, role: PART_ROLES[name] ?? 'part' }; }
  }
  for (const c of classes) {
    const w = WIDGET_BODY.exec(c);
    if (w) return { name: 'body', id: w[1], role: 'item' };
    const m = /^(fx-[a-z-]+?)__([a-z][a-z0-9-]*)$/.exec(c);
    if (m && PART_BLOCKS.has(m[1]) && !ELEMENT_STRUCTURAL.has(c)) return { name: m[2], role: PART_ROLES[m[2]] ?? 'part' };
  }
  return null;
}

const segText = (s) => (s.id ? `${s.name}:${s.id}` : s.name);

/**
 * The address of an element: `{ path, root: { kind, instance }, segments, role, element }` or null when it is not under
 * a framework root. `element` is the outermost element that has this exact path (the li of a menu item, not its
 * button), which is what the chain highlights. An element with no segment of its own answers its nearest addressed
 * ancestor's address (`own: false`).
 */
export function addressOf(el) {
  // The OUTERMOST root is the root; a root inside it (a toolbar in a dialog, a tab row on a screen) is a segment of its own.
  const up = [];
  let root = null;
  let rootEl = null;
  for (let e = el; e; e = e.parentElement) {
    const r = rootOf(e);
    if (r) { root = r; rootEl = e; }
    up.push(e);
  }
  if (!root) return null;
  const chain = up.slice(0, up.indexOf(rootEl)).reverse(); // root's child first … el last
  const segments = [];
  const owners = []; // the outermost element of each segment
  let last = null;
  let lastOwner = rootEl;
  for (const e of chain) {
    const inner = rootOf(e);
    const s = inner ? { name: inner.kind, id: inner.instance, role: 'group' } : segmentOf(e);
    if (!s) continue;
    const t = segText(s);
    if (!(last && t === last)) { // the same segment as the one just above (li + its button): one path
      segments.push({ name: s.name, id: s.id, role: s.role, text: t });
      owners.push(e);
      last = t;
      lastOwner = e;
    }
    if (s.also) { // an element that is two levels at once (a menu's dropdown: menu:<id>/panel)
      const t2 = segText(s.also);
      segments.push({ ...s.also, text: t2 });
      owners.push(e);
      last = t2;
      lastOwner = e;
    }
  }
  const rootText = `${root.kind}:${root.instance}`;
  const path = [rootText, ...segments.map((s) => s.text)].join('/');
  const role = segments.length ? segments[segments.length - 1].role : 'root';
  const own = el === rootEl || rootOf(el) !== null || segmentOf(el) !== null; // false = the hit fell on an unaddressed child; this is its nearest address
  return { path, root, rootText, segments, role, element: lastOwner, owners: [rootEl, ...owners], own };
}

/** Just the path (null when the element is not under a framework root). */
export const pathOf = (el) => addressOf(el)?.path ?? null;

/* ---------------- path text helpers (no DOM) ---------------- */

const SEG = /^([a-z][a-z0-9-]*)(?::([A-Za-z0-9._@%-]+))?$/;

/** Parse a path; null when it is not well formed. */
export function parsePath(path) {
  if (typeof path !== 'string' || !path || path.length > 400) return null;
  const parts = path.split('/');
  const segs = [];
  for (const p of parts) {
    const m = SEG.exec(p);
    if (!m) return null;
    segs.push({ name: m[1], id: m[2] });
  }
  if (!segs[0].id) return null; // the root always has an instance
  return { root: { kind: segs[0].name, instance: segs[0].id }, rootText: parts[0], segments: segs.slice(1), parts };
}
export const isPath = (p) => parsePath(p) !== null;
/** The root segment of a path ("toolbar:app"). */
export const rootTextOf = (path) => parsePath(path)?.rootText ?? null;
/** Every ancestor path from the root down to the path itself. */
export function chainOf(path) {
  const p = parsePath(path);
  if (!p) return [];
  return p.parts.map((_, i) => p.parts.slice(0, i + 1).join('/'));
}
/** The parent path (null for a root). */
export function parentOf(path) {
  const c = chainOf(path);
  return c.length > 1 ? c[c.length - 2] : null;
}
/** Is `ancestor` the path itself or one of its ancestors? */
export const isWithin = (path, ancestor) => path === ancestor || path.startsWith(`${ancestor}/`);

/** The role of the last segment of a path text (root / group / item / text / icon / badge / separator / part). */
export function roleOfPath(path) {
  const p = parsePath(path);
  if (!p) return null;
  if (!p.segments.length) return 'root';
  const s = p.segments[p.segments.length - 1];
  if (s.id) {
    if (ELEMENT_ROOTS[s.name]) return 'group'; // a nested root (a toolbar inside a dialog)
    const spec = ELEMENT_SEGMENTS.find((x) => x.name === s.name) ?? ELEMENT_CLASS_SEGMENTS.find((x) => x.name === s.name);
    return spec?.role ?? 'item';
  }
  const cls = ELEMENT_CLASS_SEGMENTS.find((x) => x.name === s.name);
  if (cls) return cls.role;
  return PART_ROLES[s.name] ?? 'part';
}

/** The asset type a root kind's tokens belong to (asset-customize@1 target), or null for an opt-in kind. */
export const typeOfKind = (kind) => ELEMENT_ROOTS[kind]?.type ?? null;

/** A human label for a path segment, for the dialog's tree: "Application menu", "menu assets", "item next-color", "label". */
export function labelOfSegment(seg, kind) {
  if (seg.name === kind || (ELEMENT_ROOTS[seg.name] && seg.id)) return ELEMENT_ROOTS[seg.name]?.label ?? seg.name;
  return seg.id ? `${seg.name} ${decodeId(seg.id)}` : seg.name;
}
