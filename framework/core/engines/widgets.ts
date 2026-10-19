/**
 * Widget engine — widgets (asset types with "widget": true: clock, search bar) and the hosts that hold them.
 *
 * A host is any chrome asset with a list of attached assets: the banner (`banner.attach`, sides left / center / right,
 * also takes badges) and the toolbar (`toolbar.widgets`, sides start / end). Modules attach more at run time
 * (rt.attachToBanner / rt.attachToToolbar); a run-time entry with the same type + id replaces the host's own. Types the
 * host doesn't take, unknown sides and assets that don't exist are skipped, so a host never breaks on a missing piece.
 *
 * Pure functions, mirrored by the Kotlin kernel (engine/WidgetEngine.kt); fixtures in spec/fixtures/widgets.json.
 */

/** Widget types (asset-types.json → "widget": true). */
export const WIDGET_TYPES = ['clock', 'search-bar'] as const;
export const TOOLBAR_SIDES = ['start', 'end'] as const;

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
export const isWidgetType = (t: string) => (WIDGET_TYPES as readonly string[]).includes(t);

/** Where every attachment of a host goes, side by side (each side sorted by order, then key). */
export function placeOnHost(own: HostAttachment[] | null | undefined, extra: HostAttachment[], has: (type: string, id: string) => boolean,
  types: readonly string[], sides: readonly string[]): Record<string, PlacedAttachment[]> {
  const byKey = new Map<string, PlacedAttachment>();
  const add = (a: HostAttachment, fallbackOrder: number, origin: string) => {
    if (!a || typeof a.type !== 'string' || typeof a.id !== 'string') return;
    if (!types.includes(a.type) || !sides.includes(a.at) || !has(a.type, a.id)) return;
    const key = attachmentKey(a.type, a.id);
    const order = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : fallbackOrder;
    byKey.set(key, { key, type: a.type, id: a.id, at: a.at, order, origin: a.origin ?? origin });
  };
  (Array.isArray(own) ? own : []).forEach((a, i) => add(a, i * 10, 'asset'));
  extra.forEach((a, i) => add(a, 1000 + i * 10, 'runtime'));
  const out: Record<string, PlacedAttachment[]> = Object.fromEntries(sides.map((s) => [s, []]));
  for (const p of byKey.values()) out[p.at]!.push(p);
  for (const s of sides) out[s]!.sort((x, y) => x.order - y.order || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return out;
}

/** The toolbar as a widget host: widgets only, at its start or end. */
export function placeToolbarWidgets(tb: { widgets?: HostAttachment[] } | null | undefined, extra: HostAttachment[], has: (type: string, id: string) => boolean) {
  return placeOnHost(tb ? tb.widgets : null, tb ? extra : [], has, WIDGET_TYPES, TOOLBAR_SIDES) as Record<'start' | 'end', PlacedAttachment[]>;
}

/** Search bar width → a size in multiples of the theme's space token (UI reads it as `calc(var(--fx-space) * n)`). */
export const SEARCH_BAR_WIDTH: Record<'compact' | 'regular' | 'wide', number> = { compact: 18, regular: 30, wide: 46 };
