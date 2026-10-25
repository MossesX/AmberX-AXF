/**
 * Context menu designer — pure model (no React, no DOM). Shared by the designer UI, the live stylesheet and test.mts.
 *
 * A design is a context menu you build by hand (`kind: 'menu'`) or a reusable piece of one (`kind: 'chunk'`). Entries are
 * items (label, icon, action, shortcut, nested items), separators, or a chunk inserted by reference. Compiling a menu
 * expands every chunk in place (chunks may insert separators and other chunks; cycles and missing chunks are reported and
 * skipped) into plain context-menu items, which the plugin registers as a standard context-menu asset@1
 * (`ctxd-<design id>`), so the framework's context menu, Appearance and every engine treat it like any other.
 *
 * Styles: every design carries its own style (font, size, weight, style, text / background colour, hover text /
 * background colour). A chunk either inherits the style of the menu it is inserted into (`inherit: true`) or uses its
 * own, where each blank field still falls back to the surrounding menu. Colours are theme tokens (`token:accent` →
 * `var(--fx-accent)`, so a theme swap restyles them) or a colour you picked (`#rrggbb`, user data). Styles reach the
 * real menu through a generated stylesheet keyed on each item's `data-axf-item` id.
 */

export type DesignKind = 'menu' | 'chunk';

export interface MenuStyle {
  /** '' = theme font; 'display' | 'mono' = theme fonts; generic families otherwise */
  font: string;
  /** percent of the theme font size; 0 = theme size */
  size: number;
  weight: '' | 'normal' | 'medium' | 'bold';
  fontStyle: '' | 'normal' | 'italic';
  color: string;
  background: string;
  hoverColor: string;
  hoverBackground: string;
}

export type Entry =
  | { kind: 'item'; id: string; label: string; icon?: string; action?: string; shortcut?: string; items?: Entry[] }
  | { kind: 'separator'; id: string }
  | { kind: 'chunk'; id: string; chunk: string };

export interface Design {
  id: string;
  name: string;
  kind: DesignKind;
  /** chunk only: take the surrounding menu's style instead of its own */
  inherit: boolean;
  style: MenuStyle;
  items: Entry[];
  /** menu only: context-menu asset fields */
  variant: 'compact' | 'roomy' | 'glass';
  showIcons: boolean;
  showShortcuts: boolean;
  /** menu only: context-menu asset whose other targets (not `default`) the compiled asset keeps */
  base: string;
  updatedAt: string;
}

/** The runtime's menu item shape (framework core MenuItem), kept local so this file stays import-free. */
export interface CompiledItem { id: string; label?: string; icon?: string; action?: string; shortcut?: string; separator?: boolean; items?: CompiledItem[] }

export const COLOR_TOKENS = ['text', 'muted', 'accent', 'accent-text', 'accent-soft', 'surface', 'surface2', 'surface3', 'bg', 'border', 'info', 'success', 'warning', 'danger'] as const;
export const FONTS = ['', 'display', 'mono', 'sans-serif', 'serif', 'system-ui', 'monospace', 'cursive'] as const;
export const WEIGHTS = ['', 'normal', 'medium', 'bold'] as const;
export const FONT_STYLES = ['', 'normal', 'italic'] as const;
export const VARIANTS = ['compact', 'roomy', 'glass'] as const;
export const STYLE_KEYS: (keyof MenuStyle)[] = ['font', 'size', 'weight', 'fontStyle', 'color', 'background', 'hoverColor', 'hoverBackground'];
export const COLOR_KEYS = ['color', 'background', 'hoverColor', 'hoverBackground'] as const;

export const LIMITS = { name: 80, label: 80, items: 200, depth: 4, chunkDepth: 6, designs: 300, sizeMin: 60, sizeMax: 200 };
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const ASSET_PREFIX = 'ctxd-';
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export const emptyStyle = (): MenuStyle => ({ font: '', size: 0, weight: '', fontStyle: '', color: '', background: '', hoverColor: '', hoverBackground: '' });

/** A colour value is '' (none), a theme token or a picked colour. */
export function colorOk(v: string): boolean {
  if (v === '') return true;
  if (v.startsWith('token:')) return (COLOR_TOKENS as readonly string[]).includes(v.slice(6));
  return HEX_RE.test(v);
}

export function colorCss(v: string): string {
  if (!v || !colorOk(v)) return '';
  return v.startsWith('token:') ? `var(--fx-${v.slice(6)})` : v.toLowerCase();
}

