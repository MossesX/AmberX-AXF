/**
 * Widget engine — widgets (asset types with "widget": true: clock, search bar, logo, button, label, status, counter,
 * progress, avatar, link, theme switch, spacer, divider) and the hosts that hold them.
 *
 * A *host* is any chrome asset with a list of attached assets. The framework ships two, both declared in
 * schemas/asset-types.json (so a port, a validator and this engine all read one definition):
 *   - the banner: `banner.attach` (sides left / center / right; takes badges and every widget)
 *   - the toolbar: `toolbar.widgets` (sides start / end; widgets only)
 * Modules attach more at run time (rt.attachToHost / rt.attachToBanner / rt.attachToToolbar); a run-time entry with the
 * same type + id replaces the host's own. Types the host doesn't take, unknown sides and assets that don't exist are
 * skipped, so a host never breaks on a missing piece. Hosts are an open registry (`registerHost`): a library may make any
 * chrome asset a host without a kernel change.
 *
 * Pure functions, mirrored by the Kotlin kernel (engine/WidgetEngine.kt); fixtures in spec/fixtures/widgets.json.
 */
import spec from '../../schemas/asset-types.json';

type TypeSpecs = Record<string, { widget?: boolean; attachable?: boolean; attach?: { types?: string[]; sides?: string[] }; widgets?: { sides?: string[] } }>;
const TYPES = spec.types as unknown as TypeSpecs;

/** Widget types (asset-types.json → "widget": true), in spec order. */
export const WIDGET_TYPES: readonly string[] = Object.keys(TYPES).filter((t) => TYPES[t]!.widget === true);
/** Attachable types (asset-types.json → "attachable": true): placed on a host, never picked as a slot or rolled. */
export const ATTACHABLE_ASSET_TYPES: readonly string[] = Object.keys(TYPES).filter((t) => TYPES[t]!.attachable === true);

/** What a host takes: which asset types, on which sides, and the data field that lists them. */
export interface HostSpec {
  /** the host asset type (`banner`, `toolbar`) */
  host: string;
  /** data field holding the host's own attachments (`attach`, `widgets`) */
  field: string;
  types: readonly string[];
  sides: readonly string[];
}

const hostRegistry = new Map<string, HostSpec>();

/** Register (or replace) a host. The two framework hosts come from asset-types.json; libraries may add more. */
export function registerHost(h: HostSpec): void { hostRegistry.set(h.host, { ...h, types: [...h.types], sides: [...h.sides] }); }
export function hostSpec(host: string): HostSpec | undefined { return hostRegistry.get(host); }
export function hostSpecs(): HostSpec[] { return [...hostRegistry.values()]; }
export function isHost(type: string): boolean { return hostRegistry.has(type); }

// Framework hosts, read from the spec: an `attach` block names its types (default: every attachable type); a `widgets`
// block takes every widget type.
for (const [t, s] of Object.entries(TYPES)) {
  if (s.attach) registerHost({ host: t, field: 'attach', types: s.attach.types ?? [...ATTACHABLE_ASSET_TYPES], sides: s.attach.sides ?? [] });
  if (s.widgets) registerHost({ host: t, field: 'widgets', types: [...WIDGET_TYPES], sides: s.widgets.sides ?? [] });
}

export const TOOLBAR_SIDES: readonly string[] = hostSpec('toolbar')?.sides ?? ['start', 'end'];

export interface HostAttachment {
  type: string;
  id: string;
  at: string;
  /** Lower comes first on its side. The host's own entries default to their index × 10, run-time ones to 1000 + index × 10. */
  order?: number;
  /** Who attached it: `asset` for the host's own list, else the module / plugin id. */
  origin?: string;
}
export interface PlacedAttachment { key: string; type: string; id: string; at: string; order: number; origin: string }

export const attachmentKey = (type: string, id: string) => `${type}:${id}`;
export const isWidgetType = (t: string) => WIDGET_TYPES.includes(t);

/**
 * A person's arrangement of one host: for each attachment key (`type:id`) the side it sits on and its order there.
 * It is the top layer over the host's own list and what modules attach, so a widget dragged somewhere stays there
 * whoever attached it. Saved as a look setting (`axf.widgets.arrange.<host>`); keys that aren't attached are ignored.
 */
