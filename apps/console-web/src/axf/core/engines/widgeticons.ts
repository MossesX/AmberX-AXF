/**
 * Widget icons (Brett, Nov 16 2026: "let me change the icon of any banner/toolbar widget"). Any widget attached to a
 * host (banner, toolbar, and any host added later) may be given another icon by the person: Change icon… in the
 * widget's right-click / long-press menu and in its settings opens the icon picker, which lists the framework's icons
 * and every glyph of every icon pack (icon-pack@1). The pick is an override on that one widget instance, laid over the
 * asset's own `icon` when it is drawn (the asset itself is never changed), so Reset puts the asset's icon back.
 *
 * Saved as one look setting per app (`axf.banners.icons.<app>`, under the banner prefix, so it travels in the app's
 * look document on axHub like every other banner choice): `{ "<host>/<type:id>": "<icon name>" }`.
 *
 * Reached the same way from everywhere: the runtime action `widget.icon:<host>:<widget>:<icon|reset>` (console action
 * REST / MCP console tools / `axf console action` / AmberX voice) and `widget.icon.pick:<host>:<widget>` (opens the
 * picker; also the deep link). Pure functions. Kotlin twin deferred (spec/PORTING.md).
 */

/** The setting prefix; the app id follows. */
export const WIDGET_ICONS_SETTING_PREFIX = 'axf.banners.icons.';
/** Hosts a widget can sit on: lower-case ids, open so a new host needs no change here. */
const HOST = /^[a-z][a-z0-9-]{0,31}$/;
/** A widget key `type:id` (engines/bannerwidgets.ts). */
const WIDGET = /^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$/;
/** An icon name: the framework's names and icon-pack glyph names share this pattern. */
const ICON = /^[a-z0-9][a-z0-9-]{0,47}$/;
/** Most overrides kept (a damaged setting can't grow without bound). */
export const WIDGET_ICONS_MAX = 200;

export type WidgetIcons = Record<string, string>;

/** The setting one app's overrides live in. */
export function widgetIconsSetting(app: string): string {
  const id = String(app ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'app';
  return `${WIDGET_ICONS_SETTING_PREFIX}${id}`;
}

/** The key of one widget on one host: `banner/clock:main`; '' when either part is not valid. */
export function widgetIconKey(host: unknown, widget: unknown): string {
  return typeof host === 'string' && HOST.test(host) && typeof widget === 'string' && WIDGET.test(widget) ? `${host}/${widget}` : '';
}

/** A key split back into host and widget, or null. */
export function parseWidgetIconKey(key: string): { host: string; widget: string } | null {
  const i = typeof key === 'string' ? key.indexOf('/') : -1;
  if (i < 1) return null;
  const host = key.slice(0, i), widget = key.slice(i + 1);
  return widgetIconKey(host, widget) ? { host, widget } : null;
}

/** Is this a usable icon name? */
export function isIconName(v: unknown): v is string {
  return typeof v === 'string' && ICON.test(v);
}

/** The saved setting with only valid entries. */
export function normalizeWidgetIcons(raw: unknown): WidgetIcons {
  const out: WidgetIcons = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (n >= WIDGET_ICONS_MAX) break;
    if (parseWidgetIconKey(k) && isIconName(v)) { out[k] = v; n++; }
  }
  return out;
}

/** The overrides with one widget's icon set (`null` / '' = back to the asset's own icon). Invalid input changes nothing. */
export function setWidgetIcon(icons: WidgetIcons, host: string, widget: string, icon: string | null): WidgetIcons {
  const key = widgetIconKey(host, widget);
  if (!key) return { ...icons };
  const out = { ...icons };
  if (icon === null || icon === '') delete out[key];
  else if (isIconName(icon)) out[key] = icon;
  return normalizeWidgetIcons(out);
}

/** The icon one widget draws: the person's override, else the asset's own (undefined = none). */
export function widgetIconOf(icons: WidgetIcons, host: string, widget: string, own?: string | null): string | undefined {
  const key = widgetIconKey(host, widget);
  return (key && icons[key]) || (own ?? undefined) || undefined;
}

/**
 * Every icon name the picker offers: the framework's own names, then each icon pack's glyph names (a pack glyph of a
 * framework name is the same entry: the pack draws it). Sorted, no duplicates; `pack` lists which packs carry each.
 */
export function iconChoices(framework: readonly string[], packs: readonly { id: string; name?: string; glyphs?: Record<string, unknown> }[]): { name: string; packs: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const n of framework) if (isIconName(n)) by.set(n, by.get(n) ?? new Set());
  for (const p of packs) for (const n of Object.keys(p.glyphs ?? {})) if (isIconName(n)) (by.get(n) ?? by.set(n, new Set()).get(n)!).add(p.id);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, s]) => ({ name, packs: [...s].sort() }));
}