export function fontCss(f: string): string {
  if (f === 'display') return 'var(--fx-font-display)';
  if (f === 'mono') return 'var(--fx-font-mono)';
  return (FONTS as readonly string[]).includes(f) ? f : '';
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'menu';
}

/** A free design id from a name ("My menu" → my-menu, my-menu-2, …). */
export function freeId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slug(name);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export function normalizeStyle(raw: unknown): MenuStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, list: readonly T[]): T => ((list as readonly unknown[]).includes(v) ? (v as T) : (list[0] as T));
  const size = typeof s.size === 'number' && Number.isFinite(s.size) ? Math.round(s.size) : 0;
  const out = emptyStyle();
  out.font = pick(s.font, FONTS);
  out.size = size === 0 ? 0 : Math.min(LIMITS.sizeMax, Math.max(LIMITS.sizeMin, size));
  out.weight = pick(s.weight, WEIGHTS);
  out.fontStyle = pick(s.fontStyle, FONT_STYLES);
  for (const k of COLOR_KEYS) out[k] = typeof s[k] === 'string' && colorOk(s[k] as string) ? (s[k] as string) : '';
  return out;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function normalizeEntries(raw: unknown, depth: number, ids: Set<string>): Entry[] {
  if (!Array.isArray(raw)) return [];
  const out: Entry[] = [];
  for (const r of raw.slice(0, LIMITS.items)) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    let id = str(e.id, 48) || `e${ids.size + 1}`;
    while (ids.has(id)) id = `${id}-x`;
    ids.add(id);
    if (e.kind === 'separator') out.push({ kind: 'separator', id });
    else if (e.kind === 'chunk') out.push({ kind: 'chunk', id, chunk: str(e.chunk, 80) });
    else {
      const it: Entry = { kind: 'item', id, label: str(e.label, LIMITS.label) };
      if (str(e.icon, 40)) it.icon = str(e.icon, 40);
      if (str(e.action, 200)) it.action = str(e.action, 200);
      if (str(e.shortcut, 40)) it.shortcut = str(e.shortcut, 40);
      if (depth < LIMITS.depth && Array.isArray(e.items) && e.items.length) it.items = normalizeEntries(e.items, depth + 1, ids);
      out.push(it);
    }
  }
  return out;
}

export function normalizeDesign(raw: unknown): Design {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind: DesignKind = d.kind === 'chunk' ? 'chunk' : 'menu';
  const id = typeof d.id === 'string' && ID_RE.test(d.id) ? d.id : slug(str(d.name, 80));
  return {
    id,
    name: str(d.name, LIMITS.name).trim() || id,
    kind,
    inherit: kind === 'chunk' ? d.inherit !== false : false,
    style: normalizeStyle(d.style),
    items: normalizeEntries(d.items, 1, new Set()),
    variant: (VARIANTS as readonly unknown[]).includes(d.variant) ? (d.variant as Design['variant']) : 'compact',
    showIcons: d.showIcons !== false,
    showShortcuts: d.showShortcuts !== false,
    base: typeof d.base === 'string' ? d.base.slice(0, 80) : '',
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt.slice(0, 40) : '',
  };
}

export function newDesign(kind: DesignKind, name: string, taken: Iterable<string>): Design {
  return normalizeDesign({ kind, name, id: freeId(name, taken), items: [] });
}

/** Problems that block saving (blank name, duplicate chunk names, bad colours…). */
export function designErrors(d: Design, all: Design[]): string[] {
  const errs: string[] = [];
  if (!ID_RE.test(d.id)) errs.push('The id must be lowercase letters, digits and dashes.');
  if (!d.name.trim()) errs.push('Give it a name.');
  const clash = all.find((o) => o.id !== d.id && o.kind === d.kind && o.name.trim().toLowerCase() === d.name.trim().toLowerCase());
  if (clash) errs.push(`Another ${d.kind} is already called "${clash.name}".`);
  for (const k of COLOR_KEYS) if (!colorOk(d.style[k])) errs.push(`${k} is not a theme colour or #rrggbb.`);
  return errs;
}

/** Find a chunk by id, else by name (case ignored). */
export function findChunk(ref: string, all: Design[]): Design | undefined {
  const chunks = all.filter((x) => x.kind === 'chunk');
  return chunks.find((x) => x.id === ref) ?? chunks.find((x) => x.name.trim().toLowerCase() === ref.trim().toLowerCase());
}

