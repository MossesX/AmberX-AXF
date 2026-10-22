package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.engine.WidgetEngine
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/*
 * Widget kinds (Oct 20 2026): logo, action button, label, status, counter, progress, avatar, link, theme switch, spacer
 * and divider, drawn on their hosts (banner, toolbar). Rules (tones, counter text, percent, initials, link and image
 * addresses, sizes) come from the kernel's WidgetEngine, the same as the web port's widgets.ts; this file only draws.
 * Web twin: react/components/Widgets.tsx. Image logos/avatars: the kernel UI ships no image loader, so an image kind
 * draws its text / initials here (the web draws the image); apps that want pictures register their own renderer.
 */

private fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull

@Composable
private fun toneColor(tone: String, fallback: Color): Color {
    val c = Axf.theme.colors
    return when (tone) { "success" -> c.success; "warning" -> c.warning; "danger" -> c.danger; "accent" -> c.accent; "muted" -> c.muted; else -> fallback }
}

@Composable
private fun hostText(host: String): Color = if (host == "banner") LocalBannerForeground.current ?: Axf.theme.colors.text else Axf.theme.colors.text

/** Tap target shared by widgets that take a `link`: clickable when there is one. */
private fun Modifier.tap(link: String?, dispatch: (String) -> Unit): Modifier =
    if (link.isNullOrBlank()) this else this.clip(RoundedCornerShape(50)).clickable(role = Role.Button) { dispatch(link) }

@Composable
public fun AxfLogoWidget(d: JsonObject, host: String) {
    val theme = Axf.theme
    val actions = LocalAxfActions.current
    val size = WidgetEngine.logoSize(d.str("size", "regular"))
    val text = d.str("text", "")
    val kind = d.str("kind", "text")
    val fg = hostText(host)
    val label = d.str("tooltip", "").ifBlank { text }
    Row(Modifier.tap(d.str("link", "").ifBlank { null }) { actions.dispatch(it) }.semantics { contentDescription = label }, verticalAlignment = Alignment.CenterVertically) {
        if (kind == "icon" && d.str("icon", "").isNotBlank()) AxfIcon(d.str("icon", ""), size = (size.px * 0.8).dp, tint = fg, contentDescription = null)
        else Text(text, color = fg, maxLines = 1, style = theme.typography.titleMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * size.scale.toFloat(), fontWeight = if (d.bool("bold", true)) FontWeight.Bold else FontWeight.Medium))
    }
}

@Composable
public fun AxfActionButtonWidget(d: JsonObject) {
    val actions = LocalAxfActions.current
    val show = d.str("show", "both")
    val label = d.str("label", "")
    val tone = when (d.str("tone", "neutral")) { "accent" -> ButtonTone.PRIMARY; "danger" -> ButtonTone.DANGER; else -> ButtonTone.NEUTRAL }
    if (show == "icon") AxfIconButton(d.str("icon", "zap"), contentDescription = d.str("tooltip", "").ifBlank { label }, onClick = { actions.dispatch(d.str("action", "")) })
    else AxfButton(label, onClick = { actions.dispatch(d.str("action", "")) }, tone = tone, icon = if (show == "both") d.str("icon", "") else null, contentDescription = d.str("tooltip", "").ifBlank { label })
}

@Composable
public fun AxfLabelWidget(d: JsonObject, host: String) {
    val theme = Axf.theme
    val base = theme.typography.bodySmall.copy(fontWeight = if (d.bool("bold", false)) FontWeight.Bold else FontWeight.Normal)
    Text(d.str("text", ""), maxLines = 1, color = toneColor(WidgetEngine.widgetTone(d.str("tone", "neutral")), hostText(host)),
        style = if (d.bool("mono", false)) base.copy(fontFamily = FontFamily.Monospace) else base)
}

