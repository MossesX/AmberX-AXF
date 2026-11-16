/**
 * Banner widgets engine: what each widget on the banner shows and how much room it takes, chosen by the person.
 *
 * Every widget on the banner comes through one door: the banner asset's own `attach` list or `rt.attachToBanner`. Both
 * may carry a `widget` hint (label, default size, priority), and the runtime lists everything that came through as the
 * banner's widgets, so a new plugin chip shows up in the Widgets picker by itself. The person's choices are one setting
 * per app and form factor (`axf.banners.widgets.<app>.<phone|desktop>`, a look setting, so it travels through the
 * axHub appearance document). Region and order stay in the host arrangement (rt.moveHostItem), so arrange mode and the
 * picker can never disagree.
 *
 * widget-shape@1 (Nov 16 2026, schemas/asset-types.json → widgetShape): a widget also carries the outline it is clipped to
 * (`shape`, default circle = the look every widget had before the field existed), a `customPath` for shape custom, and an
 * `iconOverride` {pack, id} that draws another pack's glyph in place of its own icon. The saved setting is migrated once per
 * profile (`migrateBannerWidgetPrefs`): every choice from before the field gets `shape: 'circle'` written out, so the screen
 * does not change and a later default can never move an old widget.
 *
 * Pure functions. Kotlin twin deferred (spec/PORTING.md); checks in spec/check-widgets.mts.
 */
import spec from '../../schemas/asset-types.json';

export const BANNER_WIDGET_SIZES = ['icon', 'compact', 'normal', 'wide'] as const;
export type BannerWidgetSize = typeof BANNER_WIDGET_SIZES[number];
/** What a widget draws: `auto` is its own mix; `number` is only its count. */
export const BANNER_WIDGET_SHOWS = ['auto', 'both', 'icon', 'text', 'number'] as const;
export type BannerWidgetShow = typeof BANNER_WIDGET_SHOWS[number];
export const BANNER_WIDTH_UNITS = ['px', 'ch'] as const;
export type BannerWidthUnit = typeof BANNER_WIDTH_UNITS[number];

/** Widest a widget may draw at each size, in multiples of the theme's space token (`icon` needs no cap: it has no text). */
export const BANNER_WIDGET_WIDTH: Record<BannerWidgetSize, number | null> = { icon: null, compact: 30, normal: 52, wide: 90 };
export const BANNER_WIDGET_PRIORITY = { min: 1, max: 9, default: 5 } as const;
export const BANNER_WIDGET_MAX_WIDTH: Record<BannerWidthUnit, { min: number; max: number }> = { px: { min: 24, max: 800 }, ch: { min: 2, max: 80 } };
/** Widgets with their own fixed shape: they keep it until the person picks a size for them. */
export const BANNER_FIXED_SHAPE: readonly string[] = ['clock', 'search-bar', 'logo', 'avatar', 'spacer', 'divider', 'progress', 'theme-switch'];
const KEY = /^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/;
/** Most entries the setting keeps (a damaged setting can't grow without bound). */
export const BANNER_WIDGET_PREFS_MAX = 200;

/* ---- widget-shape@1 ---- */
const WS = spec.widgetShape as { frame: string; shapes: string[]; default: string; customPath: { max: number; commands: string; box: number }; iconOverride: { pack: string; id: string }; tokens: { radius: string; clip: string; icon: string } };
export const WIDGET_SHAPE_FRAME = WS.frame;
export const BANNER_WIDGET_SHAPES = ['circle', 'square', 'rounded', 'pill', 'hexagon', 'custom'] as const;
export type BannerWidgetShape = typeof BANNER_WIDGET_SHAPES[number];
/** The shape every widget had before the field existed; what an unset, migrated or invalid choice resolves to. */
export const BANNER_WIDGET_SHAPE_DEFAULT: BannerWidgetShape = WS.default as BannerWidgetShape;
/** Custom paths: most characters, the SVG commands allowed, and the square they are drawn in (0..box). */
export const BANNER_WIDGET_CUSTOM_PATH = WS.customPath;
/** The compiled token names (web: CSS custom properties on the widget's host item). */
export const BANNER_WIDGET_SHAPE_TOKENS = WS.tokens;
const PACK_ID = new RegExp(WS.iconOverride.pack);
const GLYPH_ID = new RegExp(WS.iconOverride.id);

/** Another pack's glyph drawn instead of the widget's own icon. */
export interface BannerWidgetIconOverride { pack: string; id: string }

