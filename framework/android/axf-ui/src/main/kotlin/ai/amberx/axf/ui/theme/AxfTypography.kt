package ai.amberx.axf.ui.theme

import ai.amberx.axf.kernel.engine.StyleTokens
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Resolves the CSS font-family strings of style-theme assets (`'Inter', system-ui, sans-serif`) to
 * Compose font families. The default registry maps generic families; a font-pack asset or the app
 * registers real typefaces with [register] (first family name in the CSS list that matches wins).
 */
public class FontRegistry {
    private val families = LinkedHashMap<String, FontFamily>()

    public fun register(name: String, family: FontFamily) { families[name.lowercase()] = family }
    public fun registered(): Set<String> = families.keys

    /** Walks the CSS family list; a registered name wins, otherwise the generic family decides. */
    public fun resolve(css: String): FontFamily {
        val names = css.split(',').map { it.trim().trim('\'', '"').lowercase() }.filter { it.isNotEmpty() }
        for (n in names) families[n]?.let { return it }
        for (n in names) when (n) {
            "monospace", "ui-monospace", "menlo", "consolas", "courier new", "jetbrains mono", "ibm plex mono", "fira code", "source code pro", "roboto mono" -> return FontFamily.Monospace
            "serif", "ui-serif", "georgia", "times new roman", "playfair display", "merriweather", "lora" -> return FontFamily.Serif
            "cursive", "fantasy" -> return FontFamily.Cursive
            "sans-serif", "system-ui", "ui-sans-serif", "-apple-system", "inter", "roboto", "helvetica", "arial" -> return FontFamily.SansSerif
        }
        return FontFamily.Default
    }

    public companion object { public val Default: FontRegistry = FontRegistry() }
}

/**
 * The type ladder derived from StyleTokens.typeLadder (fontSize × typeScale^n), in sp so user font
 * scaling applies. Names follow Material so the bridge is one-to-one.
 */
@Immutable
public class AxfTypography(
    public val body: FontFamily, public val display: FontFamily, public val mono: FontFamily,
    public val displayLarge: TextStyle, public val displayMedium: TextStyle, public val displaySmall: TextStyle,
    public val headlineLarge: TextStyle, public val headlineMedium: TextStyle, public val headlineSmall: TextStyle,
    public val titleLarge: TextStyle, public val titleMedium: TextStyle, public val titleSmall: TextStyle,
    public val bodyLarge: TextStyle, public val bodyMedium: TextStyle, public val bodySmall: TextStyle,
    public val labelLarge: TextStyle, public val labelMedium: TextStyle, public val labelSmall: TextStyle,
    public val code: TextStyle,
    /** the web's `.fx-eyebrow`: tiny uppercase tracked label */
    public val eyebrow: TextStyle,
    public val headingWeight: FontWeight,
) {
    public companion object {
        public fun from(st: StyleTokens, fonts: FontRegistry): AxfTypography {
            val body = fonts.resolve(st.fontFamily)
            val display = fonts.resolve(st.fontDisplay)
            val mono = fonts.resolve(st.fontMono)
            val ladder = st.typeLadder
            val hw = FontWeight(st.headingWeight.coerceIn(100, 900))
            val tracking: TextUnit = st.tracking.toFloat().em
            fun size(key: String): TextUnit = (ladder[key] ?: st.fontSize).toFloat().sp
            fun heading(key: String): TextStyle = TextStyle(fontFamily = display, fontWeight = hw, fontSize = size(key), letterSpacing = tracking, lineHeight = (size(key).value * 1.2f).sp)
            fun text(key: String, weight: FontWeight = FontWeight.Normal): TextStyle = TextStyle(fontFamily = body, fontWeight = weight, fontSize = size(key), lineHeight = (size(key).value * st.lineHeight.toFloat()).sp)
            return AxfTypography(
                body = body, display = display, mono = mono,
                displayLarge = heading("displayLarge"), displayMedium = heading("displayMedium"), displaySmall = heading("displaySmall"),
                headlineLarge = heading("headlineLarge"), headlineMedium = heading("headlineMedium"), headlineSmall = heading("headlineSmall"),
                titleLarge = heading("titleLarge"), titleMedium = heading("titleMedium"), titleSmall = TextStyle(fontFamily = display, fontWeight = hw, fontSize = size("titleSmall"), letterSpacing = tracking, lineHeight = (size("titleSmall").value * 1.25f).sp),
                bodyLarge = text("bodyLarge"), bodyMedium = text("bodyMedium"), bodySmall = text("bodySmall"),
                labelLarge = text("labelLarge", FontWeight.Medium), labelMedium = text("labelMedium", FontWeight.Medium), labelSmall = text("labelSmall", FontWeight.Medium),
                code = TextStyle(fontFamily = mono, fontSize = (st.fontSize * 0.86).toFloat().sp, lineHeight = (st.fontSize * 0.86 * 1.55).toFloat().sp),
                eyebrow = TextStyle(fontFamily = body, fontWeight = FontWeight.Bold, fontSize = (st.fontSize * 0.76).toFloat().sp, letterSpacing = 0.14f.em),
                headingWeight = hw,
            )
        }
    }
}
