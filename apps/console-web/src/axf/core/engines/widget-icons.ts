/**
 * Widget icons engine (widget-icons@1, spec/WIDGET-ICONS.md): the icon and the display mode of every banner and settings
 * widget, picked by the person, and the rule that turns a long string of text into an icon with the text as a tooltip.
 *
 * Brett (Nov 17 2026): "allows me to select icons for all the widgets in the banner; some don't even have icons, just big
 * long strings of text; and the settings too."
 *
 *   parseWidgetIconId(id)                      `<host>:<kind>:<id>` → its parts, or null (hosts are a registry, append-only)
 *   widgetIconKey(id) / widgetModeKey(id)       the two settings keys, `axf.widget.<id>.icon` and `.mode` (appearance settings)
 *   parseIconRef(ref)                          `<glyph>`, `<pack>/<glyph>`, `pack:<pack>/<glyph>` or `own` → { pack, glyph }
 *   longTextThreshold(value)                   the value of --fx-size-widget-text-max (sizing@1 widget.textMax) → a number in range
 *   isLongText(text, max)                      more code points than `max` once the whitespace is collapsed
 *   resolveWidgetIcon(widget, settings, map)   → { icon, via, label, tooltip, mode, fell }
 *
 * Pure: no DOM, no runtime; the same on every port. Golden fixture spec/fixtures/widget-icons.json, replayed by
 * spec/check-widget-icons.mts. Kotlin twin deferred (Android on hold, spec/PORTING.md).
 */
import { SCALE_FIELDS, scaleToken } from './scale-rules.mjs';

export const WIDGET_ICONS_FRAME = 'widget-icons@1';

/** How a widget is drawn. `auto` (unset) lets the long-text rule decide. */
export const WIDGET_ICON_MODES = ['icon', 'icon+text', 'text'] as const;
export type WidgetIconMode = typeof WIDGET_ICON_MODES[number];
/** The ref that means "the widget's own icon" (clears a pick). */
export const WIDGET_ICON_OWN = 'own';
/** Every `axf.widget.*` key is an appearance setting (engines/designpackage.ts), so it travels in the app's look document. */
export const WIDGET_ICON_SETTING_PREFIX = 'axf.widget.';
/** The glyph drawn when nothing in the chain resolves and the icon map names no fallback. */
export const WIDGET_ICON_FALLBACK = 'box';

/** The sizing@1 token the long-text threshold is read from, and its range. */
export const WIDGET_TEXT_MAX_TOKEN: string = scaleToken('sizing', 'widget.textMax');
const TEXT_MAX_FIELD = (SCALE_FIELDS as Record<string, Record<string, [number, number, number, string]>>).sizing!['widget.textMax']!;
export const WIDGET_TEXT_MAX = { default: TEXT_MAX_FIELD[0], min: TEXT_MAX_FIELD[1], max: TEXT_MAX_FIELD[2] } as const;

/* ---------------- widget ids ---------------- */

const HOSTS: string[] = ['banner', 'toolbar', 'settings'];
/** Hosts whose widgets carry a pick. Append-only; `registerWidgetIconHost` opens a new one. */
export const WIDGET_ICON_HOSTS: readonly string[] = HOSTS;
const HOST_ID = /^[a-z0-9-]{1,40}$/;
export const WIDGET_ICON_ID = /^([a-z0-9-]{1,40}):([a-z0-9-]{1,40}):([A-Za-z0-9._-]{1,80})$/;

export interface WidgetIconIdParts { host: string; kind: string; id: string }

/** Open a host (a plugin host, a nav rail) so its widgets may carry picks. */
export function registerWidgetIconHost(host: string): void {
  if (HOST_ID.test(host) && !HOSTS.includes(host)) HOSTS.push(host);
}

/** `<host>:<kind>:<id>` → its parts, or null when it is not a widget id or the host is not registered. */
export function parseWidgetIconId(raw: unknown): WidgetIconIdParts | null {
  if (typeof raw !== 'string') return null;
  const m = WIDGET_ICON_ID.exec(raw);
  if (!m || !HOSTS.includes(m[1]!)) return null;
  return { host: m[1]!, kind: m[2]!, id: m[3]! };
}

/** The widget id of a banner widget: its banner widget key (`<type>:<id>`, engines/bannerwidgets.ts) under the banner host. */
export const bannerWidgetIconId = (key: string): string => `banner:${key}`;
/** The widget id of a settings tab, group or row. */
export const settingsWidgetIconId = (kind: 'tab' | 'group' | 'setting', id: string): string => `settings:${kind}:${id}`;

export const widgetIconKey = (id: string): string => `${WIDGET_ICON_SETTING_PREFIX}${id}.icon`;
export const widgetModeKey = (id: string): string => `${WIDGET_ICON_SETTING_PREFIX}${id}.mode`;

/* ---------------- icon refs ---------------- */

/** An icon-pack asset id (the icon-pack@1 grammar) and a glyph name. */
export const WIDGET_ICON_PACK_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
export const WIDGET_ICON_GLYPH_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PACK_PREFIX = 'pack:';

export interface WidgetIconRef { pack: string | null; glyph: string }

