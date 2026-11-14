/**
 * AshesUI, the pure part (no DOM, no React): what a rendered element *is* in AXF terms, who owns it, and the rows the
 * tooltip and the inspector show. index.tsx takes a plain snapshot of an element (`ElementSnap`) and hands it here, so
 * every rule is testable without a browser (spec: framework/spec/check-ashes.mts).
 *
 * Open registries (an app or plugin adds its own): COMPONENTS (class → framework component + the asset type that styles
 * it), and owners (resolveOwner takes the app's known plugins and libraries; an app can add a resolver of its own).
 */

/* ---------------- framework components: class → component, asset type ---------------- */

export interface ComponentSpec { cls: string; name: string; asset?: string; kind: 'control' | 'container' | 'chrome' | 'overlay' | 'widget' | 'layout' | 'text' }

/** The framework's engine-styled blocks (framework/ui/axf.css). First match on an element wins, so order = most specific. */
export const COMPONENTS: ComponentSpec[] = [
  { cls: 'fx-iconbtn', name: 'IconButton', asset: 'button', kind: 'control' },
  { cls: 'fx-toolbtn', name: 'Toolbar button', asset: 'toolbar', kind: 'chrome' },
  { cls: 'fx-btn', name: 'Button', asset: 'button', kind: 'control' },
  { cls: 'fx-switch', name: 'Switch', asset: 'button', kind: 'control' },
  { cls: 'fx-checkrow', name: 'Checkbox', kind: 'control' },
  { cls: 'fx-check', name: 'Checkbox', kind: 'control' },
  { cls: 'fx-seg', name: 'Segmented', asset: 'button', kind: 'control' },
  { cls: 'fx-slider', name: 'Slider', asset: 'slider', kind: 'control' },
  { cls: 'fx-input', name: 'Input', kind: 'control' },
  { cls: 'fx-field', name: 'Field', kind: 'control' },
  { cls: 'fx-choices', name: 'ChoiceGrid', kind: 'control' },
  { cls: 'fx-choice', name: 'Choice', kind: 'control' },
  { cls: 'fx-chip', name: 'Chip', kind: 'text' },
  { cls: 'fx-badge', name: 'Badge', asset: 'badge', kind: 'widget' },
  { cls: 'fx-kbd', name: 'Kbd', kind: 'text' },
  { cls: 'fx-note', name: 'Note', kind: 'text' },
  { cls: 'fx-md', name: 'Markdown', kind: 'text' },
  { cls: 'fx-gauge', name: 'Gauge', asset: 'gauge', kind: 'control' },
  { cls: 'fx-meter', name: 'Meter', asset: 'meter', kind: 'control' },
  { cls: 'fx-tab', name: 'Tab', kind: 'control' },
  { cls: 'fx-tabs', name: 'Tabs', kind: 'container' },
  { cls: 'fx-card', name: 'Container', asset: 'container', kind: 'container' },
  { cls: 'fx-section', name: 'Section', asset: 'container', kind: 'container' },
  { cls: 'fx-table', name: 'Table', kind: 'container' },
  { cls: 'fx-dialog', name: 'Dialog', asset: 'dialog', kind: 'overlay' },
  { cls: 'fx-popover', name: 'Popup', asset: 'popup', kind: 'overlay' },
  { cls: 'fx-dropdown', name: 'Dropdown', asset: 'popup', kind: 'overlay' },
  { cls: 'fx-menu', name: 'Menu', asset: 'context-menu', kind: 'overlay' },
  { cls: 'fx-ctx', name: 'Context menu', asset: 'context-menu', kind: 'overlay' },
  { cls: 'fx-toast', name: 'Toast', kind: 'overlay' },
  { cls: 'fx-window', name: 'Floating window', kind: 'overlay' },
  { cls: 'fx-tabgroup', name: 'Tab group', kind: 'container' },
  { cls: 'fx-dock', name: 'Dock', kind: 'layout' },
  { cls: 'fx-widget', name: 'Widget', kind: 'widget' },
  { cls: 'fx-search', name: 'Search', asset: 'search-bar', kind: 'widget' },
  { cls: 'fx-banner', name: 'Banner', asset: 'banner', kind: 'chrome' },
  { cls: 'fx-menubar', name: 'Application menu', asset: 'app-menu', kind: 'chrome' },
  { cls: 'fx-toolbar', name: 'Toolbar', asset: 'toolbar', kind: 'chrome' },
  { cls: 'fx-nav', name: 'Navigation', asset: 'nav-menu', kind: 'chrome' },
  { cls: 'fx-status', name: 'Status bar', kind: 'chrome' },
  { cls: 'fx-pagehead', name: 'Page heading', kind: 'text' },
  { cls: 'fx-main', name: 'Main area', asset: 'layout', kind: 'layout' },
  { cls: 'fx-region', name: 'Layout region', asset: 'layout', kind: 'layout' },
  { cls: 'fx-shell', name: 'App shell', asset: 'layout', kind: 'layout' },
  { cls: 'fx-frame', name: 'App frame', asset: 'layout', kind: 'layout' },
  { cls: 'fx-row', name: 'Row', kind: 'layout' },
  { cls: 'fx-stack', name: 'Stack', kind: 'layout' },
  { cls: 'fx-grid', name: 'Grid', kind: 'layout' },
];

