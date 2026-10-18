package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.ColorTheme
import ai.amberx.axf.kernel.asset.ColorTokens
import ai.amberx.axf.kernel.asset.Scheme
import ai.amberx.axf.kernel.asset.StyleTheme

/** A parsed color: 0..255 channels + alpha 0..1. Platform-agnostic so the kernel never imports a graphics type. */
public data class Rgba(val r: Int, val g: Int, val b: Int, val a: Double = 1.0) {
    public fun withAlpha(alpha: Double): Rgba = copy(a = alpha.coerceIn(0.0, 1.0))
    public fun mix(other: Rgba, t: Double): Rgba = Rgba(
        (r + (other.r - r) * t).toInt(), (g + (other.g - g) * t).toInt(), (b + (other.b - b) * t).toInt(), a + (other.a - a) * t,
    )
    public val luminance: Double get() = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0
    public val isLight: Boolean get() = luminance > 0.55
    public fun toHex(): String = buildString {
        append('#')
        for (c in listOf(r, g, b)) append(c.coerceIn(0, 255).toString(16).padStart(2, '0'))
        if (a < 1.0) append((a * 255).toInt().coerceIn(0, 255).toString(16).padStart(2, '0'))
    }
    public fun toCss(): String = if (a >= 1.0) toHex() else "rgba($r,$g,$b,${"%.3f".format(a).trimEnd('0').trimEnd('.')})"

    public companion object {
        public val BLACK: Rgba = Rgba(0, 0, 0)
        public val WHITE: Rgba = Rgba(255, 255, 255)
        private val rgba = Regex("rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*(?:,\\s*([\\d.]+)\\s*)?\\)")

        /** Parses #rgb, #rgba, #rrggbb, #rrggbbaa and rgb()/rgba(). Returns null for anything else (keywords, var()). */
        public fun parse(s: String?): Rgba? {
            if (s == null) return null
            val t = s.trim()
            if (t.startsWith("#")) {
                val h = t.drop(1)
                return when (h.length) {
                    3, 4 -> Rgba(h[0].dup(), h[1].dup(), h[2].dup(), if (h.length == 4) h[3].dup() / 255.0 else 1.0)
                    6, 8 -> Rgba(h.substring(0, 2).toInt(16), h.substring(2, 4).toInt(16), h.substring(4, 6).toInt(16), if (h.length == 8) h.substring(6, 8).toInt(16) / 255.0 else 1.0)
                    else -> null
                }
            }
            val m = rgba.find(t) ?: return null
            val (r, g, b) = m.groupValues.drop(1).take(3).map { it.toDouble().toInt() }
            return Rgba(r, g, b, m.groupValues[4].toDoubleOrNull() ?: 1.0)
        }
        private fun Char.dup(): Int = "$this$this".toInt(16)
    }
}

/** Resolved style numbers every port reads. Values are in density-independent px (dp on Android). */
public data class StyleTokens(
    val fontFamily: String, val fontDisplay: String, val fontMono: String,
    val fontSize: Double, val lineHeight: Double, val typeScale: Double, val headingWeight: Int, val tracking: Double,
    val radiusXs: Double, val radiusSm: Double, val radiusMd: Double, val radiusLg: Double, val radiusXl: Double,
    val space: Double, val densityK: Double, val rowHeight: Double, val controlHeight: Double, val touchTarget: Double, val iconSize: Double,
    val borderWidth: Double, val motionMs: Int, val blur: Double, val elevationLevels: List<Int>,
    val shadowSm: String, val shadowMd: String, val shadowLg: String,
    val opacityDisabled: Double, val opacityMuted: Double, val opacityHover: Double, val opacityTint: Double, val opacityScrim: Double, val opacityGlass: Double, val easing: String, val springStiffness: Double, val springDamping: Double, val glass: Boolean,
    /** style-theme wrapGroups (build option --wrap-groups): every titled group gets a collapse toggle. */
    val wrapGroups: Boolean = false,
) {
    /** The type scale ladder (label, body, title, headline, display) derived from fontSize and typeScale. */
    public val typeLadder: Map<String, Double> get() = mapOf(
        "labelSmall" to fontSize / typeScale / typeScale, "labelMedium" to fontSize / typeScale, "labelLarge" to fontSize,
        "bodySmall" to fontSize / typeScale, "bodyMedium" to fontSize, "bodyLarge" to fontSize * typeScale,
        "titleSmall" to fontSize * typeScale, "titleMedium" to fontSize * typeScale * typeScale, "titleLarge" to fontSize * typeScale * typeScale * typeScale,
        "headlineSmall" to fontSize * Math.pow(typeScale, 3.0), "headlineMedium" to fontSize * Math.pow(typeScale, 4.0), "headlineLarge" to fontSize * Math.pow(typeScale, 5.0),
        "displaySmall" to fontSize * Math.pow(typeScale, 5.0), "displayMedium" to fontSize * Math.pow(typeScale, 6.0), "displayLarge" to fontSize * Math.pow(typeScale, 7.0),
    )
    /** Spacing ladder in multiples of `space`, density-scaled. */
    public fun space(n: Double): Double = space * n
}

