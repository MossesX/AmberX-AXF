/**
 * Spacing engine — the user's Spacing choice (Settings → Appearance → Spacing): Super tight, Compact or Regular.
 * It scales the active style theme at compile time, so every theme and every component follows (nothing is hard-coded):
 *   space, row height (never under ROW_MIN) and Android's control height × SPACING_K, corner radii × SPACING_RADIUS_K.
 * Regular = the style theme exactly as written. Font sizes and touch targets never change.
 * Same numbers in the Kotlin kernel (engine/SpacingEngine.kt); fixtures in spec/fixtures/spacing.json.
 */
export type Spacing = 'tight' | 'compact' | 'regular';

/** In the order the switch shows them. */
export const SPACINGS: readonly Spacing[] = ['tight', 'compact', 'regular'];
/** Brett's default (Oct 18 2026): Super tight. */
export const SPACING_DEFAULT: Spacing = 'tight';
export const SPACING_LABEL: Record<Spacing, string> = { tight: 'Super tight', compact: 'Compact', regular: 'Regular' };
export const SPACING_K: Record<Spacing, number> = { tight: 0.62, compact: 0.8, regular: 1 };
export const SPACING_RADIUS_K: Record<Spacing, number> = { tight: 0.6, compact: 0.8, regular: 1 };

/** Rows never get shorter than this (px), so they stay tappable on a phone under any spacing. */
export const ROW_MIN = 22;

/** A stored value → a valid Spacing (anything unknown or missing = the default). */
export function spacingOf(v: unknown): Spacing {
  return typeof v === 'string' && (SPACINGS as readonly string[]).includes(v) ? (v as Spacing) : SPACING_DEFAULT;
}

/** A radius under a spacing choice (whole px). */
export function spacedRadius(r: number, s: Spacing): number {
  return Math.round(r * SPACING_RADIUS_K[s]);
}