/** The widget-shape@1 fields a hint and a choice share. */
export interface BannerWidgetShapeFields {
  shape?: BannerWidgetShape;
  /** shape custom only: an SVG path in a 0..100 square */
  customPath?: string;
  iconOverride?: BannerWidgetIconOverride;
}

/** What a module says about its widget when it attaches it (all optional). */
export interface BannerWidgetHint extends BannerWidgetShapeFields {
  /** the name shown in the picker (default: the asset's name) */
  label?: string;
  icon?: string;
  /** default size (default: compact, or the widget's own shape for clocks, search bars and the like) */
  size?: BannerWidgetSize;
  show?: BannerWidgetShow;
  /** default: 5; low numbers go into the ⋯ menu first */
  priority?: number;
  hideWhenEmpty?: boolean;
  /** default: true; false keeps it on the bar whatever happens */
  overflow?: boolean;
  /** hidden until the person picks it */
  hidden?: boolean;
  /** extra words voice and search match it by ("ticker") */
  aliases?: string[];
}

/** A person's choices for one widget: only what they changed. */
export interface BannerWidgetPref extends BannerWidgetShapeFields {
  hidden?: boolean;
  size?: BannerWidgetSize;
  show?: BannerWidgetShow;
  maxWidth?: number;
  maxUnit?: BannerWidthUnit;
  priority?: number;
  hideWhenEmpty?: boolean;
  overflow?: boolean;
}
export type BannerWidgetPrefs = Record<string, BannerWidgetPref>;

/** How one widget is drawn: its hint and the person's choices folded over the defaults. */
export interface BannerWidgetView {
  hidden: boolean;
  size: BannerWidgetSize;
  show: BannerWidgetShow;
  /** the width cap, null = none */
  cap: { n: number; unit: 'space' | BannerWidthUnit } | null;
  priority: number;
  hideWhenEmpty: boolean;
  overflow: boolean;
  /** the outline it is clipped to (widget-shape@1) */
  shape: BannerWidgetShape;
  /** the path a custom shape uses; undefined for every other shape */
  customPath?: string;
  /** another pack's glyph in place of its own icon, null = its own */
  iconOverride: BannerWidgetIconOverride | null;
  /** where the shape came from: the person's pick, the module's hint, or the default (then the host's own shape token applies) */
  shapeSource: 'pick' | 'hint' | 'default';
}

const has = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A well-formed icon override: an icon-pack asset id and a glyph name. Whether both exist is the host's question (resolve time). */
export function normalizeIconOverride(raw: unknown): BannerWidgetIconOverride | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.pack !== 'string' || !PACK_ID.test(o.pack) || typeof o.id !== 'string' || !GLYPH_ID.test(o.id)) return undefined;
  return { pack: o.pack, id: o.id };
}

/** The widget-shape@1 fields of a hint or a choice, each well-formed (a path is kept here as text; its grammar is checked at resolve time). */
export function normalizeShapeFields(p: Record<string, unknown>, out: BannerWidgetShapeFields): void {
  if (has(BANNER_WIDGET_SHAPES, p.shape)) out.shape = p.shape;
  if (typeof p.customPath === 'string') { const s = p.customPath.trim(); if (s && s.length <= BANNER_WIDGET_CUSTOM_PATH.max) out.customPath = s; }
  const io = normalizeIconOverride(p.iconOverride);
  if (io) out.iconOverride = io;
}

/** One widget's saved choices with only valid fields. */
export function normalizeBannerWidgetPref(raw: unknown): BannerWidgetPref {
  const out: BannerWidgetPref = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const p = raw as Record<string, unknown>;
  normalizeShapeFields(p, out);
  if (typeof p.hidden === 'boolean') out.hidden = p.hidden;
  if (has(BANNER_WIDGET_SIZES, p.size)) out.size = p.size;
  if (has(BANNER_WIDGET_SHOWS, p.show)) out.show = p.show;
  const unit: BannerWidthUnit = has(BANNER_WIDTH_UNITS, p.maxUnit) ? p.maxUnit : 'px';
  if (num(p.maxWidth) && p.maxWidth > 0) {
    out.maxWidth = clampInt(p.maxWidth, BANNER_WIDGET_MAX_WIDTH[unit].min, BANNER_WIDGET_MAX_WIDTH[unit].max);
    out.maxUnit = unit;
  }
  if (num(p.priority)) out.priority = clampInt(p.priority, BANNER_WIDGET_PRIORITY.min, BANNER_WIDGET_PRIORITY.max);
  if (typeof p.hideWhenEmpty === 'boolean') out.hideWhenEmpty = p.hideWhenEmpty;
  if (typeof p.overflow === 'boolean') out.overflow = p.overflow;
  return out;
}