/** `<glyph>`, `<pack>/<glyph>`, `pack:<pack>/<glyph>` or `own` → { pack, glyph }; anything else is null. */
export function parseIconRef(raw: unknown): WidgetIconRef | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (s.startsWith(PACK_PREFIX)) s = s.slice(PACK_PREFIX.length);
  const i = s.indexOf('/');
  if (i < 0) return WIDGET_ICON_GLYPH_ID.test(s) ? { pack: null, glyph: s } : null;
  const pack = s.slice(0, i);
  const glyph = s.slice(i + 1);
  return WIDGET_ICON_PACK_ID.test(pack) && WIDGET_ICON_GLYPH_ID.test(glyph) ? { pack, glyph } : null;
}

/** A ref as the renderer takes it: `<glyph>` or `<pack>/<glyph>`. */
export const formatIconRef = (ref: WidgetIconRef): string => (ref.pack ? `${ref.pack}/${ref.glyph}` : ref.glyph);

/* ---------------- long text ---------------- */

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** The threshold from the token's value (`24`, `"24"`, `"24ch"`), clamped into range; anything else is the default. */
export function longTextThreshold(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value.trim()) : Number.NaN;
  return Number.isFinite(n) ? clampInt(n, WIDGET_TEXT_MAX.min, WIDGET_TEXT_MAX.max) : WIDGET_TEXT_MAX.default;
}

/** The words a widget shows, trimmed with the whitespace collapsed; anything but a string is nothing. */
export function widgetText(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/** Is this more than `max` code points of text once collapsed? */
export function isLongText(text: unknown, max: number): boolean {
  return [...widgetText(text)].length > max;
}

/* ---------------- kind defaults ---------------- */

const KIND_ICONS: Record<string, string> = {
  status: 'info', counter: 'chart', progress: 'chart', 'action-button': 'zap', link: 'external', label: 'type', badge: 'bell',
  logo: 'star', avatar: 'user', clock: 'clock', 'search-bar': 'search', 'theme-switch': 'sun',
  tab: 'folder', group: 'list', setting: 'sliders',
};
/** The icon a widget of a kind gets when it has none of its own. Open: `registerWidgetKindIcon` adds a kind. */
export const WIDGET_KIND_ICONS: Readonly<Record<string, string>> = KIND_ICONS;

export function registerWidgetKindIcon(kind: string, glyph: string): void {
  if (HOST_ID.test(kind) && WIDGET_ICON_GLYPH_ID.test(glyph)) KIND_ICONS[kind] = glyph;
}

/* ---------------- resolution ---------------- */

/** The icon world as the runtime sees it (shaped so icon-map@1 plugs straight in). Every field optional. */
export interface WidgetIconMap {
  /** the framework's own glyph names */
  glyphs?: readonly string[];
  /** icon-pack asset id → the glyph names it holds */
  packs?: Readonly<Record<string, readonly string[]>>;
  /** the pack in force at this scope (`axf.icons.pack.<scope>`) */
  pack?: string;
  /** icon-map@1 slot id → the pinned ref */
  slots?: Readonly<Record<string, string>>;
  /** what an unknown glyph draws */
  fallback?: string;
}

/** What the host knows about one widget. */
export interface WidgetIconInput {
  /** `<host>:<kind>:<id>` */
  id: string;
  kind?: string;
  /** the words it shows right now */
  text?: unknown;
  /** its own icon hint */
  icon?: string;
  /** widget-shape@1 `{ pack, id }`, when the shapes build is in */
  iconOverride?: unknown;
  /** its icon-map@1 slot id, when its owner declared one */
  slot?: string;
  /** its own tooltip */
  tooltip?: string;
  /** the host's own display setting (a banner widget's `show`, folded with `modeFromBannerShow`) */
  defaultMode?: WidgetIconMode | 'auto';
}

/** The two keys read for the widget plus the threshold token's value. */
export interface WidgetIconSettings { icon?: unknown; mode?: unknown; textMax?: unknown }

export const WIDGET_ICON_VIAS = ['pick', 'override', 'slot', 'own', 'kind', 'fallback'] as const;
export type WidgetIconVia = typeof WIDGET_ICON_VIAS[number];

export interface ResolvedWidgetIcon {
  /** `<glyph>` or `<pack>/<glyph>`, always something to draw */
  icon: string;
  via: WidgetIconVia;
  /** the text to draw next to the icon (empty in icon mode) */
  label: string;
  /** what hover / long-press shows: the full text whenever it is hidden or clipped */
  tooltip: string;
  mode: WidgetIconMode;
  /** every refused input, in plain words */
  fell: string[];
}

const has = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly unknown[]).includes(v);
const given = (v: unknown) => v !== undefined && v !== null && v !== '';

/** Read the widget's two keys from a settings getter, with the token's value for the threshold. */
export function widgetIconSettings(get: (key: string) => unknown, id: string, textMax?: unknown): WidgetIconSettings {
  return { icon: get(widgetIconKey(id)), mode: get(widgetModeKey(id)), textMax };
}

