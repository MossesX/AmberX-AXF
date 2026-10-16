package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.asset.Fill
import ai.amberx.axf.kernel.engine.ButtonStyle
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.ui.theme.AxfColors
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em

/** Web `fx-btn--primary|neutral|danger|ghost`. */
public enum class ButtonTone { PRIMARY, NEUTRAL, DANGER, GHOST }

/** Resolved visuals for one (fill, tone) pair — background brush, foreground, ring. Public so galleries can preview every combination. */
public class ButtonVisual(public val background: Brush?, public val foreground: Color, public val ring: Color?, public val ringWidth: Dp)

public fun buttonVisual(colors: AxfColors, fill: Fill, tone: ButtonTone, borderWidth: Dp): ButtonVisual {
    val none: Brush? = null
    fun solid(c: Color): Brush = Brush.linearGradient(listOf(c, c))
    return when (tone) {
        ButtonTone.GHOST -> ButtonVisual(none, colors.text, null, 0.dp)
        else -> when (fill) {
            Fill.SOLID, Fill.NONE -> when (tone) {
                ButtonTone.PRIMARY -> ButtonVisual(solid(colors.accent), colors.accentText, null, 0.dp)
                ButtonTone.DANGER -> ButtonVisual(solid(colors.danger), colors.onDanger, null, 0.dp)
                else -> ButtonVisual(solid(colors.surface2), colors.text, colors.border, borderWidth)
            }
            Fill.SOFT -> when (tone) {
                ButtonTone.PRIMARY -> ButtonVisual(solid(colors.accentSoft), colors.accent, null, 0.dp)
                ButtonTone.DANGER -> ButtonVisual(solid(colors.dangerSoft), colors.danger, null, 0.dp)
                else -> ButtonVisual(solid(colors.surface3), colors.text, null, 0.dp)
            }
            Fill.OUTLINE -> when (tone) {
                ButtonTone.PRIMARY -> ButtonVisual(none, colors.accent, colors.accent, 1.5.dp)
                ButtonTone.DANGER -> ButtonVisual(none, colors.danger, colors.danger, 1.5.dp)
                else -> ButtonVisual(none, colors.text, colors.muted.copy(alpha = 0.55f), 1.5.dp)
            }
            Fill.GRADIENT -> when (tone) {
                ButtonTone.PRIMARY -> ButtonVisual(Brush.linearGradient(listOf(colors.accent, colors.info)), colors.accentText, null, 0.dp)
                ButtonTone.DANGER -> ButtonVisual(Brush.linearGradient(listOf(colors.danger, colors.warning)), colors.onDanger, null, 0.dp)
                else -> ButtonVisual(Brush.verticalGradient(listOf(colors.surface2, colors.surface3)), colors.text, colors.border, borderWidth)
            }
        }
    }
}

/**
 * The button, styled by the active `button` asset through [ButtonStyle] (fill, shape, size, weight,
 * uppercase, elevation). `requires` gates it through UAC: HIDE renders nothing, DISABLE greys it with a lock.
 * `style` lets galleries render a variant other than the active one.
 */
@Composable
public fun AxfButton(
    text: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tone: ButtonTone = ButtonTone.NEUTRAL,
    icon: String? = null,
    requires: String? = null,
    enabled: Boolean = true,
    style: ButtonStyle = LocalAxfStyles.current.button,
    contentDescription: String? = null,
) {
    val uac = LocalAxfUac.current
    val gate = uac.gate(requires)
    if (gate == Gate.HIDE) return
    val locked = gate == Gate.DISABLE
    val theme = Axf.theme
    val colors = theme.colors
    val visual = remember(colors, style.fill, tone, theme.spacing.borderWidth) { buttonVisual(colors, style.fill, tone, theme.spacing.borderWidth) }
    val shape: Shape = theme.shapes.of(style.radius)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val isEnabled = enabled && !locked
    val weight = FontWeight(style.weight.coerceIn(100, 900))
    val label = if (style.uppercase) text?.uppercase() else text
    val minTouch = theme.spacing.touchTarget

    Box(
        modifier
            .semantics { if (contentDescription != null) this.contentDescription = contentDescription }
            .then(if (style.elevated && isEnabled) Modifier.shadow(theme.elevation(2), shape, ambientColor = colors.shadow, spotColor = colors.shadow) else Modifier)
            .clip(shape)
            .then(if (visual.background != null) Modifier.background(visual.background, shape) else Modifier)
            .then(if (visual.ring != null) Modifier.border(visual.ringWidth, visual.ring, shape) else Modifier)
            .clickable(interactionSource = interaction, indication = ripple(color = visual.foreground), enabled = isEnabled, role = Role.Button, onClick = onClick)
            .alpha(if (!isEnabled) theme.opacityDisabled.coerceAtLeast(0.45f) else if (pressed) 0.88f else 1f)
            .defaultMinSize(minHeight = style.minHeight.dp.coerceAtLeast(minTouch * 0.75f))
            .padding(horizontal = style.paddingX.dp, vertical = style.paddingY.dp),
        contentAlignment = Alignment.Center,
    ) {
        CompositionLocalProvider(LocalContentColor provides visual.foreground) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                when {
                    locked -> AxfIcon("lock", size = 14.dp, contentDescription = "Requires $requires")
                    icon != null -> AxfIcon(icon, size = 15.dp, contentDescription = null)
                }
                if (label != null) Text(
                    label,
                    style = theme.typography.bodyMedium.copy(fontWeight = weight, fontSize = theme.typography.bodyMedium.fontSize * 0.93f, letterSpacing = style.tracking.toFloat().em, lineHeight = theme.typography.bodyMedium.fontSize * 1.2f),
                    color = visual.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Web `.fx-iconbtn`: a 26dp square ghost button (the hit target is widened to the style's touch target).
 * `size` is the visual square; `iconSize` the glyph.
 */
@Composable
public fun AxfIconButton(
    icon: String,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    requires: String? = null,
    tint: Color = Axf.colors.muted,
    size: Dp = 26.dp,
    iconSize: Dp = 16.dp,
    active: Boolean = false,
) {
    val gate = LocalAxfUac.current.gate(requires)
    if (gate == Gate.HIDE) return
    val locked = gate == Gate.DISABLE
    val theme = Axf.theme
    val interaction = remember { MutableInteractionSource() }
    val touch = theme.spacing.touchTarget
    Box(
        modifier
            .sizeIn(minWidth = touch * 0.75f, minHeight = touch * 0.75f)
            .clip(theme.shapes.smShape)
            .then(if (active) Modifier.background(theme.colors.surface3) else Modifier)
            .clickable(interactionSource = interaction, indication = ripple(bounded = true, color = theme.colors.text), enabled = enabled && !locked, role = Role.Button, onClick = onClick)
            .alpha(if (enabled && !locked) 1f else theme.opacityDisabled.coerceAtLeast(0.4f)),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            AxfIcon(if (locked) "lock" else icon, size = iconSize, tint = if (active) theme.colors.text else tint, contentDescription = contentDescription)
        }
    }
}
