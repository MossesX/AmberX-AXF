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

/**
 * The hidden slots, given runtime overrides (type → hidden) and the app's defaults (`manifest.hidden`: types hidden
 * until the user shows them). An override wins over the default either way (`true` hides, `false` shows); with no
 * override the default decides. Non-hideable types are never hidden, whatever either says.
 */
export function hiddenSlots(overrides: Record<string, boolean | undefined>, defaults: readonly string[] = []): string[] {
  return hideableTypes().filter((t) => (overrides[t] === undefined ? defaults.includes(t) : overrides[t] === true));
}

/** The app's default hidden slots, cleaned: hideable types only, in schema order, no repeats. */
export function defaultHidden(manifestHidden: readonly string[] | undefined): string[] {
  return hideableTypes().filter((t) => (manifestHidden ?? []).includes(t));
}