/** Add (or replace) a component spec: an app's or library's own engine-styled block. */
export function registerComponent(spec: ComponentSpec): void {
  const i = COMPONENTS.findIndex((c) => c.cls === spec.cls);
  if (i >= 0) COMPONENTS[i] = spec; else COMPONENTS.unshift(spec);
}

/** The framework component an element is (by its classes), or null. A modifier (`fx-btn--primary`) names the variant. */
export function componentOf(classes: readonly string[]): (ComponentSpec & { variant?: string }) | null {
  for (const c of COMPONENTS) {
    if (!classes.includes(c.cls)) continue;
    const mod = classes.find((x) => x.startsWith(`${c.cls}--`));
    return { ...c, ...(mod ? { variant: mod.slice(c.cls.length + 2) } : {}) };
  }
  return null;
}

/* ---------------- owners: which plugin or library drew it ---------------- */

export interface KnownOwner { kind: 'plugin' | 'library' | 'app' | 'framework'; id: string; name: string; prefix: string; model?: string; version?: string }
export interface Owner extends KnownOwner { via: string }

/**
 * Who drew an element: the nearest ancestor (or itself) with a class `axp-<folder>…` (plugins) / `axf-<lib>…`
 * (libraries), `data-axf-plugin`, or a settings anchor of a module. `chain` = the element's classes then each
 * ancestor's, nearest first; `attrs` the same for data-axf-plugin. Longest matching prefix wins (`axp-claude-handoff-files`
 * → claude-handoff, not claude). Framework classes (fx-*) alone = the framework.
 */
export function resolveOwner(chain: readonly (readonly string[])[], known: readonly KnownOwner[], attrs: readonly (string | null)[] = []): Owner | null {
  const byPrefix = [...known].sort((a, b) => b.prefix.length - a.prefix.length);
  for (let depth = 0; depth < chain.length; depth++) {
    const a = attrs[depth];
    if (a) {
      const k = known.find((x) => x.id === a || x.prefix === a || x.prefix.endsWith(`-${a}`));
      if (k) return { ...k, via: depth ? `an ancestor's data-axf-plugin="${a}"` : `data-axf-plugin="${a}"` };
    }
    for (const cls of chain[depth]!) {
      if (!/^ax[pf]-/.test(cls)) continue;
      const k = byPrefix.find((x) => cls === x.prefix || cls.startsWith(`${x.prefix}__`) || cls.startsWith(`${x.prefix}--`) || cls.startsWith(`${x.prefix}-`));
      if (k) return { ...k, via: depth ? `an ancestor's class .${cls}` : `class .${cls}` };
    }
  }
  return null;
}

/** Known owners from a folder list (plugins: `axp-<folder>`) and library ids (`ai.amberx.axf.<x>` → `axf-<x>`). */
export function ownersFrom(plugins: readonly { folder: string; name: string; id?: string; model?: string; version?: string }[], libraries: readonly { id: string; label: string; model?: string; version?: string }[]): KnownOwner[] {
  const out: KnownOwner[] = plugins.map((p) => ({ kind: 'plugin', id: p.id ?? p.folder, name: p.name, prefix: `axp-${p.folder}`, ...(p.model ? { model: p.model } : {}), ...(p.version ? { version: p.version } : {}) }));
  for (const l of libraries) {
    if (out.some((o) => o.id === l.id)) continue;
    const short = l.id.split('.').pop() ?? l.id;
    out.push({ kind: 'library', id: l.id, name: l.label, prefix: `axf-${short}`, ...(l.model ? { model: l.model } : {}), ...(l.version ? { version: l.version } : {}) });
  }
  return out;
}

