package ai.amberx.axf.voice

/**
 * Sensitivity slider → confidence floor (pure Kotlin). The slider runs 0..1: higher = more sensitive,
 * so less certain speech gets through. The floor is the lowest confidence a final result needs:
 * `floor = 1 - sensitivity`, with the slider held to 0.05..0.95 and the floor to 0.2..0.9 so neither
 * end turns the mic deaf or lets everything through. Ported from ActiveX's VoiceDetector.
 */
public object VoiceSensitivity {
    public const val DEFAULT: Float = 0.5f
    public const val MIN_FLOOR: Float = 0.2f
    public const val MAX_FLOOR: Float = 0.9f

    /** 0.0 → 0.9, 0.5 → 0.5, 1.0 → 0.2. NaN counts as [DEFAULT]. */
    public fun confidenceFloor(sensitivity: Float): Float {
        val s = if (sensitivity.isNaN()) DEFAULT else sensitivity
        return (1f - s.coerceIn(0.05f, 0.95f)).coerceIn(MIN_FLOOR, MAX_FLOOR)
    }

    /** True when [result] should be acted on. Partial results always pass (engines don't score them). */
    public fun passes(result: VoiceResult, sensitivity: Float): Boolean =
        !result.final || result.confidence >= confidenceFloor(sensitivity)

    /** Reads a stored slider value ("0.5", "70" as percent, junk → [DEFAULT]) into 0..1. */
    public fun parse(stored: String?): Float {
        val v = stored?.trim()?.toFloatOrNull() ?: return DEFAULT
        if (v.isNaN()) return DEFAULT
        return (if (v > 1f) v / 100f else v).coerceIn(0f, 1f)
    }
}
