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
 * Pure functions. Kotlin twin deferred (spec/PORTING.md); checks in spec/check-widgets.mts.
 */

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

/** What a module says about its widget when it attaches it (all optional). */
export interface BannerWidgetHint {
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
export interface BannerWidgetPref {
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
}

const has = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** One widget's saved choices with only valid fields. */
export function normalizeBannerWidgetPref(raw: unknown): BannerWidgetPref {
  const out: BannerWidgetPref = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const p = raw as Record<string, unknown>;
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
  return { hidden: p.hidden ?? h.hidden ?? false, size, show, cap, priority, hideWhenEmpty: p.hideWhenEmpty ?? h.hideWhenEmpty ?? false, overflow: p.overflow ?? h.overflow ?? true };
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