/** The saved setting with only valid entries. Anything else is dropped. */
export function normalizeBannerWidgetPrefs(raw: unknown): BannerWidgetPrefs {
  const out: BannerWidgetPrefs = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= BANNER_WIDGET_PREFS_MAX) break;
    if (!KEY.test(k)) continue;
    const p = normalizeBannerWidgetPref(v);
    if (Object.keys(p).length) { out[k] = p; n++; }
  }
  return out;
}

/**
 * widget-shape@1 migration: before the field existed every widget was a circle by implication. Every saved choice without a
 * `shape` gets `shape: 'circle'` written out, so nothing on the bar moves and a later default never changes an old widget.
 * Idempotent (a second run reports no change); a damaged setting is cleaned on the way, like every read. The runtime runs it
 * once per profile and form factor on the first read of the setting and saves the result when it changed.
 */
export function migrateBannerWidgetPrefs(raw: unknown): { prefs: BannerWidgetPrefs; changed: boolean; migrated: string[] } {
  const prefs = normalizeBannerWidgetPrefs(raw);
  const migrated: string[] = [];
  for (const [k, p] of Object.entries(prefs)) {
    if (p.shape) continue;
    prefs[k] = { ...p, shape: BANNER_WIDGET_SHAPE_DEFAULT };
    migrated.push(k);
  }
  return { prefs, changed: migrated.length > 0, migrated };
}

/** The prefs with `patch` on one widget. A field set to null or undefined goes back to the default. */
export function patchBannerWidget(prefs: BannerWidgetPrefs, key: string, patch: Record<string, unknown>): BannerWidgetPrefs {
  if (!KEY.test(key)) return { ...prefs };
  const merged: Record<string, unknown> = { ...prefs[key], ...patch };
  for (const [k, v] of Object.entries(merged)) if (v === null || v === undefined) delete merged[k];
  const next = normalizeBannerWidgetPref(merged);
  const out = { ...prefs };
  if (Object.keys(next).length) out[key] = next; else delete out[key];
  return out;
}

/** Fold a widget's hint and the person's choices over the defaults. */
export function bannerWidgetView(type: string, hint: BannerWidgetHint | null | undefined, pref: BannerWidgetPref | null | undefined): BannerWidgetView {
  const h = hint ?? {};
  const p = pref ?? {};
  const fixed = BANNER_FIXED_SHAPE.includes(type);
  const picked = has(BANNER_WIDGET_SIZES, p.size) ? p.size : has(BANNER_WIDGET_SIZES, h.size) ? h.size : null;
  const size: BannerWidgetSize = picked ?? (fixed ? 'normal' : 'compact');
  const stated = has(BANNER_WIDGET_SHOWS, p.show) ? p.show : has(BANNER_WIDGET_SHOWS, h.show) ? h.show : 'auto';
  const show: BannerWidgetShow = stated === 'auto' && size === 'icon' ? 'icon' : stated;
  const spaces = fixed && !picked ? null : BANNER_WIDGET_WIDTH[size];
  const cap: BannerWidgetView['cap'] = num(p.maxWidth) && p.maxWidth > 0 ? { n: p.maxWidth, unit: p.maxUnit ?? 'px' } : spaces === null ? null : { n: spaces, unit: 'space' };
  const priority = num(p.priority) ? p.priority : num(h.priority) ? clampInt(h.priority, BANNER_WIDGET_PRIORITY.min, BANNER_WIDGET_PRIORITY.max) : BANNER_WIDGET_PRIORITY.default;
  // widget-shape@1: the choice wins over the hint; a custom shape without a path falls back to the default at resolve time
  const shapeSource: BannerWidgetView['shapeSource'] = has(BANNER_WIDGET_SHAPES, p.shape) ? 'pick' : has(BANNER_WIDGET_SHAPES, h.shape) ? 'hint' : 'default';
  const shape: BannerWidgetShape = shapeSource === 'pick' ? p.shape! : shapeSource === 'hint' ? h.shape! : BANNER_WIDGET_SHAPE_DEFAULT;
  const customPath = shape === 'custom' ? (shapeSource === 'pick' ? p.customPath ?? h.customPath : h.customPath) : undefined;
  const iconOverride = normalizeIconOverride(p.iconOverride) ?? normalizeIconOverride(h.iconOverride) ?? null;
  return { hidden: p.hidden ?? h.hidden ?? false, size, show, cap, priority, hideWhenEmpty: p.hideWhenEmpty ?? h.hideWhenEmpty ?? false, overflow: p.overflow ?? h.overflow ?? true, shape, ...(customPath ? { customPath } : {}), iconOverride, shapeSource };
}