@Composable
public fun AxfStatusWidget(d: JsonObject, host: String) {
    val theme = Axf.theme
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val badges by runtime.badges.collectAsState()
    val on = WidgetEngine.statusOn(badges[d.str("counter", "")]?.toDouble())
    val text = if (on) d.str("onLabel", "On") else d.str("offLabel", "Off")
    val color = toneColor(WidgetEngine.widgetTone(if (on) d.str("onTone", "success") else d.str("offTone", "muted")), hostText(host))
    Row(Modifier.tap(d.str("link", "").ifBlank { null }) { actions.dispatch(it) }.semantics { contentDescription = text }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (d.bool("dot", true)) Box(Modifier.size(7.dp).background(color, RoundedCornerShape(50)))
        Text(text, color = color, maxLines = 1, style = theme.typography.bodySmall)
    }
}

@Composable
public fun AxfCounterWidget(d: JsonObject, host: String) {
    val theme = Axf.theme
    val c = theme.colors
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val badges by runtime.badges.collectAsState()
    val n = badges[d.str("counter", "")] ?: 0
    val text = WidgetEngine.counterText(n.toDouble(), d.num("max") ?: 99.0, d.bool("hideAtZero", true))
    if (text.isEmpty()) return
    val color = toneColor(WidgetEngine.widgetTone(d.str("tone", "neutral")), hostText(host))
    val label = d.str("label", "")
    Row(Modifier.tap(d.str("link", "").ifBlank { null }) { actions.dispatch(it) }.semantics { contentDescription = "$n ${label.ifBlank { d.str("counter", "") }}" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (d.str("icon", "").isNotBlank()) AxfIcon(d.str("icon", ""), size = 13.dp, tint = hostText(host), contentDescription = null)
        Box(Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = theme.opacityTint)).border(theme.spacing.borderWidth, color, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 1.dp)) {
            Text(text, color = color, maxLines = 1, style = theme.typography.labelSmall.copy(fontWeight = FontWeight.Bold))
        }
        if (label.isNotBlank()) Text(label, color = c.muted, maxLines = 1, style = theme.typography.bodySmall)
    }
}

@Composable
public fun AxfProgressWidget(d: JsonObject, host: String) {
    val theme = Axf.theme
    val c = theme.colors
    val runtime = LocalAxfRuntime.current
    val badges by runtime.badges.collectAsState()
    val pct = WidgetEngine.progressPercent((badges[d.str("counter", "")] ?: 0).toDouble(), d.num("max"))
    val color = toneColor(WidgetEngine.widgetTone(d.str("tone", "accent"), "accent"), hostText(host))
    val width = theme.spacing.x(WidgetEngine.progressWidth(d.str("width", "regular")))
    Row(Modifier.semantics { contentDescription = "${d.str("label", "").ifBlank { d.str("counter", "") }} $pct%" }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        if (d.str("label", "").isNotBlank()) Text(d.str("label", ""), color = c.muted, maxLines = 1, style = theme.typography.bodySmall)
        Box(Modifier.width(width).height(6.dp).clip(RoundedCornerShape(50)).background(color.copy(alpha = theme.opacityTint))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(pct / 100f).background(color, RoundedCornerShape(50)))
        }
        if (d.bool("showValue", false)) Text("$pct%", color = c.muted, maxLines = 1, style = theme.typography.bodySmall)
    }
}

@Composable
public fun AxfAvatarWidget(d: JsonObject) {
    val theme = Axf.theme
    val c = theme.colors
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    LocalAxfState.current
    val px = WidgetEngine.avatarSize(d.str("size", "regular"))
    val who = runtime.boundPrincipal()
    val name = if (d.str("source", "text") == "account" && who != null) who.label else d.str("text", "")
    val shape = if (d.str("shape", "circle") == "rounded") theme.shapes.smShape else RoundedCornerShape(50)
    val label = d.str("tooltip", "").ifBlank { name.ifBlank { "Account" } }
    Box(Modifier.size(px.dp).clip(shape).background(c.accent).tap(d.str("link", "").ifBlank { null }) { actions.dispatch(it) }.semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Text(WidgetEngine.avatarInitials(name), color = c.accentText, maxLines = 1, style = theme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = theme.typography.bodyMedium.fontSize * (px / 30f).coerceAtLeast(0.6f)))
    }
}

