package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.asset.ContainerVariant
import ai.amberx.axf.kernel.asset.HeaderStyle
import ai.amberx.axf.kernel.engine.ContainerStyle
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Web `.fx-card`: the container styled by the active `container` asset — card / panel / glass / outline,
 * header plain / divided / accent, padding from the size ladder, elevation 0..3, collapsible.
 * Also used as `AxfCard` (alias). `ctxTarget`/`ctxPayload` make it a long-press context-menu host.
 */
@Composable
public fun AxfContainer(
    modifier: Modifier = Modifier,
    title: String? = null,
    icon: String? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    style: ContainerStyle = LocalAxfStyles.current.container,
    ctxTarget: String? = null,
    ctxPayload: String? = null,
    initiallyOpen: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val theme = Axf.theme
    val c = theme.colors
    var open by remember { mutableStateOf(initiallyOpen) }
    val shape: Shape = when (style.variant) { ContainerVariant.PANEL -> theme.shapes.mdShape; else -> theme.shapes.lgShape }
    val bg: Color = when (style.variant) {
        ContainerVariant.CARD -> c.surface
        ContainerVariant.PANEL -> c.surface2
        ContainerVariant.GLASS -> c.surface.copy(alpha = 0.58f)
        ContainerVariant.OUTLINE -> Color.Transparent
    }
    val borderColor = if (style.variant == ContainerVariant.GLASS) c.text.copy(alpha = 0.12f) else c.border
    val pad = style.padding.toFloat().dp
    val elevation = if (style.variant == ContainerVariant.OUTLINE) 0.dp else theme.elevation(style.elevation)
    val bw = theme.spacing.borderWidth

    Column(
        modifier
            .then(if (ctxTarget != null) Modifier.axfContextMenu(ctxTarget, ctxPayload) else Modifier)
            .then(if (elevation > 0.dp) Modifier.shadow(elevation, shape, ambientColor = c.shadow, spotColor = c.shadow) else Modifier)
            .clip(shape)
            .background(bg, shape)
            .then(
                if (style.variant == ContainerVariant.OUTLINE) Modifier.drawBehind {
                    val r = theme.shapes.lg.toPx()
                    drawRoundRect(borderColor, cornerRadius = CornerRadius(r), style = Stroke(bw.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx()))))
                } else Modifier.border(bw, borderColor, shape),
            ),
    ) {
        if (title != null) {
            Box {
                if (style.header == HeaderStyle.ACCENT || style.header == HeaderStyle.ACCENT_BAR) {
                    Box(Modifier.padding(top = pad * 0.6f).width(3.dp).fillMaxHeight().background(c.accent, androidx.compose.foundation.shape.RoundedCornerShape(topEnd = 3.dp, bottomEnd = 3.dp)))
                }
                Row(
                    Modifier.fillMaxWidth().padding(start = pad, end = pad, top = pad * 0.6f, bottom = if (style.header == HeaderStyle.DIVIDED) pad * 0.6f else 0.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (icon != null) AxfIcon(icon, size = 16.dp, tint = if (style.header == HeaderStyle.ACCENT || style.header == HeaderStyle.ACCENT_BAR) c.accent else c.muted, contentDescription = null)
                    Text(title, style = theme.typography.titleSmall.copy(fontSize = theme.typography.bodyMedium.fontSize), color = c.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (actions != null) actions()
                        if (style.collapsible) AxfIconButton(if (open) "chevron-down" else "chevron-right", if (open) "Collapse" else "Expand", onClick = { open = !open }, size = 22.dp, iconSize = 15.dp)
                    }
                }
            }
            if (style.header == HeaderStyle.DIVIDED) Box(Modifier.fillMaxWidth().height(bw).background(c.border))
        }
        AnimatedVisibility(visible = open || !style.collapsible) {
            Column(Modifier.padding(start = pad, end = pad, top = pad * 0.8f, bottom = pad), content = content)
        }
    }
}

/** Alias of [AxfContainer] for callers that think in cards. */
@Composable
public fun AxfCard(
    modifier: Modifier = Modifier,
    title: String? = null,
    icon: String? = null,
    actions: (@Composable RowScope.() -> Unit)? = null,
    ctxTarget: String? = null,
    ctxPayload: String? = null,
    content: @Composable ColumnScope.() -> Unit,
): Unit = AxfContainer(modifier, title, icon, actions, LocalAxfStyles.current.container, ctxTarget, ctxPayload, true, content)

/** Web `.fx-inspector`-style container for the inspector region: surface background, small padding. */
@Composable
public fun AxfInspector(modifier: Modifier = Modifier, title: String = "Inspector", icon: String = "layers", actions: (@Composable RowScope.() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val theme = Axf.theme
    Column(modifier.fillMaxWidth().padding(theme.spacing.oneHalf)) {
        Row(Modifier.fillMaxWidth().padding(bottom = theme.spacing.one), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AxfIcon(icon, size = 15.dp, tint = theme.colors.muted, contentDescription = null)
            Text(title, style = theme.typography.titleSmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.95f), color = theme.colors.text, modifier = Modifier.weight(1f))
            if (actions != null) actions()
        }
        content()
    }
}
