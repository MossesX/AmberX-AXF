package ai.amberx.axf.ui.theme

import ai.amberx.axf.kernel.engine.StyleTokens
import ai.amberx.axf.kernel.engine.ThemeTokens
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** The radius ladder (xs/sm/md/lg/xl/full) as Compose shapes. */
@Immutable
public class AxfShapes(public val xs: Dp, public val sm: Dp, public val md: Dp, public val lg: Dp, public val xl: Dp) {
    public val xsShape: Shape get() = RoundedCornerShape(xs)
    public val smShape: Shape get() = RoundedCornerShape(sm)
    public val mdShape: Shape get() = RoundedCornerShape(md)
    public val lgShape: Shape get() = RoundedCornerShape(lg)
    public val xlShape: Shape get() = RoundedCornerShape(xl)
    public val full: Shape get() = RoundedCornerShape(50)
    /** Shape for an explicit radius in dp (component styles hand out resolved numbers; 999 = pill). */
    public fun of(radiusDp: Double): Shape = if (radiusDp >= 999.0) full else RoundedCornerShape(radiusDp.dp)
    public companion object {
        public fun from(st: StyleTokens): AxfShapes = AxfShapes(st.radiusXs.dp, st.radiusSm.dp, st.radiusMd.dp, st.radiusLg.dp, st.radiusXl.dp)
    }
}

/** Spacing in multiples of the style theme's density-scaled `space` unit (web: `calc(var(--fx-space) * n)`). */
@Immutable
public class AxfSpacing(public val unit: Dp, public val borderWidth: Dp, public val rowHeight: Dp, public val controlHeight: Dp, public val touchTarget: Dp, public val iconSize: Dp, public val densityK: Float, public val blur: Dp) {
    public fun x(n: Double): Dp = (unit.value * n).toFloat().dp
    public fun x(n: Int): Dp = x(n.toDouble())
    public val half: Dp get() = x(0.5)
    public val one: Dp get() = unit
    public val oneHalf: Dp get() = x(1.5)
    public val two: Dp get() = x(2)
    public val three: Dp get() = x(3)
    public val four: Dp get() = x(4)
    public companion object {
        public fun from(st: StyleTokens): AxfSpacing = AxfSpacing(st.space.dp, st.borderWidth.dp, st.rowHeight.dp, st.controlHeight.dp, st.touchTarget.dp, st.iconSize.dp, st.densityK.toFloat(), st.blur.dp)
    }
}

/** Motion tokens: `motion` ms + easing name from the style theme. The web multiplies the base by 1.4–1.8 for overlays. */
@Immutable
public class AxfMotion(public val baseMs: Int, public val easing: Easing, public val springStiffness: Float, public val springDamping: Float) {
    public val fast: Int get() = (baseMs * 0.7).toInt().coerceAtLeast(1)
    public val normal: Int get() = baseMs.coerceAtLeast(1)
    public val slow: Int get() = (baseMs * 1.6).toInt().coerceAtLeast(1)
    public val overlay: Int get() = (baseMs * 1.8).toInt().coerceAtLeast(1)
    public companion object {
        public fun from(st: StyleTokens): AxfMotion = AxfMotion(
            st.motionMs,
            when (st.easing.lowercase()) {
                "linear" -> LinearEasing
                "decelerate", "emphasized-decelerate" -> LinearOutSlowInEasing
                "overshoot", "spring" -> CubicBezierEasing(0.2f, 0.9f, 0.3f, 1.2f)
                "sheet" -> CubicBezierEasing(0.2f, 0.8f, 0.2f, 1f)
                else -> FastOutSlowInEasing
            },
            st.springStiffness.toFloat(), st.springDamping.toFloat(),
        )
    }
}

/** Everything the compiled tokens become in Compose. Built once per `Compiled.rev` and provided through [LocalAxfTheme]. */
@Immutable
public class AxfTheme(
    public val tokens: ThemeTokens,
    public val colors: AxfColors,
    public val typography: AxfTypography,
    public val shapes: AxfShapes,
    public val spacing: AxfSpacing,
    public val motion: AxfMotion,
) {
    public val style: StyleTokens get() = tokens.style
    public val isDark: Boolean get() = tokens.isDark
    public val opacityDisabled: Float get() = style.opacityDisabled.toFloat()
    public val opacityMuted: Float get() = style.opacityMuted.toFloat()
    /** Elevation in dp for a 0..5 level from the style theme ladder. */
    public fun elevation(level: Int): Dp = style.elevationLevels.getOrElse(level.coerceAtLeast(0)) { style.elevationLevels.last() }.dp

    public companion object {
        public fun from(tokens: ThemeTokens, fonts: FontRegistry = FontRegistry.Default): AxfTheme {
            val st = tokens.style
            return AxfTheme(tokens, AxfColors.from(tokens), AxfTypography.from(st, fonts), AxfShapes.from(st), AxfSpacing.from(st), AxfMotion.from(st))
        }
    }
}