export type HostArrangement = Record<string, { at: string; order: number }>;

/** Most entries an arrangement keeps (a host never needs more; a damaged setting can't grow without bound). */
export const ARRANGEMENT_MAX = 200;

/** A saved arrangement with only valid entries (known side, finite order, sane key). Anything else is dropped. */
export function normalizeArrangement(raw: unknown, sides: readonly string[]): HostArrangement {
  const out: HostArrangement = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= ARRANGEMENT_MAX) break;
    if (!/^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/.test(k) || !v || typeof v !== 'object') continue;
    const e = v as { at?: unknown; order?: unknown };
    if (typeof e.at !== 'string' || !sides.includes(e.at) || typeof e.order !== 'number' || !Number.isFinite(e.order)) continue;
    out[k] = { at: e.at, order: e.order };
    n++;
  }
  return out;
}

/**
 * Move one placed attachment to `side` at position `index` (0 = first; past the end = last) and return the whole host's
 * new arrangement: every placed attachment gets its side and order (index × 10), so the result reads the same on every
 * device whatever attaches later. Entries for keys not placed now are kept (a plugin switched off keeps its spot).
 */
export function moveOnHost(placed: Record<string, PlacedAttachment[]>, prev: HostArrangement, key: string, side: string, index: number, sides: readonly string[]): HostArrangement {
  if (!sides.includes(side)) return { ...prev };
  const lists: Record<string, string[]> = Object.fromEntries(sides.map((s) => [s, (placed[s] ?? []).map((p) => p.key)]));
  if (!sides.some((s) => lists[s]!.includes(key))) return { ...prev };
  for (const s of sides) lists[s] = lists[s]!.filter((k) => k !== key);
  const at = Math.max(0, Math.min(lists[side]!.length, Math.floor(Number.isFinite(index) ? index : lists[side]!.length)));
  lists[side]!.splice(at, 0, key);
  const out: HostArrangement = { ...prev };
  for (const s of sides) lists[s]!.forEach((k, i) => { out[k] = { at: s, order: i * 10 }; });
  return out;
}

/**
 * Where a dragged item snaps among the items already on a side: the index of the first item whose middle is past the
 * pointer (`pos` and `mids` in one axis, the dragged item itself left out of `mids`). Same rule on every port.
 */
export function snapIndex(mids: readonly number[], pos: number): number {
  let i = 0;
  while (i < mids.length && mids[i]! <= pos) i++;
  return i;
}

