package ai.amberx.axf.ui.theme

import ai.amberx.axf.kernel.asset.ColorTokens
import ai.amberx.axf.kernel.engine.Rgba
import ai.amberx.axf.kernel.engine.ThemeTokens
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * Every color token of the active color-theme as a Compose [Color]. One property per token in
 * [ColorTokens.CORE] + [ColorTokens.EXTENDED]; [get] looks a token up by its asset name.
 * Nothing in axf-ui uses a literal color: it all comes from here.
 */
@Immutable
public class AxfColors(public val tokens: Map<String, Color>, public val isDark: Boolean) {
    private fun t(name: String): Color = tokens[name] ?: Color.Magenta

    /* core */
    public val bg: Color get() = t("bg")
    public val surface: Color get() = t("surface")
    public val surface2: Color get() = t("surface2")
    public val surface3: Color get() = t("surface3")
    public val text: Color get() = t("text")
    public val muted: Color get() = t("muted")
    public val border: Color get() = t("border")
    public val accent: Color get() = t("accent")
    public val accentText: Color get() = t("accentText")
    public val accentSoft: Color get() = t("accentSoft")
    public val danger: Color get() = t("danger")
    public val success: Color get() = t("success")
    public val warning: Color get() = t("warning")
    public val info: Color get() = t("info")
    public val focus: Color get() = t("focus")
    public val shadow: Color get() = t("shadow")

    /* extended (derived by ThemeEngine when the asset does not author them) */
    public val accentHover: Color get() = t("accentHover")
    public val accentPressed: Color get() = t("accentPressed")
    public val accent2: Color get() = t("accent2")
    public val accent2Text: Color get() = t("accent2Text")
    public val link: Color get() = t("link")
    public val selection: Color get() = t("selection")
    public val overlay: Color get() = t("overlay")
    public val scrim: Color get() = t("scrim")
    public val inverseSurface: Color get() = t("inverseSurface")
    public val inverseText: Color get() = t("inverseText")
    public val dangerSoft: Color get() = t("dangerSoft")
    public val successSoft: Color get() = t("successSoft")
    public val warningSoft: Color get() = t("warningSoft")
    public val infoSoft: Color get() = t("infoSoft")
    public val onDanger: Color get() = t("onDanger")
    public val onSuccess: Color get() = t("onSuccess")
    public val onWarning: Color get() = t("onWarning")
    public val onInfo: Color get() = t("onInfo")
    public val outline: Color get() = t("outline")
    public val outlineVariant: Color get() = t("outlineVariant")
    public val disabledBg: Color get() = t("disabledBg")
    public val disabledText: Color get() = t("disabledText")
    public val placeholder: Color get() = t("placeholder")
    public val divider: Color get() = t("divider")
    public val tooltipBg: Color get() = t("tooltipBg")
    public val tooltipText: Color get() = t("tooltipText")
    public val codeBg: Color get() = t("codeBg")
    public val codeText: Color get() = t("codeText")
    public val navBg: Color get() = t("navBg")
    public val navText: Color get() = t("navText")
    public val navActive: Color get() = t("navActive")
    public val toolbarBg: Color get() = t("toolbarBg")
    public val statusBg: Color get() = t("statusBg")
    public val chart1: Color get() = t("chart1")
    public val chart2: Color get() = t("chart2")
    public val chart3: Color get() = t("chart3")
    public val chart4: Color get() = t("chart4")
    public val chart5: Color get() = t("chart5")
    public val chart6: Color get() = t("chart6")
    public val gradientStart: Color get() = t("gradientStart")
    public val gradientEnd: Color get() = t("gradientEnd")
    public val glassTint: Color get() = t("glassTint")

    /** Token by asset name (`accentSoft`), or null when the theme has no such token. */
    public operator fun get(token: String): Color? = tokens[token]

    /** Semantic color for a toast/chip tone. */
    public fun tone(kind: String): Color = when (kind.lowercase()) { "success" -> success; "warning" -> warning; "danger" -> danger; "accent" -> accent; else -> info }
    public fun toneSoft(kind: String): Color = when (kind.lowercase()) { "success" -> successSoft; "warning" -> warningSoft; "danger" -> dangerSoft; "accent" -> accentSoft; else -> infoSoft }

    public companion object {
        public fun from(tokens: ThemeTokens): AxfColors {
            val map = LinkedHashMap<String, Color>()
            for (name in ColorTokens.ALL) map[name] = tokens.rgba[name]?.toColor() ?: fallbackFor(name, tokens)
            for ((k, v) in tokens.rgba) if (k !in map) map[k] = v.toColor()
            return AxfColors(map, tokens.isDark)
        }

        /** Tokens with unparseable values (e.g. `var(--x)`) still need a Color; fall back to a sensible core token. */
        private fun fallbackFor(name: String, t: ThemeTokens): Color {
            val core = when {
                name.startsWith("on") -> "accentText"
                name.endsWith("Soft") -> "accentSoft"
                name.endsWith("Bg") -> "surface2"
                name.endsWith("Text") -> "text"
                name.startsWith("chart") -> "accent"
                else -> "accent"
            }
            return t.rgba[core]?.toColor() ?: if (t.isDark) Color.White else Color.Black
        }
    }
}

public fun Rgba.toColor(): Color = Color(r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255), (a.coerceIn(0.0, 1.0) * 255).toInt())