/** The style a chunk's items get inside a surrounding (already resolved) style. */
export function chunkStyle(chunk: Design, outer: MenuStyle): MenuStyle {
  if (chunk.inherit) return outer;
  const out = { ...outer };
  for (const k of STYLE_KEYS) {
    const v = chunk.style[k];
    if (v !== '' && v !== 0) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export const styleEmpty = (s: MenuStyle) => STYLE_KEYS.every((k) => s[k] === '' || s[k] === 0);

export interface Compiled {
  items: CompiledItem[];
  /** compiled item id → the style it is drawn with (only items with any style) */
  styles: Record<string, MenuStyle>;
  errors: string[];
  /** chunk ids used, directly or through other chunks */
  uses: string[];
}

/** Expand a menu (or a chunk, for its own preview) into plain menu items + per-item styles. */
export function compile(design: Design, all: Design[]): Compiled {
  const styles: Record<string, MenuStyle> = {};
  const errors: string[] = [];
  const uses = new Set<string>();
  const prefix = `${ASSET_PREFIX}${design.id}`;
  let n = 0;

  const walk = (entries: Entry[], style: MenuStyle, stack: string[], depth: number): CompiledItem[] => {
    const out: CompiledItem[] = [];
    for (const e of entries) {
      if (e.kind === 'separator') { out.push({ id: `${prefix}-${++n}`, separator: true }); continue; }
      if (e.kind === 'chunk') {
        const c = findChunk(e.chunk, all);
        if (!c) { errors.push(`No chunk called "${e.chunk}".`); continue; }
        if (stack.includes(c.id)) { errors.push(`Chunk "${c.name}" inserts itself (loop skipped).`); continue; }
        if (stack.length >= LIMITS.chunkDepth) { errors.push(`Chunks nest deeper than ${LIMITS.chunkDepth} (skipped "${c.name}").`); continue; }
        uses.add(c.id);
        out.push(...walk(c.items, chunkStyle(c, style), [...stack, c.id], depth));
        continue;
      }
      const it: CompiledItem = { id: `${prefix}-${++n}`, label: e.label || 'Untitled' };
      if (e.icon) it.icon = e.icon;
      if (e.action) it.action = e.action;
      if (e.shortcut) it.shortcut = e.shortcut;
      if (e.items?.length) {
        if (depth >= LIMITS.depth) errors.push(`"${it.label}": submenus nest deeper than ${LIMITS.depth}.`);
        else it.items = walk(e.items, style, stack, depth + 1);
      }
      if (!styleEmpty(style)) styles[it.id] = style;
      out.push(it);
    }
    return out;
  };

  const items = walk(design.items, design.style, design.kind === 'chunk' ? [design.id] : [], 1);
  // tidy separators: none first, last or doubled (a chunk ending and the next starting with one)
  const tidy = (list: CompiledItem[]): CompiledItem[] => {
    const t = list.filter((x, i) => !(x.separator && (i === 0 || list[i - 1]?.separator)));
    while (t.length && t[t.length - 1]?.separator) t.pop();
    return t.map((x) => (x.items ? { ...x, items: tidy(x.items) } : x));
  };
  return { items: tidy(items), styles, errors: [...new Set(errors)], uses: [...uses] };
}

/** Designs that insert this chunk (directly or through another chunk). */
export function usedBy(chunkId: string, all: Design[]): Design[] {
  return all.filter((d) => d.id !== chunkId && compile(d, all).uses.includes(chunkId));
}

const cssStr = (id: string) => id.replace(/["\\]/g, '');

function declarations(s: MenuStyle, hover: boolean): string {
  const out: string[] = [];
  const color = colorCss(hover ? s.hoverColor : s.color);
  const bg = colorCss(hover ? s.hoverBackground : s.background);
  if (color) out.push(`color: ${color}`);
  if (bg) out.push(`background: ${bg}`);
  if (!hover) {
    const f = fontCss(s.font);
    if (f) out.push(`font-family: ${f}`);
    if (s.size) out.push(`font-size: calc(var(--fx-font-size) * ${s.size / 100})`);
    if (s.weight) out.push(`font-weight: ${s.weight === 'medium' ? 500 : s.weight}`);
    if (s.fontStyle) out.push(`font-style: ${s.fontStyle}`);
  }
  return out.join('; ');
}

/** CSS for the compiled items' styles, under a scope selector (`.fx-ctx` live, the preview's class in the designer). */
export function styleSheet(styles: Record<string, MenuStyle>, scope: string): string {
  const rules: string[] = [];
  for (const [id, s] of Object.entries(styles)) {
    const sel = `${scope} .fx-menu__li[data-axf-item="${cssStr(id)}"] > .fx-menu__item`;
    const base = declarations(s, false);
    const hover = declarations(s, true);
    if (base) rules.push(`${sel} { ${base}; }`);
    if (s.color) rules.push(`${sel} .fx-menu__icon { color: inherit; }`);
    if (hover) rules.push(`${sel}:hover:not(:disabled) { ${hover}; }`);
  }
  return rules.join('\n');
}

/** The context-menu asset@1 a saved menu design becomes. `baseTargets` = the base asset's targets (kept except default). */
export function toAsset(d: Design, all: Design[], baseTargets: Record<string, unknown> = {}) {
  const c = compile(d, all);
  const targets: Record<string, unknown> = { ...baseTargets, default: c.items };
  return {
    $axf: 'asset@1' as const,
    type: 'context-menu',
    id: `${ASSET_PREFIX}${d.id}`,
    name: d.name,
    version: '1.0.0',
    description: 'Made in the context menu designer.',
    author: 'Context menu designer',
    tags: ['designer'],
    data: { variant: d.variant, showIcons: d.showIcons, showShortcuts: d.showShortcuts, targets },
  };
}

/** Rename an entry list's chunk references when a chunk is renamed (references by name follow it). */
export function renameChunkRefs(entries: Entry[], from: string, to: string): Entry[] {
  const key = from.trim().toLowerCase();
  return entries.map((e) => {
    if (e.kind === 'chunk' && e.chunk.trim().toLowerCase() === key) return { ...e, chunk: to };
    if (e.kind === 'item' && e.items) return { ...e, items: renameChunkRefs(e.items, from, to) };
    return e;
  });
}

/** Turn a design's entries into a new chunk ("Save as chunk"). */
export function asChunk(d: Design, name: string, all: Design[]): Design {
  return normalizeDesign({ ...d, kind: 'chunk', id: freeId(name, all.map((x) => x.id)), name, inherit: true, updatedAt: '' });
}

/* ---- entry tree editing (immutable) ---- */

export type Path = number[];

export function getAt(entries: Entry[], path: Path): Entry | undefined {
  let list = entries;
  let e: Entry | undefined;
  for (const i of path) {
    e = list[i];
    if (!e) return undefined;
    list = e.kind === 'item' ? e.items ?? [] : [];
  }
  return e;
}

function mapList(entries: Entry[], path: Path, f: (list: Entry[]) => Entry[]): Entry[] {
  if (!path.length) return f(entries);
  const [i, ...rest] = path;
  return entries.map((e, j) => (j === i && e.kind === 'item' ? { ...e, items: mapList(e.items ?? [], rest, f) } : e));
}

/** Insert `entry` into the list at `parent` (path of the parent item, [] = top), at `index` (default: end). */
export function insertAt(entries: Entry[], parent: Path, entry: Entry, index?: number): Entry[] {
  return mapList(entries, parent, (l) => { const c = [...l]; c.splice(index ?? c.length, 0, entry); return c; });
}

export function removeAt(entries: Entry[], path: Path): Entry[] {
  return mapList(entries, path.slice(0, -1), (l) => l.filter((_, j) => j !== path[path.length - 1]));
}

export function updateAt(entries: Entry[], path: Path, patch: Partial<Entry>): Entry[] {
  return mapList(entries, path.slice(0, -1), (l) => l.map((e, j) => (j === path[path.length - 1] ? ({ ...e, ...patch } as Entry) : e)));
}

export function moveAt(entries: Entry[], path: Path, delta: number): Entry[] {
  const i = path[path.length - 1] ?? 0;
  return mapList(entries, path.slice(0, -1), (l) => {
    const j = i + delta;
    if (j < 0 || j >= l.length) return l;
    const c = [...l];
    [c[i], c[j]] = [c[j]!, c[i]!];
    return c;
  });
}

/** A fresh entry id unique in the tree. */
export function nextEntryId(entries: Entry[]): string {
  const ids = new Set<string>();
  const walk = (l: Entry[]) => l.forEach((e) => { ids.add(e.id); if (e.kind === 'item' && e.items) walk(e.items); });
  walk(entries);
  let n = ids.size + 1;
  while (ids.has(`e${n}`)) n++;
  return `e${n}`;
}
