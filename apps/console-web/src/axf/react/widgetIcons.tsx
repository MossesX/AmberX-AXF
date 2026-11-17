/*
 * Widget icons at run time (widget-icons@1, spec/WIDGET-ICONS.md): what every host (banner, settings) uses to draw a
 * widget's icon, and what the picker, the actions, REST, MCP, the CLI and voice use to read and change it.
 *
 *   widgetIconMap(rt)                the icon world: framework glyphs, every icon-pack asset and its glyphs, the pack in force
 *   resolveWidget(rt, input)         resolveWidgetIcon with the person's two keys, the threshold token and the defaults map
 *   useWidgetIcon(input)             the same as a hook (redraws on any settings change)
 *   setWidgetIcon / setWidgetMode / resetWidgetIcon   write the two appearance keys
 *   widgetIconsSeen(rt)              every widget a host resolved in this session (widget.icons.list)
 *   WidgetGlyph                      draws a ref: `<glyph>` through Icon, `<pack>/<glyph>` from that pack
 */
import { normalizeIconPack } from '../core/engines/brand';
import { widgetDefaultIcon, widgetDefaultRows } from '../core/engines/widget-icon-defaults';
import {
  WIDGET_ICON_MODES, WIDGET_TEXT_MAX_TOKEN, parseIconRef, parseWidgetIconId, resolveWidgetIcon, widgetIconKey, widgetIconSettings, widgetModeKey,
  type ResolvedWidgetIcon, type WidgetIconInput, type WidgetIconMap, type WidgetIconMode,
} from '../core/engines/widget-icons';
import type { AxfRuntime } from '../core/runtime';
import { useAxfState, useRuntime } from './AxfProvider';
import { ICON_NAMES, Icon } from './components/Icon';

/** The picker dialog (console_open target `dialog:axf.widget.icons`, props `{ widget }`). */
export const WIDGET_ICONS_DIALOG = 'axf.widget.icons';

/** The icon world as this runtime sees it. */
export function widgetIconMap(rt: AxfRuntime): WidgetIconMap {
  const packs: Record<string, string[]> = {};
  for (const a of rt.registry.list('icon-pack' as never) as { id: string; data: unknown }[]) packs[a.id] = Object.keys(normalizeIconPack(a.data).glyphs);
  const inForce = rt.skinIconPack() || rt.branding()?.iconPack || undefined;
  return { glyphs: ICON_NAMES, packs, ...(inForce ? { pack: inForce } : {}), fallback: 'box' };
}

/** The value of --fx-size-widget-text-max where the document is, else nothing (the engine's default). */
function textMaxToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return getComputedStyle(document.documentElement).getPropertyValue(WIDGET_TEXT_MAX_TOKEN).trim() || undefined;
}

export interface SeenWidget { id: string; label: string; resolved: ResolvedWidgetIcon }
const seen = new WeakMap<AxfRuntime, Map<string, SeenWidget>>();
const seenOf = (rt: AxfRuntime) => { let m = seen.get(rt); if (!m) { m = new Map(); seen.set(rt, m); } return m; };

/** resolveWidgetIcon with this runtime's settings and icon world; a widget with no icon of its own gets its default. */
export function resolveWidget(rt: AxfRuntime, input: WidgetIconInput & { name?: string }): ResolvedWidgetIcon {
  const own = input.icon && parseIconRef(input.icon) && ICON_NAMES.includes(input.icon) ? input.icon : widgetDefaultIcon(input.id) ?? input.icon;
  const r = resolveWidgetIcon({ ...input, icon: own }, widgetIconSettings((k) => rt.settings.get(k), input.id, textMaxToken()), widgetIconMap(rt));
  seenOf(rt).set(input.id, { id: input.id, label: input.name || (typeof input.text === 'string' ? input.text : '') || input.id, resolved: r });
  return r;
}

/** The hook form: redraws on any settings change (a pick by picker, API or voice shows at once). */
export function useWidgetIcon(input: WidgetIconInput & { name?: string }): ResolvedWidgetIcon {
  const rt = useRuntime();
  useAxfState();
  return resolveWidget(rt, input);
}