/* ---- widget-shape@1: a shape and an icon override compiled to tokens ---- */

/** Corner radius per shape (hexagon and custom clip instead). Circle is 50%: the same as today's 999px on the square bodies it applies to. */
export const WIDGET_SHAPE_RADIUS: Record<Exclude<BannerWidgetShape, 'hexagon' | 'custom'>, string> = { circle: '50%', square: '0', rounded: 'var(--fx-radius-md)', pill: '999px' };
/** A regular hexagon, points left and right, as a percentage polygon (scales with the body). */
export const WIDGET_SHAPE_HEXAGON_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
/** The icon token's value when the widget draws its own icon. */
export const WIDGET_ICON_OWN = 'own';
/** Points sampled along each curve when a custom path is flattened. */
export const WIDGET_SHAPE_CURVE_STEPS = 8;
const PATH_CHARS = /^[MLHVCSQTZmlhvcsqtz0-9.,\s+-]+$/;
const PATH_TOKEN = /[MLHVCSQTZmlhvcsqtz]|[-+]?(?:\d+\.?\d*|\.\d+)/g;
const PATH_ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2 };
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A custom path flattened to the corners of a polygon in the 0..box square, or null when it is not exactly one closed outline
 * drawn inside the box with the allowed commands (M L H V C S Q T Z, absolute or relative; curves are sampled). Percent
 * polygons scale with the body on every port, which a `path()` clip would not.
 */
export function flattenCustomPath(d: unknown): [number, number][] | null {
  if (typeof d !== 'string') return null;
  const s = d.trim();
  if (!s || s.length > BANNER_WIDGET_CUSTOM_PATH.max || !PATH_CHARS.test(s) || !/^[Mm]/.test(s) || !/[Zz]$/.test(s)) return null;
  const toks = s.match(PATH_TOKEN) ?? [];
  const pts: [number, number][] = [];
  let cmd = ''; let prev = ''; let moved = false;
  let x = 0, y = 0, sx = 0, sy = 0, cx = 0, cy = 0;
  const push = (px: number, py: number) => { const last = pts[pts.length - 1]; if (!last || Math.abs(last[0] - px) > 1e-6 || Math.abs(last[1] - py) > 1e-6) pts.push([px, py]); };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) => {
    for (let k = 1; k <= WIDGET_SHAPE_CURVE_STEPS; k++) { const t = k / WIDGET_SHAPE_CURVE_STEPS, u = 1 - t; push(u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3); }
    cx = x2; cy = y2; x = x3; y = y3;
  };
  const quad = (x1: number, y1: number, x2: number, y2: number) => {
    for (let k = 1; k <= WIDGET_SHAPE_CURVE_STEPS; k++) { const t = k / WIDGET_SHAPE_CURVE_STEPS, u = 1 - t; push(u * u * x + 2 * u * t * x1 + t * t * x2, u * u * y + 2 * u * t * y1 + t * t * y2); }
    cx = x1; cy = y1; x = x2; y = y2;
  };
  let i = 0;
  while (i < toks.length) {
    const t = toks[i]!;
    if (/[A-Za-z]/.test(t)) {
      cmd = t; i++;
      if (cmd === 'z' || cmd === 'Z') { if (!moved || i < toks.length) return null; x = sx; y = sy; prev = 'z'; continue; }
      if ((cmd === 'm' || cmd === 'M') && moved) return null;
      if (i >= toks.length) return null;
    } else if (!cmd) return null;
    const lower = cmd.toLowerCase();
    const n = PATH_ARITY[lower];
    if (n === undefined || i + n > toks.length) return null;
    const a = toks.slice(i, i + n).map(Number);
    if (a.some((v) => !Number.isFinite(v))) return null;
    i += n;
    const ox = cmd === lower ? x : 0, oy = cmd === lower ? y : 0;
    switch (lower) {
      case 'm': x = ox + a[0]!; y = oy + a[1]!; sx = x; sy = y; moved = true; push(x, y); cmd = cmd === lower ? 'l' : 'L'; break;
      case 'l': x = ox + a[0]!; y = oy + a[1]!; push(x, y); break;
      case 'h': x = ox + a[0]!; push(x, y); break;
      case 'v': y = oy + a[0]!; push(x, y); break;
      case 'c': cubic(ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!, ox + a[4]!, oy + a[5]!); break;
      case 's': { const rx = prev === 'c' || prev === 's' ? 2 * x - cx : x, ry = prev === 'c' || prev === 's' ? 2 * y - cy : y; cubic(rx, ry, ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!); break; }
      case 'q': quad(ox + a[0]!, oy + a[1]!, ox + a[2]!, oy + a[3]!); break;
      case 't': { const rx = prev === 'q' || prev === 't' ? 2 * x - cx : x, ry = prev === 'q' || prev === 't' ? 2 * y - cy : y; quad(rx, ry, ox + a[0]!, oy + a[1]!); break; }
    }
    prev = lower;
  }
  if (prev !== 'z') return null;
  const last = pts[pts.length - 1];
  if (pts.length > 1 && last && Math.abs(last[0] - sx) < 1e-6 && Math.abs(last[1] - sy) < 1e-6) pts.pop();
  if (pts.length < 3) return null;
  const box = BANNER_WIDGET_CUSTOM_PATH.box, slack = box * 0.005;
  if (pts.some(([px, py]) => px < -slack || py < -slack || px > box + slack || py > box + slack)) return null;
  return pts.map(([px, py]) => [round2(px), round2(py)]);
}