public val LocalAxfTheme: androidx.compose.runtime.ProvidableCompositionLocal<AxfTheme> = compositionLocalOf { error("No AxfTheme provided — wrap the tree in AxfRoot or AxfThemeProvider") }

/** Shorthand accessors mirroring `MaterialTheme.colorScheme` etc. */
public object Axf {
    public val theme: AxfTheme @Composable get() = LocalAxfTheme.current
    public val colors: AxfColors @Composable get() = LocalAxfTheme.current.colors
    public val type: AxfTypography @Composable get() = LocalAxfTheme.current.typography
    public val shapes: AxfShapes @Composable get() = LocalAxfTheme.current.shapes
    public val space: AxfSpacing @Composable get() = LocalAxfTheme.current.spacing
    public val motion: AxfMotion @Composable get() = LocalAxfTheme.current.motion
}

/**
 * Provides [LocalAxfTheme] and a MaterialTheme derived from the same tokens, so Material 3 widgets used
 * inside an AXF app (text fields, switches, menus) pick up the hot-swapped palette automatically.
 */
@Composable
public fun AxfThemeProvider(tokens: ThemeTokens, fonts: FontRegistry = FontRegistry.Default, content: @Composable () -> Unit) {
    val theme = remember(tokens, fonts) { AxfTheme.from(tokens, fonts) }
    val scheme = remember(theme) { theme.toColorScheme() }
    val typography = remember(theme) { theme.toMaterialTypography() }
    val shapes = remember(theme) { theme.toMaterialShapes() }
    CompositionLocalProvider(LocalAxfTheme provides theme) {
        MaterialTheme(colorScheme = scheme, typography = typography, shapes = shapes, content = content)
    }
}

/* ---------- Material 3 bridge ---------- */

public fun AxfTheme.toColorScheme(): ColorScheme {
    val c = colors
    val base = if (isDark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = c.accent, onPrimary = c.accentText, primaryContainer = c.accentSoft, onPrimaryContainer = c.accent,
        inversePrimary = c.accentPressed,
        secondary = c.accent2, onSecondary = c.accent2Text, secondaryContainer = c.surface3, onSecondaryContainer = c.text,
        tertiary = c.info, onTertiary = c.onInfo, tertiaryContainer = c.infoSoft, onTertiaryContainer = c.info,
        background = c.bg, onBackground = c.text,
        surface = c.surface, onSurface = c.text, surfaceVariant = c.surface2, onSurfaceVariant = c.muted, surfaceTint = c.accent,
        inverseSurface = c.inverseSurface, inverseOnSurface = c.inverseText,
        error = c.danger, onError = c.onDanger, errorContainer = c.dangerSoft, onErrorContainer = c.danger,
        outline = c.outline, outlineVariant = c.outlineVariant, scrim = c.scrim,
        surfaceBright = c.surface3, surfaceDim = c.bg, surfaceContainer = c.surface, surfaceContainerLow = c.surface, surfaceContainerLowest = c.bg,
        surfaceContainerHigh = c.surface2, surfaceContainerHighest = c.surface3,
    )
}

public fun AxfTheme.toMaterialTypography(): Typography {
    val t = typography
    return Typography(
        displayLarge = t.displayLarge, displayMedium = t.displayMedium, displaySmall = t.displaySmall,
        headlineLarge = t.headlineLarge, headlineMedium = t.headlineMedium, headlineSmall = t.headlineSmall,
        titleLarge = t.titleLarge, titleMedium = t.titleMedium, titleSmall = t.titleSmall,
        bodyLarge = t.bodyLarge, bodyMedium = t.bodyMedium, bodySmall = t.bodySmall,
        labelLarge = t.labelLarge, labelMedium = t.labelMedium, labelSmall = t.labelSmall,
    )
}

public fun AxfTheme.toMaterialShapes(): Shapes = Shapes(
    extraSmall = RoundedCornerShape(shapes.xs), small = RoundedCornerShape(shapes.sm), medium = RoundedCornerShape(shapes.md),
    large = RoundedCornerShape(shapes.lg), extraLarge = RoundedCornerShape(shapes.xl),
)

/** Body text style with the theme's text color applied (most components start from this). */
public val AxfTheme.bodyText: TextStyle get() = typography.bodyMedium.copy(color = colors.text)
