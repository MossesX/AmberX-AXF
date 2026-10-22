package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.engine.BadgeData
import ai.amberx.axf.kernel.engine.BannerData
import ai.amberx.axf.kernel.engine.BannerEngine
import ai.amberx.axf.kernel.engine.PlacedAttachment
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.delay

/*
 * Banner (asset type `banner`): the thin permanent bar across the top of the screen, above the layout (web
 * `.fx-banner`). Logo on the left, then the attachments the kernel places (BannerEngine → WidgetEngine host `banner`) on
 * the left, center and right: badges and widgets (clock, search bar) from the banner asset itself and from modules at run
 * time (runtime.attachToBanner). A runtime popup (runtime.showBannerPopup) pops a short message out to the right of its
 * attachment for a few seconds; tapping it dismisses it early. Hidden slot or no banner asset = nothing drawn.
 * Theme tokens only. Preview: BannerPreview (axf-ui previews).
 */

/** Foreground colour attachments should paint with on this banner (accent surface = accent text); null off a banner. */
public val LocalBannerForeground: ProvidableCompositionLocal<Color?> = compositionLocalOf { null }

@Composable
public fun AxfBanner(modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    LocalAxfState.current
    val (data, height, placed) = runtime.banner()
    if (data == null) return
    val theme = Axf.theme
    val c = theme.colors
    val surface = BannerEngine.surface(data)
    val bg = when (surface) { "accent" -> c.accent; "raised" -> c.surface; else -> c.surface2 }
    val fg = if (surface == "accent") c.accentText else c.text
    val sides = BannerEngine.SIDES
    CompositionLocalProvider(LocalBannerForeground provides fg) {
        Row(
            modifier.fillMaxWidth().height(height.dp)
                .then(if (surface == "raised") Modifier.shadow(theme.elevation(1), ambientColor = c.shadow, spotColor = c.shadow) else Modifier)
                .background(bg)
                .then(if (data.divider) Modifier.drawBottomBorder(c.border, theme.spacing.borderWidth) else Modifier)
                .padding(horizontal = theme.spacing.one)
                .axfContextMenu("banner")
                .semantics { contentDescription = "Banner" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Three sides like the web grid `1fr auto 1fr`: left and right share the room, the center keeps its size.
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.x(0.75))) {
                if (data.logoShow) BannerLogo(data, height, fg)
                for (a in placed[sides[0]] ?: emptyList()) BannerItem(a)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.x(0.75))) {
                for (a in placed[sides[1]] ?: emptyList()) BannerItem(a)
            }
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.x(0.75), Alignment.End)) {
                for (a in placed[sides[2]] ?: emptyList()) BannerItem(a)
            }
        }
    }
}

@Composable
private fun BannerLogo(data: BannerData, height: Int, fg: Color) {
    val theme = Axf.theme
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.half)) {
        AxfBrandMark(Modifier.size((height * 0.55f).dp))
        if (data.logoText.isNotEmpty()) Text(data.logoText, style = theme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, fontSize = theme.typography.bodyMedium.fontSize * 0.9f), color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** One placed attachment: a badge or a widget, with the runtime popup (if it is for this key) to its right. */
@Composable
private fun BannerItem(a: PlacedAttachment) {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val asset = runtime.registry.get(a.type, a.id) ?: return
    val pop = state.bannerPopup?.takeIf { it.key == a.key }
    Box {
        if (a.type == "badge") AxfBannerBadge(BadgeData.fromJson(asset.data)) else AxfWidget(a, host = BannerEngine.HOST)
        if (pop != null) {
            LaunchedEffect(pop) { delay(pop.durationMs); runtime.dismissBannerPopup() }
            BannerPopup(pop.text) { runtime.dismissBannerPopup() }
        }
    }
}

/** A badge (icon / pill / dot) in its tone; a `link` makes it a button. Web `.fx-banner__badge`. */
@Composable
public fun AxfBannerBadge(data: BadgeData, modifier: Modifier = Modifier) {
    val theme = Axf.theme
    val c = theme.colors
    val actions = LocalAxfActions.current
    val tone = when (BannerEngine.toneToken(data.tone)) { "success" -> c.success; "warning" -> c.warning; "danger" -> c.danger; "accent" -> c.accent; "muted" -> c.muted; else -> LocalBannerForeground.current ?: c.text }
    val h = theme.spacing.rowHeight * 0.62f
    val label = data.tooltip ?: data.label
    val base = modifier.height(h).clip(RoundedCornerShape(50)).background(c.surface2).border(theme.spacing.borderWidth, c.border, RoundedCornerShape(50))
        .then(if (data.link != null) Modifier.clickable(role = Role.Button) { actions.dispatch(data.link!!) } else Modifier)
        .padding(horizontal = if (data.shape == "pill") 8.dp else 0.dp)
        .then(if (data.shape != "pill") Modifier.width(h) else Modifier)
        .semantics { contentDescription = label }
    Row(base, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp, Alignment.CenterHorizontally)) {
        if (data.shape == "dot") Box(Modifier.size(h * 0.4f).background(tone, RoundedCornerShape(50)))
        else AxfIcon(data.icon, size = 12.dp, tint = tone, contentDescription = null)
        if (data.shape == "pill") Text(data.label, style = theme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = theme.typography.bodyMedium.fontSize * 0.74f), color = tone, maxLines = 1)
    }
}

/** The pop-out to the right of a banner attachment (web `.fx-banner__pop`). */
@Composable
private fun BannerPopup(text: String, onDismiss: () -> Unit) {
    val theme = Axf.theme
    val c = theme.colors
    Popup(alignment = Alignment.CenterEnd, offset = IntOffset(with(androidx.compose.ui.platform.LocalDensity.current) { 8.dp.roundToPx() }, 0), properties = PopupProperties(focusable = false)) {
        Box(
            Modifier.shadow(theme.elevation(3), theme.shapes.smShape, ambientColor = c.shadow, spotColor = c.shadow)
                .clip(theme.shapes.smShape).background(c.surface).border(theme.spacing.borderWidth, c.border, theme.shapes.smShape)
                .clickable(role = Role.Button, onClick = onDismiss).padding(horizontal = 10.dp, vertical = 4.dp),
        ) {
            Text(text, style = theme.typography.bodySmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.82f), color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