/** Everything the theme engine produces. Pure data; axf-ui maps it to a Compose theme, the web port to CSS variables. */
public data class ThemeTokens(
    val scheme: Scheme,
    /** every color token, CORE + EXTENDED, as raw strings (hex/rgba) */
    val colors: Map<String, String>,
    /** the same colors parsed; keys with unparseable values are absent */
    val rgba: Map<String, Rgba>,
    val style: StyleTokens,
    /** CSS custom-property view (`--fx-*`), identical to the web port's output, for WebView-hosted AXF apps */
    val cssVars: Map<String, String>,
) {
    public fun color(token: String): Rgba? = rgba[token]
    public val isDark: Boolean get() = scheme == Scheme.DARK
}

/**
 * Theme engine — turns color-theme and style-theme assets into tokens. Everything visual reads these
 * tokens, so swapping a theme asset restyles the whole app without recomposing structure (HotSwapTier.LIVE).
 * Extended tokens missing from the asset are derived from the core ones so every theme has the full vocabulary.
 */
public object ThemeEngine {
    /** [spacing] = the user's Spacing choice (SpacingEngine); REGULAR compiles the theme exactly as written. */
    public fun compile(color: ColorTheme, style: StyleTheme, spacing: Spacing = Spacing.REGULAR): ThemeTokens {
        val colors = LinkedHashMap<String, String>()
        for (t in ColorTokens.CORE) colors[t] = color.tokens[t] ?: fallback(t, color)
        for ((k, v) in color.tokens) if (k !in colors) colors[k] = v
        derive(colors, color.scheme, style)
        val rgba = colors.mapNotNull { (k, v) -> Rgba.parse(v)?.let { k to it } }.toMap()
        val st = styleTokens(style, spacing)
        return ThemeTokens(color.scheme, colors, rgba, st, cssVars(colors, style, st))
    }

    private fun fallback(token: String, c: ColorTheme): String {
        val dark = c.scheme == Scheme.DARK
        return when (token) {
            "bg" -> if (dark) "#111111" else "#f5f5f5"
            "surface" -> if (dark) "#191919" else "#ffffff"
            "surface2" -> c.tokens["surface"] ?: if (dark) "#202020" else "#f7f7f7"
            "surface3" -> c.tokens["surface2"] ?: if (dark) "#2a2a2a" else "#ececec"
            "text" -> if (dark) "#f2f2f2" else "#161616"
            "muted" -> if (dark) "#a0a0a0" else "#666666"
            "border" -> if (dark) "#333333" else "#dddddd"
            "accent" -> "#f5a524"
            "accentText" -> "#1a1206"
            "accentSoft" -> "rgba(245,165,36,0.14)"
            "danger" -> "#e5484d"; "success" -> "#30a46c"; "warning" -> "#f5c451"; "info" -> "#3b82f6"
            "focus" -> c.tokens["accent"] ?: "#f5a524"
            "shadow" -> if (dark) "rgba(0,0,0,0.5)" else "rgba(0,0,0,0.12)"
            else -> "#808080"
        }
    }