/** A custom path as a CSS clip (`polygon(x% y%, …)`), or null when the path is refused. */
export function customPathClip(d: unknown): string | null {
  const pts = flattenCustomPath(d);
  if (!pts) return null;
  const pct = (n: number) => `${n}%`;
  return `polygon(${pts.map(([px, py]) => `${pct(px)} ${pct(py)}`).join(', ')})`;
}

/** One widget's shape and icon as drawn: the tokens' values, what fell back and why. */
export interface ResolvedWidgetShape {
  shape: BannerWidgetShape;
  radius: string;
  clip: string;
  /** `own`, or `<pack>/<glyph>` once the pack and the glyph are known to exist */
  icon: string;
  /** every input that was refused, in plain words (empty when everything was taken as given) */
  fell: string[];
  /** false when the shape is the default: the item then leaves the host's own shape token in force */
  explicit: boolean;
}

/** Resolve a widget's view into its shape and icon. Bad input never breaks the bar: it falls back to circle / the widget's own icon and says so. */
export function resolveWidgetShape(view: Pick<BannerWidgetView, 'shape' | 'customPath' | 'iconOverride' | 'shapeSource'>, hasGlyph: (pack: string, id: string) => boolean): ResolvedWidgetShape {
  const fell: string[] = [];
  let shape = has(BANNER_WIDGET_SHAPES, view.shape) ? view.shape : BANNER_WIDGET_SHAPE_DEFAULT;
  if (shape !== view.shape) fell.push(`shape "${String(view.shape)}" is not one of ${BANNER_WIDGET_SHAPES.join(', ')}`);
  let clip = 'none';
  if (shape === 'custom') {
    const c = customPathClip(view.customPath);
    if (c) clip = c;
    else { fell.push(view.customPath ? 'the custom path is not one closed outline inside the 0..100 square' : 'a custom shape needs a path'); shape = BANNER_WIDGET_SHAPE_DEFAULT; }
  } else if (shape === 'hexagon') clip = WIDGET_SHAPE_HEXAGON_CLIP;
  const radius = shape === 'hexagon' || shape === 'custom' ? '0' : WIDGET_SHAPE_RADIUS[shape];
  let icon = WIDGET_ICON_OWN;
  const io = normalizeIconOverride(view.iconOverride);
  if (view.iconOverride && !io) fell.push('the icon override needs an icon pack id and a glyph name');
  else if (io) { if (hasGlyph(io.pack, io.id)) icon = `${io.pack}/${io.id}`; else fell.push(`icon ${io.pack}/${io.id} is not a glyph of a registered icon pack`); }
  return { shape, radius, clip, icon, fell, explicit: view.shapeSource !== 'default' };
}