/** Every widget resolved in this session, plus every inventoried one not drawn yet (resolved without its live text). */
export function widgetIconsSeen(rt: AxfRuntime): SeenWidget[] {
  const out = new Map(seenOf(rt));
  for (const row of widgetDefaultRows()) if (!out.has(row.id)) out.set(row.id, { id: row.id, label: row.label, resolved: resolveWidget(rt, { id: row.id, kind: parseWidgetIconId(row.id)?.kind, name: row.label }) });
  return [...out.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Pick an icon (`<glyph>`, `<pack>/<glyph>`, `own`). Returns the refusal in plain words, or null when saved. */
export function setWidgetIcon(rt: AxfRuntime, id: string, ref: string): string | null {
  if (!parseWidgetIconId(id)) return `"${id}" is not a widget id (<host>:<kind>:<id>)`;
  if (ref === 'own' || ref === '') { rt.settings.set(widgetIconKey(id), null); return null; }
  const parsed = parseIconRef(ref);
  if (!parsed) return `"${ref}" is not an icon ref`;
  const map = widgetIconMap(rt);
  if (parsed.pack ? !map.packs?.[parsed.pack]?.includes(parsed.glyph) : !(map.glyphs ?? []).includes(parsed.glyph) && !(map.pack && map.packs?.[map.pack]?.includes(parsed.glyph))) return `no icon "${ref}"`;
  rt.settings.set(widgetIconKey(id), parsed.pack ? `${parsed.pack}/${parsed.glyph}` : parsed.glyph);
  return null;
}

/** How it is drawn: `icon`, `icon+text`, `text` or `auto` (the long-text rule). */
export function setWidgetMode(rt: AxfRuntime, id: string, mode: string): string | null {
  if (!parseWidgetIconId(id)) return `"${id}" is not a widget id (<host>:<kind>:<id>)`;
  if (mode === 'auto' || mode === '') { rt.settings.set(widgetModeKey(id), null); return null; }
  if (!(WIDGET_ICON_MODES as readonly string[]).includes(mode)) return `mode must be one of auto, ${WIDGET_ICON_MODES.join(', ')}`;
  rt.settings.set(widgetModeKey(id), mode as WidgetIconMode);
  return null;
}

/** Back to its default icon and the long-text rule. */
export function resetWidgetIcon(rt: AxfRuntime, id: string): void {
  rt.settings.set(widgetIconKey(id), null);
  rt.settings.set(widgetModeKey(id), null);
}

/** Draws a resolved ref: `<glyph>` through Icon (the pack in force applies), `<pack>/<glyph>` from that pack. */
export function WidgetGlyph({ icon, size = 14 }: { icon: string; size?: number }) {
  return <Icon name={icon} size={size} />;
}

/* ---------------- actions and the context menu (installed once per runtime from AppShell) ---------------- */

const installed = new WeakSet<AxfRuntime>();
const MODE_ITEMS: [string, string][] = [['icon', 'Icon only'], ['icon+text', 'Icon and text'], ['text', 'Text only'], ['auto', 'Automatic']];

/** `<host>:<kind>:<id>` spans three action args; whatever follows is the value (an icon ref may hold a colon too). */
export function splitWidgetArgs(args: readonly string[]): { id: string; value: string } {
  return { id: args.slice(0, 3).join(':'), value: args.slice(3).join(':') };
}

/** The context menu entries for one widget: Choose icon… and Show as (icon / icon+text / text / automatic). */
export function widgetIconMenu(rt: AxfRuntime, id: string, label: string): import('../core/engines/windows').MenuEntry[] {
  const mode = String(rt.settings.get(widgetModeKey(id)) ?? '') || 'auto';
  return [
    { id: `widget-icon-${id}`, label: `Choose icon… (${label})`, icon: 'star', action: `widget.icons:${id}` },
    { id: `widget-mode-${id}`, label: 'Show as', icon: 'type', items: MODE_ITEMS.map(([m, l]) => ({ id: `widget-mode-${id}-${m}`, label: l, icon: m === mode ? 'check' : undefined, action: `widget.mode:${id}:${m}` })) },
  ];
}

export function installWidgetIcons(rt: AxfRuntime, module: string): void {
  if (installed.has(rt)) return;
  installed.add(rt);
  const bad = (msg: string | null) => { if (msg) rt.toast(msg, 'warning', 'Widget icon'); return !msg; };
  rt.actions.withModule(module, () => {
    rt.actions.register('widget.icons', (args) => { const { id } = splitWidgetArgs(args); rt.openDialog(WIDGET_ICONS_DIALOG, id ? { widget: id } : {}); }, { label: 'Widget icons: choose the icon of a banner or settings widget (widget.icons[:<widget id>])', params: true });
    rt.actions.register('widget.icon', (args) => { const { id, value } = splitWidgetArgs(args); bad(setWidgetIcon(rt, id, value || 'own')); }, { label: 'Set a widget\'s icon (widget.icon:<widget id>:<glyph | pack/glyph | own>)', params: true, searchable: false });
    rt.actions.register('widget.mode', (args) => { const { id, value } = splitWidgetArgs(args); bad(setWidgetMode(rt, id, value || 'auto')); }, { label: 'Show a widget as icon, icon+text, text or auto (widget.mode:<widget id>:<mode>)', params: true, searchable: false });
    rt.actions.register('widget.icons.reset', (args) => {
      const { id } = splitWidgetArgs(args);
      if (id) { if (bad(parseWidgetIconId(id) ? null : `"${id}" is not a widget id`)) resetWidgetIcon(rt, id); return; }
      for (const w of widgetIconsSeen(rt)) resetWidgetIcon(rt, w.id);
    }, { label: 'Put a widget\'s icon back to its default (widget.icons.reset[:<widget id>]; no id = every widget)', params: true });
  });
  // Right-click a banner widget: Choose icon… and Show as, after Widget settings
  rt.contextExtras.set('*:widget-icons', (target) => {
    if (target !== 'banner' || !rt.contextBannerWidget) return [];
    const hit = rt.bannerWidgets().find((w) => w.key === rt.contextBannerWidget);
    return hit ? widgetIconMenu(rt, `banner:${hit.key}`, hit.label) : [];
  });
}