/** A banner widget's `show` choice as this contract's mode. */
export function modeFromBannerShow(show: unknown): WidgetIconMode | 'auto' {
  switch (show) {
    case 'both': return 'icon+text';
    case 'icon': return 'icon';
    case 'text': case 'number': return 'text';
    default: return 'auto';
  }
}

/** Does the ref name a glyph that exists? The drawable ref, or why not. */
function lookupRef(ref: WidgetIconRef, map: WidgetIconMap): { icon: string } | { error: string } {
  if (ref.pack) {
    const pack = map.packs?.[ref.pack];
    if (!pack) return { error: `icon pack "${ref.pack}" is not registered` };
    if (!pack.includes(ref.glyph)) return { error: `icon "${ref.pack}/${ref.glyph}" is not a glyph of that pack` };
    return { icon: formatIconRef(ref) };
  }
  const inForce = map.pack ? map.packs?.[map.pack] : undefined;
  if (inForce?.includes(ref.glyph) || map.glyphs?.includes(ref.glyph)) return { icon: ref.glyph };
  return { error: `icon "${ref.glyph}" is not a glyph of the icon pack in force or the framework` };
}

/**
 * The icon, mode, label and tooltip of one widget. The icon is the first source that resolves: the person's pick, the
 * widget-shape@1 override, the icon-map slot pin, the widget's own icon, its kind's default, the fallback glyph. Bad
 * input never breaks a host: it is skipped and named in `fell`.
 */
export function resolveWidgetIcon(widget: WidgetIconInput, settings: WidgetIconSettings | null | undefined, map: WidgetIconMap | null | undefined): ResolvedWidgetIcon {
  const s = settings ?? {};
  const m = map ?? {};
  const fell: string[] = [];
  const parts = parseWidgetIconId(widget.id);
  if (!parts) fell.push(`"${String(widget.id)}" is not a widget id (<host>:<kind>:<id>)`);
  let icon: string | null = null;
  let via: WidgetIconVia = 'fallback';
  const take = (ref: WidgetIconRef, source: WidgetIconVia) => {
    const r = lookupRef(ref, m);
    if ('icon' in r) { icon = r.icon; via = source; } else fell.push(r.error);
  };

  // 1. the pick (only a real widget id can have been read for)
  if (parts && given(s.icon)) {
    const ref = parseIconRef(s.icon);
    if (!ref) fell.push(`icon "${String(s.icon)}" is not an icon ref`);
    else if (ref.pack || ref.glyph !== WIDGET_ICON_OWN) take(ref, 'pick');
  }
  // 2. widget-shape@1 iconOverride
  if (!icon && given(widget.iconOverride)) {
    const o = widget.iconOverride as Record<string, unknown>;
    const ref = o && typeof o === 'object' && !Array.isArray(o) && typeof o.pack === 'string' && typeof o.id === 'string' ? parseIconRef(`${o.pack}/${o.id}`) : null;
    if (!ref || !ref.pack) fell.push('the icon override needs an icon pack id and a glyph name');
    else take(ref, 'override');
  }
  // 3. the icon-map slot pin
  if (!icon && typeof widget.slot === 'string' && widget.slot) {
    const pin = m.slots?.[widget.slot];
    if (pin !== undefined) {
      const ref = parseIconRef(pin);
      if (!ref) fell.push(`slot pin "${String(pin)}" is not an icon ref`);
      else take(ref, 'slot');
    }
  }
  // 4. the widget's own icon
  if (!icon && typeof widget.icon === 'string' && widget.icon.trim()) {
    const ref = parseIconRef(widget.icon);
    if (!ref) fell.push(`icon "${widget.icon}" is not an icon ref`);
    else take(ref, 'own');
  }
  // 5. the kind's default, 6. the fallback
  if (!icon && widget.kind && KIND_ICONS[widget.kind]) { icon = KIND_ICONS[widget.kind]!; via = 'kind'; }
  if (!icon) { icon = typeof m.fallback === 'string' && WIDGET_ICON_GLYPH_ID.test(m.fallback) ? m.fallback : WIDGET_ICON_FALLBACK; via = 'fallback'; }

  // the mode: the pick, else the host's own display setting, else the long-text rule
  const max = longTextThreshold(s.textMax);
  const text = widgetText(widget.text);
  const long = isLongText(text, max);
  let picked: WidgetIconMode | 'auto' = 'auto';
  if (parts && given(s.mode)) {
    if (has(WIDGET_ICON_MODES, s.mode)) picked = s.mode;
    else fell.push(`mode "${String(s.mode)}" is not one of ${WIDGET_ICON_MODES.join(', ')}`);
  }
  if (picked === 'auto' && has(WIDGET_ICON_MODES, widget.defaultMode)) picked = widget.defaultMode;
  const mode: WidgetIconMode = picked !== 'auto' ? picked : !text || long ? 'icon' : 'icon+text';
  const own = typeof widget.tooltip === 'string' ? widget.tooltip.trim() : '';
  const label = mode === 'icon' ? '' : text;
  const tooltip = mode === 'icon' ? text || own : long ? text : own;
  return { icon, via, label, tooltip, mode, fell };
}