/** The compiled tokens for a resolved shape, keyed by token name (web: inline on the widget's host item; Android: the same names on the Compose modifier). */
export function widgetShapeTokens(r: ResolvedWidgetShape): Record<string, string> {
  return { [BANNER_WIDGET_SHAPE_TOKENS.radius]: r.radius, [BANNER_WIDGET_SHAPE_TOKENS.clip]: r.clip, [BANNER_WIDGET_SHAPE_TOKENS.icon]: r.icon };
}

/** The tokens a host's own shape choice (customize `widgetShape`, no custom there) puts on every widget without a shape of its own. */
export function hostWidgetShapeTokens(shape: unknown): Record<string, string> {
  const s: BannerWidgetShape = has(BANNER_WIDGET_SHAPES, shape) && shape !== 'custom' ? shape : BANNER_WIDGET_SHAPE_DEFAULT;
  if (s === 'hexagon' || s === 'custom') return { [BANNER_WIDGET_SHAPE_TOKENS.radius]: '0', [BANNER_WIDGET_SHAPE_TOKENS.clip]: WIDGET_SHAPE_HEXAGON_CLIP };
  return { [BANNER_WIDGET_SHAPE_TOKENS.radius]: WIDGET_SHAPE_RADIUS[s], [BANNER_WIDGET_SHAPE_TOKENS.clip]: 'none' };
}

/** A width cap as a CSS length. */
export function bannerWidgetCapCss(cap: BannerWidgetView['cap']): string | undefined {
  if (!cap) return undefined;
  return cap.unit === 'space' ? `calc(var(--fx-space) * ${cap.n})` : `${cap.n}${cap.unit}`;
}

/** Has this widget nothing to report? Only widgets bound to a counter can be empty. */
export function bannerWidgetEmpty(type: string, data: unknown, count: (name: string) => number): boolean {
  const c = (data as { counter?: unknown } | null)?.counter;
  if (typeof c !== 'string' || !c) return false;
  if (type !== 'status' && type !== 'counter' && type !== 'progress') return false;
  const n = count(c);
  return !(typeof n === 'number' && Number.isFinite(n) && n > 0);
}

/** The number a `number` widget shows: the first whole number in its text, else its counter. */
export function bannerWidgetNumber(text: unknown, count: unknown): string {
  const m = typeof text === 'string' ? /\d[\d,]*/.exec(text) : null;
  if (m) return m[0];
  return typeof count === 'number' && Number.isFinite(count) ? String(Math.max(0, Math.floor(count))) : '';
}

export interface OverflowItem {
  key: string;
  /** width it takes on the bar, in px */
  width: number;
  priority: number;
  /** may it leave the bar? */
  overflow: boolean;
}

/**
 * Which widgets leave the bar for the ⋯ menu: nothing while everything fits, else the lowest priority first and, within
 * a priority, the last on the bar first, until the rest plus the ⋯ button fit. Widgets that may not leave stay.
 */
export function overflowWidgets(items: readonly OverflowItem[], available: number, moreWidth: number, gap: number): string[] {
  const width = (list: readonly OverflowItem[]) => list.reduce((s, i) => s + i.width, 0) + gap * Math.max(0, list.length - 1);
  if (width(items) <= available) return [];
  const order = items.map((it, i) => ({ it, i })).filter((x) => x.it.overflow).sort((a, b) => a.it.priority - b.it.priority || b.i - a.i);
  const out: string[] = [];
  let left: readonly OverflowItem[] = items;
  for (const { it } of order) {
    left = left.filter((x) => x.key !== it.key);
    out.push(it.key);
    if (width(left) + gap + moreWidth <= available) break;
  }
  return out;
}

export interface BannerWidgetQueryable { key: string; id: string; label: string; aliases?: readonly string[] }

/** Find a widget from what someone said: its key or id, else the closest name or alias ("clock", "the ticker"). */
export function findBannerWidget<T extends BannerWidgetQueryable>(list: readonly T[], query: string): T | null {
  const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const q = norm(query);
  if (!q) return null;
  const exact = list.find((w) => w.key === query || w.id === query || norm(w.id) === q || norm(w.label) === q || (w.aliases ?? []).some((a) => norm(a) === q));
  if (exact) return exact;
  return list.find((w) => norm(w.label).includes(q) || (w.aliases ?? []).some((a) => norm(a).includes(q)) || norm(w.id).includes(q)) ?? null;
}
