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