/** Where every attachment of a host goes, side by side (each side sorted by order, then key). */
export function placeOnHost(own: HostAttachment[] | null | undefined, extra: HostAttachment[], has: (type: string, id: string) => boolean,
  types: readonly string[], sides: readonly string[], arrange?: HostArrangement | null): Record<string, PlacedAttachment[]> {
  const byKey = new Map<string, PlacedAttachment>();
  const add = (a: HostAttachment, fallbackOrder: number, origin: string) => {
    if (!a || typeof a.type !== 'string' || typeof a.id !== 'string') return;
    if (!types.includes(a.type) || !sides.includes(a.at) || !has(a.type, a.id)) return;
    const key = attachmentKey(a.type, a.id);
    const order = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : fallbackOrder;
    byKey.set(key, { key, type: a.type, id: a.id, at: a.at, order, origin: a.origin ?? origin });
  };
  (Array.isArray(own) ? own : []).forEach((a, i) => add(a, i * 10, 'asset'));
  (Array.isArray(extra) ? extra : []).forEach((a, i) => add(a, 1000 + i * 10, 'runtime'));
  if (arrange) {
    for (const [key, p] of byKey) {
      const a = arrange[key];
      if (a && sides.includes(a.at) && Number.isFinite(a.order)) byKey.set(key, { ...p, at: a.at, order: a.order });
    }
  }
  const out: Record<string, PlacedAttachment[]> = Object.fromEntries(sides.map((s) => [s, []]));
  for (const p of byKey.values()) out[p.at]!.push(p);
  for (const s of sides) out[s]!.sort((x, y) => x.order - y.order || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return out;
}

/**
 * Place attachments on a registered host from the host asset's data (its `field`) plus run-time ones.
 * With `requireHost` (the toolbar's rule) no host asset (none active, or hidden) means nothing is placed, run-time
 * entries included; without it (the banner's rule, kept from the first version) run-time entries are still placed and
 * the runtime decides whether to draw them.
 */
export function placeHost(host: string, data: Record<string, unknown> | null | undefined, extra: HostAttachment[], has: (type: string, id: string) => boolean, requireHost = true, arrange?: HostArrangement | null): Record<string, PlacedAttachment[]> {
  const h = hostSpec(host);
  if (!h) return {};
  const own = data ? (data[h.field] as HostAttachment[] | undefined) : null;
  return placeOnHost(own, data || !requireHost ? extra : [], has, h.types, h.sides, arrange);
}

/** The toolbar as a widget host: widgets only, at its start or end. */
export function placeToolbarWidgets(tb: { widgets?: HostAttachment[] } | null | undefined, extra: HostAttachment[], has: (type: string, id: string) => boolean, arrange?: HostArrangement | null) {
  return placeHost('toolbar', tb as Record<string, unknown> | null, extra, has, true, arrange) as Record<'start' | 'end', PlacedAttachment[]>;
}

/**
 * Validate a host's own attachment list (the validators call it for `banner.attach` and `toolbar.widgets`). Same
 * messages in build-engine.mjs and AssetValidator.kt. Entries the engine would only skip at run time are errors here,
 * so a mistyped asset is caught at build time instead of silently vanishing.
 */
export function validateHostAttachments(host: string, list: unknown): string[] {
  const h = hostSpec(host);
  if (!h) return [];
  if (!Array.isArray(list)) return [`data.${h.field} must be a list`];
  const errors: string[] = [];
  list.forEach((a, i) => {
    const p = `data.${h.field}[${i}]`;
    if (typeof a !== 'object' || a === null || Array.isArray(a)) { errors.push(`${p} must be an object {type, id, at}`); return; }
    const e = a as Record<string, unknown>;
    if (typeof e.type !== 'string' || !h.types.includes(e.type)) errors.push(`${p}.type must be one of: ${h.types.join(', ')}`);
    if (typeof e.id !== 'string' || !e.id) errors.push(`${p}.id must be an asset id`);
    if (typeof e.at !== 'string' || !h.sides.includes(e.at)) errors.push(`${p}.at must be one of: ${h.sides.join(', ')}`);
    if ('order' in e && (typeof e.order !== 'number' || !Number.isFinite(e.order))) errors.push(`${p}.order must be a number`);
  });
  return errors;
}

/** Search bar width → a size in multiples of the theme's space token (UI reads it as `calc(var(--fx-space) * n)`). */
export const SEARCH_BAR_WIDTH: Record<'compact' | 'regular' | 'wide', number> = { compact: 18, regular: 30, wide: 46 };
export const SEARCH_BAR_MAX_RESULTS = { min: 1, max: 50, default: 12 } as const;

/** A search bar's normalized live-search config (defaults filled, maxResults clamped). Same on every port. */
export interface SearchBarConfig { live: true; placeholder: string; maxResults: number; width: number; kinds?: string[]; shortcut: boolean }
export function searchBarConfig(d: { placeholder?: unknown; maxResults?: unknown; width?: unknown; kinds?: unknown; shortcut?: unknown } | null | undefined): SearchBarConfig {
  const n = typeof d?.maxResults === 'number' && Number.isFinite(d.maxResults) ? Math.round(d.maxResults) : SEARCH_BAR_MAX_RESULTS.default;
  const kinds = Array.isArray(d?.kinds) ? (d!.kinds as unknown[]).filter((k): k is string => typeof k === 'string' && k.length > 0) : undefined;
  return {
    live: true,
    placeholder: typeof d?.placeholder === 'string' && d.placeholder ? d.placeholder : 'Search…',
    maxResults: Math.min(SEARCH_BAR_MAX_RESULTS.max, Math.max(SEARCH_BAR_MAX_RESULTS.min, n)),
    width: SEARCH_BAR_WIDTH[d?.width as keyof typeof SEARCH_BAR_WIDTH] ?? SEARCH_BAR_WIDTH.regular,
    ...(kinds && kinds.length ? { kinds } : {}),
    shortcut: d?.shortcut !== false,
  };
}

/* ---------------- widget kinds: the pure rules every port draws from (fixtures: widgets.json → kinds) ---------------- */

export const WIDGET_TONES = ['neutral', 'success', 'warning', 'danger', 'accent', 'muted'] as const;
export type WidgetTone = typeof WIDGET_TONES[number];
/** A tone from asset data, `fallback` when it isn't one of the six. */
export function widgetTone(t: unknown, fallback: WidgetTone = 'neutral'): WidgetTone { return (WIDGET_TONES as readonly string[]).includes(t as string) ? (t as WidgetTone) : fallback; }

/** Counter widget text: "" when hidden at zero, the number, or `max+` past the cap (max defaults to 99, min 1). */
export function counterText(n: unknown, max: unknown = 99, hideAtZero: unknown = true): string {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  const cap = typeof max === 'number' && Number.isFinite(max) && max >= 1 ? Math.floor(max) : 99;
  if (v === 0 && hideAtZero !== false) return '';
  return v > cap ? `${cap}+` : String(v);
}
/** Status widget: on while the bound counter is above zero. */
export const statusOn = (count: unknown): boolean => typeof count === 'number' && Number.isFinite(count) && count > 0;
/** Progress widget: whole percent 0–100 of `n` over `max` (max ≤ 0 or not a number → 0). */
export function progressPercent(n: unknown, max: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  const m = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : 0;
  if (!m) return 0;
  return Math.min(100, Math.max(0, Math.round((v / m) * 100)));
}
/** Avatar initials: the first letter of the first two words, upper-cased; a lone word gives its first two letters; empty → "?". */
export function avatarInitials(name: unknown): string {
  const words = (typeof name === 'string' ? name : '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}
/** Link widget: the address it may open (https, http, mailto, tel; trimmed), else null (the widget is not drawn). */
export function linkHref(href: unknown): string | null {
  const h = typeof href === 'string' ? href.trim() : '';
  return /^(https?:\/\/[^\s/?#]+[^\s]*|mailto:[^\s@]+@[^\s]+|tel:\+?[0-9().\- ]{3,})$/i.test(h) ? h : null;
}
/** Spacer widget: gap in multiples of the space token; -1 = flex (push what follows to the other end). */
export const SPACER_UNITS: Record<'small' | 'regular' | 'large' | 'flex', number> = { small: 1, regular: 2, large: 4, flex: -1 };
export function spacerUnits(size: unknown): number { return SPACER_UNITS[size as keyof typeof SPACER_UNITS] ?? SPACER_UNITS.regular; }
/** Logo widget size: font scale for text/icon logos and the image height in px. */
export const LOGO_SIZE: Record<'small' | 'regular' | 'large', { scale: number; px: number }> = { small: { scale: 0.85, px: 16 }, regular: { scale: 1, px: 20 }, large: { scale: 1.25, px: 28 } };
export function logoSize(size: unknown): { scale: number; px: number } { return LOGO_SIZE[size as keyof typeof LOGO_SIZE] ?? LOGO_SIZE.regular; }
/** Avatar widget size in px. */
export const AVATAR_SIZE: Record<'small' | 'regular' | 'large', number> = { small: 18, regular: 24, large: 32 };
export function avatarSize(size: unknown): number { return AVATAR_SIZE[size as keyof typeof AVATAR_SIZE] ?? AVATAR_SIZE.regular; }
/** Progress widget width in multiples of the space token. */
export const PROGRESS_WIDTH: Record<'compact' | 'regular' | 'wide', number> = { compact: 8, regular: 14, wide: 24 };
export function progressWidth(w: unknown): number { return PROGRESS_WIDTH[w as keyof typeof PROGRESS_WIDTH] ?? PROGRESS_WIDTH.regular; }
/** Theme switch: the color theme to swap to from the active one (dark while light is active or neither; light while dark is). */
export function themeSwitchNext(active: unknown, light: unknown, dark: unknown): string { return active === dark ? String(light) : String(dark); }
/** Image address a logo/avatar may show: https, http, data:image or an app path (starts with / or ./), else null. */
export function imageSrc(src: unknown): string | null {
  const s = typeof src === 'string' ? src.trim() : '';
  return /^(https?:\/\/[^\s]+|data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+|\.?\/[^\s]*)$/i.test(s) ? s : null;
}