@Composable
public fun AxfLinkWidget(d: JsonObject) {
    val theme = Axf.theme
    val c = theme.colors
    val uri = LocalUriHandler.current
    val href = WidgetEngine.linkHref(d.str("href", "")) ?: return
    val label = d.str("label", href)
    Row(Modifier.clip(RoundedCornerShape(50)).clickable(role = Role.Button) { runCatching { uri.openUri(href) } }.semantics { contentDescription = d.str("tooltip", "").ifBlank { label } },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (d.str("icon", "").isNotBlank()) AxfIcon(d.str("icon", ""), size = 13.dp, tint = c.accent, contentDescription = null)
        Text(label, color = c.accent, maxLines = 1, style = theme.typography.bodySmall)
    }
}

@Composable
public fun AxfThemeSwitchWidget(d: JsonObject, host: String) {
    val theme = Axf.theme
    val c = theme.colors
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val active = state.active["color-theme"]
    val dark = active == d.str("dark", "")
    val next = WidgetEngine.themeSwitchNext(active, d.str("light", ""), d.str("dark", ""))
    val show = d.str("show", "icon")
    val label = if (dark) d.str("lightLabel", "Light") else d.str("darkLabel", "Dark")
    val fg = hostText(host)
    val h = theme.spacing.rowHeight * 0.62f
    Row(Modifier.height(h).clip(RoundedCornerShape(50)).border(theme.spacing.borderWidth, c.border, RoundedCornerShape(50)).clickable(role = Role.Switch) { runtime.swap("color-theme", next) }
        .padding(horizontal = if (show == "icon") 0.dp else 8.dp).then(if (show == "icon") Modifier.width(h) else Modifier).semantics { contentDescription = "Switch to $label theme" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally)) {
        if (show != "label") AxfIcon(if (dark) "sun" else "moon", size = 13.dp, tint = fg, contentDescription = null)
        if (show != "icon") Text(label, color = fg, maxLines = 1, style = theme.typography.labelSmall)
    }
}

/** A gap; `flex` has no stretch inside a host row here, so it is a large fixed gap (the web pushes what follows to the other end). */
@Composable
public fun AxfSpacerWidget(d: JsonObject) {
    val u = WidgetEngine.spacerUnits(d.str("size", "regular"))
    Spacer(Modifier.width(Axf.theme.spacing.x(if (u < 0) 6 else u)))
}

@Composable
public fun AxfDividerWidget(d: JsonObject) {
    val theme = Axf.theme
    Box(Modifier.padding(horizontal = theme.spacing.x(0.5)).width(theme.spacing.borderWidth).then(if (d.bool("inset", true)) Modifier.height(14.dp) else Modifier.fillMaxHeight()).background(theme.colors.border))
}

/** Registers every widget kind's renderer (called once by WidgetRenderers). */
internal fun registerWidgetKinds(register: (String, @Composable (WidgetRenderScope) -> Unit) -> Unit) {
    register("logo") { s -> AxfLogoWidget(s.data, s.host) }
    register("action-button") { s -> AxfActionButtonWidget(s.data) }
    register("label") { s -> AxfLabelWidget(s.data, s.host) }
    register("status") { s -> AxfStatusWidget(s.data, s.host) }
    register("counter") { s -> AxfCounterWidget(s.data, s.host) }
    register("progress") { s -> AxfProgressWidget(s.data, s.host) }
    register("avatar") { s -> AxfAvatarWidget(s.data) }
    register("link") { s -> AxfLinkWidget(s.data) }
    register("theme-switch") { s -> AxfThemeSwitchWidget(s.data, s.host) }
    register("spacer") { s -> AxfSpacerWidget(s.data) }
    register("divider") { s -> AxfDividerWidget(s.data) }
}
