/**
 * Hide engine — which slots may be hidden, and which are hidden now.
 *
 * Data-driven from schemas/asset-types.json: a type with `"hideable": true` (the chrome types: app-menu,
 * toolbar, nav-menu, context-menu) gets a Hidden choice. While hidden its chrome is not drawn — the layout
 * engine drops its region (compileLayout(l, hidden)) and a hidden context menu leaves the platform's own
 * menu — and randomize rolls skip it. Themes, layouts, controls and the access policy are never hideable:
 * there would be nothing to draw with.
 *
 * Pure; the Kotlin kernel mirrors it as HideEngine (fixtures: spec/fixtures/hide.json, layout-slots.json).
 */
import spec from '../../schemas/asset-types.json';

const types = spec.types as Record<string, { hideable?: boolean }>;

/** May this slot be hidden? */
export function hideable(type: string): boolean {
  return types[type]?.hideable === true;
}

/** Every hideable type, in schema order. */
export function hideableTypes(): string[] {
  return Object.keys(types).filter(hideable);
}

/** The hidden slots, given runtime overrides (type → hidden). Non-hideable types are never hidden. */
export function hiddenSlots(overrides: Record<string, boolean | undefined>): string[] {
  return hideableTypes().filter((t) => overrides[t] === true);
}
