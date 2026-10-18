package ai.amberx.axf.kernel.engine

/**
 * Spacing engine: the user's Spacing choice (Settings → Appearance → Spacing): Super tight, Compact or Regular.
 * It scales the active style theme at compile time: space, row height (never under ROW_MIN) and control height × [k], corner radii × [radiusK].
 * Regular = the style theme exactly as written; font sizes and touch targets never change.
 * Same numbers as the web reference engine (framework/core/engines/spacing.ts); fixtures in spec/fixtures/spacing.json.
 */
public enum class Spacing(public val id: String, public val label: String, public val k: Double, public val radiusK: Double) {
    TIGHT("tight", "Super tight", 0.62, 0.6),
    COMPACT("compact", "Compact", 0.8, 0.8),
    REGULAR("regular", "Regular", 1.0, 1.0);

    public companion object {
        /** Brett's default (Oct 18 2026): Super tight. */
        public val DEFAULT: Spacing = TIGHT
        /** A stored value → a valid Spacing (anything unknown or missing = the default). */
        public fun of(v: String?): Spacing = entries.firstOrNull { it.id == v } ?: DEFAULT
    }
}

public object SpacingEngine {
    /** Rows never get shorter than this (dp), so they stay tappable under any spacing (web: ROW_MIN). */
    public const val ROW_MIN: Double = 22.0

    /** A radius under a spacing choice (whole px), rounded like JavaScript's Math.round. */
    public fun radius(r: Double, s: Spacing): Double = Math.floor(r * s.radiusK + 0.5)
}