    /** Derives EXTENDED tokens that the theme did not author. Authored values always win. */
    private fun derive(c: MutableMap<String, String>, scheme: Scheme, st: StyleTheme) {
        val dark = scheme == Scheme.DARK
        val accent = Rgba.parse(c["accent"]) ?: Rgba(245, 165, 36)
        val text = Rgba.parse(c["text"]) ?: if (dark) Rgba.WHITE else Rgba.BLACK
        val bg = Rgba.parse(c["bg"]) ?: if (dark) Rgba.BLACK else Rgba.WHITE
        val surface = Rgba.parse(c["surface"]) ?: bg
        val border = Rgba.parse(c["border"]) ?: text.withAlpha(0.15)
        fun put(k: String, v: () -> String) { if (c[k] == null) c[k] = v() }
        put("accentHover") { accent.mix(if (dark) Rgba.WHITE else Rgba.BLACK, 0.12).toCss() }
        put("accentPressed") { accent.mix(if (dark) Rgba.WHITE else Rgba.BLACK, 0.24).toCss() }
        put("accent2") { c["info"] ?: accent.toCss() }
        put("accent2Text") { c["accentText"] ?: "#ffffff" }
        put("link") { c["info"] ?: accent.toCss() }
        put("selection") { accent.withAlpha(0.28).toCss() }
        put("overlay") { (if (dark) Rgba.WHITE else Rgba.BLACK).withAlpha(st.opacityHover).toCss() }
        put("scrim") { Rgba.BLACK.withAlpha(st.opacityScrim).toCss() }
        put("inverseSurface") { text.toCss() }
        put("inverseText") { bg.toCss() }
        for (s in listOf("danger", "success", "warning", "info")) {
            val base = Rgba.parse(c[s]) ?: accent
            put("${s}Soft") { base.withAlpha(st.opacityTint).toCss() }
            put("on${s.replaceFirstChar { it.uppercase() }}") { if (base.isLight) "#1a1206" else "#ffffff" }
        }
        put("outline") { border.toCss() }
        put("outlineVariant") { border.withAlpha(0.6).toCss() }
        put("disabledBg") { text.withAlpha(0.08).toCss() }
        put("disabledText") { text.withAlpha(st.opacityDisabled).toCss() }
        put("placeholder") { c["muted"] ?: text.withAlpha(0.5).toCss() }
        put("divider") { border.toCss() }
        put("tooltipBg") { text.toCss() }
        put("tooltipText") { bg.toCss() }
        put("codeBg") { (Rgba.parse(c["surface2"]) ?: surface).toCss() }
        put("codeText") { text.toCss() }
        put("navBg") { surface.toCss() }
        put("navText") { c["muted"] ?: text.toCss() }
        put("navActive") { accent.toCss() }
        put("toolbarBg") { surface.toCss() }
        put("statusBg") { (Rgba.parse(c["surface2"]) ?: surface).toCss() }
        val chart = listOf(accent, Rgba.parse(c["info"]) ?: accent, Rgba.parse(c["success"]) ?: accent, Rgba.parse(c["warning"]) ?: accent, Rgba.parse(c["danger"]) ?: accent, accent.mix(text, 0.5))
        chart.forEachIndexed { i, v -> put("chart${i + 1}") { v.toCss() } }
        put("gradientStart") { accent.toCss() }
        put("gradientEnd") { (Rgba.parse(c["info"]) ?: accent.mix(text, 0.3)).toCss() }
        put("glassTint") { surface.withAlpha(st.opacityGlass).toCss() }
    }