/* ---------------- colours: contrast (WCAG 2.x) ---------------- */

/** A computed colour string (rgb / rgba functions, 3- or 6-digit hex) → [r, g, b, a], or null. */
export function parseColor(s: string | null | undefined): [number, number, number, number] | null {
  if (!s) return null;
  const t = s.trim().toLowerCase();
  let m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (m) {
    const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  if (t === 'transparent') return [0, 0, 0, 0];
  return null;
}

function luminance([r, g, b]: readonly number[]): number {
  const ch = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r!) + 0.7152 * ch(g!) + 0.0722 * ch(b!);
}

/** Contrast ratio of text on a background (1–21), null when a colour doesn't parse. The background's alpha is ignored. */
export function contrast(fg: string, bg: string): number | null {
  const a = parseColor(fg), b = parseColor(bg);
  if (!a || !b) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

/** WCAG grade for normal text: AAA ≥ 7, AA ≥ 4.5, AA large ≥ 3, else fail. */
export function contrastGrade(ratio: number | null, large = false): 'AAA' | 'AA' | 'AA large' | 'fail' | '?' {
  if (ratio === null) return '?';
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return large ? 'AA' : 'AA large';
  return 'fail';
}

/* ---------------- a snapshot of one element ---------------- */

export interface ElementSnap {
  tag: string; id: string; classes: string[];
  role: string | null; label: string | null; title: string | null; text: string;
  rect: { x: number; y: number; w: number; h: number };
  attrs: Record<string, string>;
  style: Record<string, string>;
  inline: Record<string, string>;
  tokens: Record<string, string>;
  /** React component names from the nearest one up (when the page runs React) */
  components: string[];
  /** React prop names on this element that are handlers (onClick, …) */
  handlers: string[];
  /** owner chain inputs */
  chain: string[][]; pluginAttrs: (string | null)[];
  depth: number; childCount: number;
  path: string[];
  /** filled by the app (index.tsx): the active asset of the component's type */
  asset?: { type: string; id: string; name?: string; data?: Record<string, unknown> } | null;
  owner?: Owner | null;
  ctxTarget?: string | null; anchor?: string | null;
  focusable: boolean; disabled: boolean; hidden: boolean;
}

/** Curated computed-style properties, grouped (grid rows + tree branches). */
export const STYLE_GROUPS: Record<string, string[]> = {
  Box: ['display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'overflow', 'z-index'],
  Spacing: ['margin', 'padding', 'gap'],
  Border: ['border', 'border-radius', 'outline', 'box-shadow'],
  Colour: ['color', 'background-color', 'background-image', 'opacity', 'backdrop-filter'],
  Text: ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'white-space', 'text-overflow'],
  Flex: ['flex', 'flex-direction', 'flex-wrap', 'align-items', 'justify-content', 'grid-template-columns', 'grid-template-rows', 'grid-area', 'order'],
  Interaction: ['cursor', 'pointer-events', 'user-select', 'transition', 'transform', 'visibility'],
};
export const STYLE_PROPS: string[] = Object.values(STYLE_GROUPS).flat();

/** The selector that finds this element again (id, else tag + framework/owner classes + nth-of-type path). */
export function selectorOf(s: Pick<ElementSnap, 'tag' | 'id' | 'classes' | 'path'>): string {
  if (s.id && /^[A-Za-z][\w-]*$/.test(s.id)) return `#${s.id}`;
  return s.path.join(' > ');
}

/** One step of a CSS path: tag, id or the first two meaningful classes, nth-of-type when it has same-tag siblings. */
export function pathStep(tag: string, id: string, classes: readonly string[], nth: number, sameTagSiblings: number): string {
  if (id && /^[A-Za-z][\w-]*$/.test(id)) return `${tag}#${id}`;
  const cls = classes.filter((c) => /^[A-Za-z_][\w-]*$/.test(c) && !c.startsWith('is-')).slice(0, 2).map((c) => `.${c}`).join('');
  return `${tag}${cls}${sameTagSiblings > 1 ? `:nth-of-type(${nth})` : ''}`;
}

/** A short label for the tree and the tooltip head: Component (variant) · tag#id.class */
export function shortLabel(s: Pick<ElementSnap, 'tag' | 'id' | 'classes' | 'role' | 'label' | 'text'>): string {
  const c = componentOf(s.classes);
  const ident = `${s.tag}${s.id ? `#${s.id}` : ''}${s.classes.filter((x) => !x.startsWith('is-'))[0] ? `.${s.classes.filter((x) => !x.startsWith('is-'))[0]}` : ''}`;
  const words = (s.label || s.text || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return `${c ? `${c.name}${c.variant ? ` (${c.variant})` : ''} · ` : ''}${ident}${words ? ` “${words}${(s.label || s.text || '').length > 28 ? '…' : ''}”` : ''}`;
}

/** What the tooltip shows, short rows (key → value), in order; `fields` = the ones switched on in settings. */
export interface Row { group: string; key: string; value: string; editable?: 'style' | 'attr'; tone?: 'accent' | 'success' | 'warning' | 'danger' }
export const TOOLTIP_FIELDS = ['component', 'owner', 'asset', 'size', 'colors', 'contrast', 'font', 'spacing', 'role', 'handlers', 'react', 'selector'] as const;
export type TooltipField = (typeof TOOLTIP_FIELDS)[number];

export function tooltipRows(s: ElementSnap, fields: readonly string[] = TOOLTIP_FIELDS): Row[] {
  const out: Row[] = [];
  const on = (f: TooltipField) => fields.includes(f);
  const comp = componentOf(s.classes);
  if (on('component')) out.push({ group: 'tip', key: 'Component', value: comp ? `${comp.name}${comp.variant ? ` · ${comp.variant}` : ''}` : `<${s.tag}>`, tone: comp ? 'accent' : undefined });
  if (on('owner')) out.push({ group: 'tip', key: 'Belongs to', value: ownerText(s.owner), tone: s.owner?.kind === 'plugin' ? 'warning' : undefined });
  if (on('asset') && s.asset) out.push({ group: 'tip', key: 'Asset', value: `${s.asset.type} / ${s.asset.id}` });
  if (on('size')) out.push({ group: 'tip', key: 'Size', value: `${Math.round(s.rect.w)} × ${Math.round(s.rect.h)} at ${Math.round(s.rect.x)}, ${Math.round(s.rect.y)}` });
  if (on('colors')) out.push({ group: 'tip', key: 'Colours', value: `${s.style['color'] ?? '?'} on ${s.style['background-color'] ?? '?'}` });
  if (on('contrast')) {
    const r = contrast(s.style['color'] ?? '', effectiveBg(s));
    const g = contrastGrade(r, isLarge(s));
    out.push({ group: 'tip', key: 'Contrast', value: r === null ? '?' : `${r}:1 ${g}`, tone: g === 'fail' ? 'danger' : g === 'AAA' || g === 'AA' ? 'success' : 'warning' });
  }
  if (on('font')) out.push({ group: 'tip', key: 'Font', value: `${s.style['font-size'] ?? '?'} / ${s.style['font-weight'] ?? '?'} ${firstFont(s.style['font-family'])}` });
  if (on('spacing')) out.push({ group: 'tip', key: 'Spacing', value: `margin ${s.style['margin'] ?? '?'} · padding ${s.style['padding'] ?? '?'}` });
  if (on('role') && (s.role || s.label)) out.push({ group: 'tip', key: 'Role', value: [s.role, s.label && `“${s.label}”`].filter(Boolean).join(' ') });
  if (on('handlers') && s.handlers.length) out.push({ group: 'tip', key: 'Handlers', value: s.handlers.join(', ') });
  if (on('react') && s.components.length) out.push({ group: 'tip', key: 'React', value: s.components.slice(0, 3).join(' ‹ ') });
  if (on('selector')) out.push({ group: 'tip', key: 'Selector', value: selectorOf(s) });
  return out;
}

export function ownerText(o: Owner | null | undefined): string {
  if (!o) return 'the app (no plugin)';
  const kind = o.kind === 'plugin' ? 'plugin' : o.kind === 'library' ? 'library' : o.kind;
  return `${kind} ${o.name}${o.model ? ` · built with ${o.model}` : ''}`;
}

const firstFont = (f: string | undefined) => (f ?? '').split(',')[0]!.replace(/["']/g, '').trim();
const isLarge = (s: ElementSnap) => { const px = parseFloat(s.style['font-size'] ?? '0'); const w = Number(s.style['font-weight'] ?? 400); return px >= 24 || (px >= 18.66 && w >= 700); };
/** background colour the text sits on: the element's own, else `--ashes-bg` (the nearest opaque ancestor's, set by the snapshot). */
export const effectiveBg = (s: ElementSnap) => { const own = parseColor(s.style['background-color']); return own && own[3] > 0 ? s.style['background-color']! : (s.attrs['--ashes-bg'] ?? 'rgb(255, 255, 255)'); }; // theme-ok: reads page colours for contrast, styles nothing

/** Every parameter of an element as grid rows (group, key, value), in a stable order. */
export function parameterRows(s: ElementSnap): Row[] {
  const out: Row[] = [];
  const comp = componentOf(s.classes);
  const add = (group: string, key: string, value: unknown, editable?: Row['editable'], tone?: Row['tone']) => out.push({ group, key, value: value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value), ...(editable ? { editable } : {}), ...(tone ? { tone } : {}) });
  add('Identity', 'Tag', s.tag);
  add('Identity', 'Id', s.id, 'attr');
  add('Identity', 'Classes', s.classes.join(' '), 'attr');
  add('Identity', 'Selector', selectorOf(s));
  add('Identity', 'Depth', String(s.depth));
  add('Identity', 'Children', String(s.childCount));
  add('Framework', 'Component', comp ? comp.name : 'none (plain element)', undefined, comp ? 'accent' : undefined);
  if (comp?.variant) add('Framework', 'Variant', comp.variant);
  if (comp) add('Framework', 'Kind', comp.kind);
  if (comp?.asset) add('Framework', 'Styled by asset type', comp.asset);
  if (s.asset) { add('Framework', 'Active asset', `${s.asset.type} / ${s.asset.id}`); if (s.asset.name) add('Framework', 'Asset name', s.asset.name); }
  if (s.ctxTarget) add('Framework', 'Context-menu target', s.ctxTarget);
  if (s.anchor) add('Framework', 'Search anchor', s.anchor);
  add('Owner', 'Belongs to', ownerText(s.owner), undefined, s.owner?.kind === 'plugin' ? 'warning' : undefined);
  if (s.owner) { add('Owner', 'Id', s.owner.id); add('Owner', 'Kind', s.owner.kind); if (s.owner.version) add('Owner', 'Version', s.owner.version); if (s.owner.model) add('Owner', 'Built with', s.owner.model); add('Owner', 'Found by', s.owner.via); }
  if (s.asset?.data) for (const [k, v] of Object.entries(s.asset.data)) add('Asset data', k, v);
  add('Box', 'Position', `${Math.round(s.rect.x)}, ${Math.round(s.rect.y)}`);
  add('Box', 'Size', `${Math.round(s.rect.w)} × ${Math.round(s.rect.h)}`);
  for (const [g, props] of Object.entries(STYLE_GROUPS)) for (const p of props) if (s.style[p] !== undefined) add(`Style · ${g}`, p, s.style[p], 'style');
  for (const [k, v] of Object.entries(s.inline)) add('Inline style', k, v, 'style');
  const r = contrast(s.style['color'] ?? '', effectiveBg(s));
  const grade = contrastGrade(r, isLarge(s));
  add('Accessibility', 'Contrast', r === null ? '?' : `${r}:1`, undefined, grade === 'fail' ? 'danger' : 'success');
  add('Accessibility', 'WCAG', grade);
  add('Accessibility', 'Role', s.role ?? '');
  add('Accessibility', 'Label', s.label ?? '');
  add('Accessibility', 'Title', s.title ?? '');
  add('Accessibility', 'Focusable', s.focusable ? 'yes' : 'no');
  add('Accessibility', 'Disabled', s.disabled ? 'yes' : 'no');
  if (s.text) add('Content', 'Text', s.text);
  for (const [k, v] of Object.entries(s.attrs)) if (!k.startsWith('--ashes')) add('Attributes', k, v, 'attr');
  for (const [k, v] of Object.entries(s.tokens)) add('Theme tokens', k, v);
  if (s.components.length) add('React', 'Components (nearest first)', s.components.join(' ‹ '));
  if (s.handlers.length) add('React', 'Handlers', s.handlers.join(', '));
  return out;
}

/** Rows as a tree: group → key → value (the inspector's Tree tab). Groups with a "·" nest (Style · Box → Style › Box). */
export interface ParamNode { id: string; label: string; value?: string; row?: Row; children: ParamNode[] }
export function parameterTree(rows: readonly Row[]): ParamNode[] {
  const root: ParamNode[] = [];
  const branch = (list: ParamNode[], label: string, id: string): ParamNode => {
    let n = list.find((x) => x.label === label && !x.row);
    if (!n) { n = { id, label, children: [] }; list.push(n); }
    return n;
  };
  for (const r of rows) {
    const parts = r.group.split(' · ');
    let list = root, id = '';
    for (const p of parts) { id = id ? `${id}/${p}` : p; list = branch(list, p, id).children; }
    list.push({ id: `${id}/${r.key}`, label: r.key, value: r.value, row: r, children: [] });
  }
  return root;
}

/* ---------------- the element tree (the inspector's left side) ---------------- */

export interface ElNode { key: number; label: string; comp?: string; owner?: string; ownerKind?: string; children: ElNode[]; hidden?: boolean }

/** Keys of `key`'s ancestors (root first), so the tree opens down to the selection. */
export function pathTo(tree: readonly ElNode[], key: number): number[] | null {
  for (const n of tree) {
    if (n.key === key) return [];
    const p = pathTo(n.children, key);
    if (p) return [n.key, ...p];
  }
  return null;
}

/** Filter the tree: keep nodes matching the query (label / component / owner) and their ancestors; `only` narrows further. */
export function filterTree(tree: readonly ElNode[], q: string, only: 'all' | 'framework' | 'plugins' = 'all'): ElNode[] {
  const needle = q.trim().toLowerCase();
  const hit = (n: ElNode) => (!needle || `${n.label} ${n.comp ?? ''} ${n.owner ?? ''}`.toLowerCase().includes(needle))
    && (only === 'all' || (only === 'framework' ? !!n.comp : n.ownerKind === 'plugin'));
  const walk = (list: readonly ElNode[]): ElNode[] => list.flatMap((n) => {
    const kids = walk(n.children);
    return hit(n) || kids.length ? [{ ...n, children: kids }] : [];
  });
  return !needle && only === 'all' ? [...tree] : walk(tree);
}

/** Counts for the stats panel: elements, framework components by name, owners. */
export function treeStats(tree: readonly ElNode[]): { elements: number; components: Record<string, number>; owners: Record<string, number> } {
  const components: Record<string, number> = {}, owners: Record<string, number> = {};
  let elements = 0;
  const walk = (list: readonly ElNode[]) => { for (const n of list) { elements++; if (n.comp) components[n.comp] = (components[n.comp] ?? 0) + 1; if (n.owner) owners[n.owner] = (owners[n.owner] ?? 0) + 1; walk(n.children); } };
  walk(tree);
  return { elements, components, owners };
}

/** Where the tooltip goes: next to the pointer, flipped to stay on screen. */
export function tipPosition(px: number, py: number, w: number, h: number, vw: number, vh: number, offset = 16): { x: number; y: number } {
  let x = px + offset, y = py + offset;
  if (x + w > vw - 4) x = Math.max(4, px - offset - w);
  if (y + h > vh - 4) y = Math.max(4, py - offset - h);
  return { x, y };
}

/** Is this a double tap (two taps within `ms` and `dist` px)? */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, now: { t: number; x: number; y: number }, ms = 320, dist = 24): boolean {
  return !!prev && now.t - prev.t <= ms && Math.hypot(now.x - prev.x, now.y - prev.y) <= dist;
}