    public fun styleTokens(s: StyleTheme, spacing: Spacing = Spacing.REGULAR): StyleTokens {
        val d = s.density.k * spacing.k
        fun r(v: Int) = SpacingEngine.radius(v.toDouble(), spacing)
        return StyleTokens(
            fontFamily = s.fontFamily, fontDisplay = s.fontDisplay, fontMono = s.fontMono,
            fontSize = s.fontSize.toDouble(), lineHeight = s.lineHeight, typeScale = s.typeScale, headingWeight = s.headingWeight, tracking = s.tracking,
            radiusXs = r(s.radius.xs), radiusSm = r(s.radius.sm), radiusMd = r(s.radius.md), radiusLg = r(s.radius.lg), radiusXl = r(s.radius.xl),
            space = Math.round(s.space * d * 10) / 10.0, densityK = d, rowHeight = maxOf(SpacingEngine.ROW_MIN, Math.round(34 * d).toDouble()), controlHeight = Math.round(s.controlHeight * d).toDouble(),
            touchTarget = s.touchTarget.toDouble(), iconSize = s.iconSize.toDouble(),
            borderWidth = s.borderWidth.toDouble(), motionMs = s.motion, blur = s.blur.toDouble(), elevationLevels = s.elevationLevels,
            shadowSm = s.shadow.sm, shadowMd = s.shadow.md, shadowLg = s.shadow.lg,
            opacityDisabled = s.opacityDisabled, opacityMuted = s.opacityMuted,
            opacityHover = s.opacityHover, opacityTint = s.opacityTint, opacityScrim = s.opacityScrim, opacityGlass = s.opacityGlass, easing = s.easing, springStiffness = s.springStiffness, springDamping = s.springDamping, glass = s.glass,
            wrapGroups = s.wrapGroups,
        )
    }

    private fun kebab(s: String) = s.replace(Regex("[A-Z]")) { "-" + it.value.lowercase() }

    /** Same `--fx-*` variables the web port's theme.ts emits (plus extended tokens), for WebView-hosted apps and the devtools. */
    public fun cssVars(colors: Map<String, String>, s: StyleTheme, st: StyleTokens): Map<String, String> {
        val v = LinkedHashMap<String, String>()
        for ((k, c) in colors) v["--fx-${kebab(k)}"] = c
        v["--fx-font"] = s.fontFamily; v["--fx-font-display"] = s.fontDisplay; v["--fx-font-mono"] = s.fontMono
        v["--fx-font-size"] = "${s.fontSize}px"
        v["--fx-radius-sm"] = "${jsNum(st.radiusSm)}px"; v["--fx-radius-md"] = "${jsNum(st.radiusMd)}px"; v["--fx-radius-lg"] = "${jsNum(st.radiusLg)}px"
        v["--fx-space"] = "${jsNum(st.space)}px"; v["--fx-border-w"] = "${s.borderWidth}px"
        v["--fx-shadow-sm"] = s.shadow.sm; v["--fx-shadow-md"] = s.shadow.md; v["--fx-shadow-lg"] = s.shadow.lg
        v["--fx-motion"] = "${s.motion}ms"; v["--fx-blur"] = "${s.blur}px"
        v["--fx-heading-weight"] = s.headingWeight.toString(); v["--fx-tracking"] = "${jsNum(s.tracking)}em"
        v["--fx-row-h"] = "${st.rowHeight.toInt()}px"; v["--fx-density-k"] = jsNum(st.densityK)
        v["--fx-opacity-disabled"] = jsNum(s.opacityDisabled); v["--fx-opacity-muted"] = jsNum(s.opacityMuted)
        v["--fx-opacity-hover"] = jsNum(s.opacityHover); v["--fx-opacity-tint"] = jsNum(s.opacityTint)
        v["--fx-opacity-scrim"] = jsNum(s.opacityScrim); v["--fx-opacity-glass"] = jsNum(s.opacityGlass)
        v["--fx-wrap-groups"] = if (s.wrapGroups) "1" else "0"
        return v
    }
}

/** Formats a number the way JavaScript `String(n)` does (no trailing `.0`), so cssVars match the reference engine byte for byte. */
internal fun jsNum(d: Double): String = if (d == Math.floor(d) && !d.isInfinite()) d.toLong().toString() else d.toString()
