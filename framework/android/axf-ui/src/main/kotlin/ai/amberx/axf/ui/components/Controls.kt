package ai.amberx.axf.ui.components

import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em

/** Web `.fx-input`: bg background, border, sm radius, accent border + soft ring on focus. */
@Composable
public fun AxfTextField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    placeholder: String? = null,
    leadingIcon: String? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    minLines: Int = 1,
    secret: Boolean = false,
    monospace: Boolean = false,
    error: String? = null,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
) {
    val theme = Axf.theme
    val c = theme.colors
    var focused by remember { mutableStateOf(false) }
    val borderColor = when { error != null -> c.danger; focused -> c.accent; else -> c.border }
    val textStyle: TextStyle = (if (monospace) theme.typography.code else theme.typography.bodyMedium).copy(color = c.text)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) Text(label, style = theme.typography.bodySmall, color = c.muted)
        Box(
            Modifier.fillMaxWidth()
                .then(if (focused) Modifier.border(3.dp, c.accentSoft, theme.shapes.smShape) else Modifier)
                .clip(theme.shapes.smShape)
                .background(c.bg, theme.shapes.smShape)
                .border(theme.spacing.borderWidth, borderColor, theme.shapes.smShape)
                .alpha(if (enabled) 1f else theme.opacityDisabled)
                .padding(horizontal = 10.dp, vertical = 8.dp),
        ) {
            Row(verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                if (leadingIcon != null) AxfIcon(leadingIcon, size = 14.dp, tint = c.muted, contentDescription = null)
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty() && placeholder != null) Text(placeholder, style = textStyle, color = c.placeholder, maxLines = if (singleLine) 1 else Int.MAX_VALUE)
                    BasicTextField(
                        value = value, onValueChange = onValueChange, enabled = enabled, singleLine = singleLine, minLines = minLines,
                        textStyle = textStyle, cursorBrush = SolidColor(c.accent),
                        visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
                        keyboardOptions = keyboardOptions, keyboardActions = keyboardActions,
                        modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
                    )
                }
            }
        }
        if (error != null) Text(error, style = theme.typography.bodySmall, color = c.danger)
    }
}

/** Material switch recolored from the tokens; label row with optional description. */
@Composable
public fun AxfSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, label: String? = null, description: String? = null, enabled: Boolean = true) {
    val theme = Axf.theme
    val c = theme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = theme.spacing.touchTarget)
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onCheckedChange)
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.oneHalf),
    ) {
        if (label != null) Column(Modifier.weight(1f)) {
            Text(label, style = theme.typography.bodyMedium, color = c.text)
            if (description != null) Text(description, style = theme.typography.bodySmall, color = c.muted)
        }
        Switch(
            checked = checked, onCheckedChange = null, enabled = enabled,
            colors = SwitchDefaults.colors(
                checkedThumbColor = c.accentText, checkedTrackColor = c.accent, checkedBorderColor = c.accent,
                uncheckedThumbColor = c.muted, uncheckedTrackColor = c.surface3, uncheckedBorderColor = c.border,
                disabledCheckedTrackColor = c.disabledBg, disabledUncheckedTrackColor = c.disabledBg,
            ),
        )
    }
}

@Composable
public fun AxfCheckbox(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, label: String? = null, enabled: Boolean = true) {
    val theme = Axf.theme
    val c = theme.colors
    Row(
        modifier.heightIn(min = theme.spacing.touchTarget).toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onCheckedChange),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.one),
    ) {
        Checkbox(checked = checked, onCheckedChange = null, enabled = enabled, colors = CheckboxDefaults.colors(checkedColor = c.accent, checkmarkColor = c.accentText, uncheckedColor = c.muted, disabledCheckedColor = c.disabledBg, disabledUncheckedColor = c.disabledBg))
        if (label != null) Text(label, style = theme.typography.bodyMedium, color = c.text)
    }
}

/** Web `.fx-chip` with tones accent/success/warning/danger (null = neutral). Clickable when `onClick` is set. */
@Composable
public fun AxfChip(text: String, modifier: Modifier = Modifier, tone: String? = null, icon: String? = null, selected: Boolean = false, onClick: (() -> Unit)? = null) {
    val theme = Axf.theme
    val c = theme.colors
    val bg = if (tone != null) c.toneSoft(tone) else if (selected) c.accentSoft else c.surface3
    val fg = if (tone != null) c.tone(tone) else if (selected) c.accent else c.muted
    Row(
        modifier.clip(theme.shapes.full).background(bg)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick).heightIn(min = 32.dp) else Modifier)
            .padding(horizontal = if (onClick != null) 12.dp else 8.dp, vertical = if (onClick != null) 4.dp else 1.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) AxfIcon(icon, size = 11.dp, tint = fg, contentDescription = null)
        Text(text, style = theme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold, fontSize = theme.typography.bodyMedium.fontSize * 0.74f), color = fg, maxLines = 1)
    }
}

/** Web `.fx-kbd`: keyboard shortcut hint. */
@Composable
public fun AxfKbd(text: String, modifier: Modifier = Modifier) {
    val theme = Axf.theme
    val c = theme.colors
    Text(
        text, style = theme.typography.code.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.75f), color = c.muted, maxLines = 1,
        modifier = modifier.background(c.surface2, theme.shapes.smShape).border(theme.spacing.borderWidth, c.border, theme.shapes.smShape).padding(horizontal = 6.dp, vertical = 1.dp),
    )
}

/** Counter / status badge (`.fx-nav__badge`): pill, accent soft background, bold. */
@Composable
public fun AxfBadge(text: String, modifier: Modifier = Modifier, tone: String = "accent") {
    val theme = Axf.theme
    val c = theme.colors
    Text(
        text, style = theme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = theme.typography.bodyMedium.fontSize * 0.72f), color = c.tone(tone), maxLines = 1,
        modifier = modifier.background(c.toneSoft(tone), theme.shapes.full).padding(horizontal = 7.dp, vertical = 1.dp),
    )
}

/** Web `.fx-tabs` / `.fx-tab`: horizontal segmented choice with an accent underline on the active item. */
@Composable
public fun AxfSegmented(options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier, pills: Boolean = false) {
    val theme = Axf.theme
    val c = theme.colors
    Row(
        modifier.fillMaxWidth().then(if (pills) Modifier else Modifier.drawBottomBorder(c.border, theme.spacing.borderWidth)),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for ((id, label) in options) {
            val active = id == selected
            Box(
                Modifier.heightIn(min = theme.spacing.touchTarget * 0.8f)
                    .then(if (pills) Modifier.clip(theme.shapes.full).background(if (active) c.accent else c.surface3) else Modifier.drawBottomBorder(if (active) c.accent else Color.Transparent, 2.dp))
                    .selectable(selected = active, role = Role.Tab, onClick = { onSelect(id) })
                    .padding(horizontal = if (pills) 14.dp else 12.dp, vertical = 8.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = theme.typography.bodyMedium, color = if (pills) (if (active) c.accentText else c.muted) else if (active) c.text else c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Standard list row: icon, title, subtitle, trailing. Min height = touch target. */
@Composable
public fun AxfListItem(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: String? = null,
    onClick: (() -> Unit)? = null,
    selected: Boolean = false,
    enabled: Boolean = true,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val theme = Axf.theme
    val c = theme.colors
    Row(
        modifier.fillMaxWidth().heightIn(min = theme.spacing.touchTarget).clip(theme.shapes.smShape)
            .then(if (selected) Modifier.background(c.surface3) else Modifier)
            .then(if (onClick != null) Modifier.clickable(enabled = enabled, onClick = onClick) else Modifier)
            .alpha(if (enabled) 1f else theme.opacityDisabled)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (icon != null) AxfIcon(icon, size = 17.dp, tint = if (selected) c.text else c.muted, contentDescription = null)
        Column(Modifier.weight(1f)) {
            Text(title, style = theme.typography.bodyMedium, color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = theme.typography.bodySmall, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) trailing()
    }
}

/** Web `.fx-nav__label` / `.fx-eyebrow`: tiny uppercase tracked header. */
@Composable
public fun AxfSectionHeader(text: String, modifier: Modifier = Modifier, accent: Boolean = false) {
    val theme = Axf.theme
    Text(
        text.uppercase(), style = theme.typography.eyebrow.copy(letterSpacing = if (accent) 0.14f.em else 0.1f.em, fontSize = theme.typography.bodyMedium.fontSize * (if (accent) 0.76f else 0.74f)),
        color = if (accent) theme.colors.accent else theme.colors.muted, modifier = modifier.padding(horizontal = if (accent) 0.dp else 10.dp, vertical = 4.dp),
    )
}

/** Page head: eyebrow, h1 and description — web `.fx-pagehead`. */
@Composable
public fun AxfPageHead(title: String, modifier: Modifier = Modifier, eyebrow: String? = null, description: String? = null, actions: (@Composable RowScope.() -> Unit)? = null) {
    val theme = Axf.theme
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(theme.spacing.two)) {
        Column {
            if (eyebrow != null) AxfSectionHeader(eyebrow, accent = true)
            Text(title, style = theme.typography.headlineMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 2f), color = theme.colors.text)
            if (description != null) Text(description, style = theme.typography.bodyMedium, color = theme.colors.muted, modifier = Modifier.padding(top = 6.dp))
        }
        if (actions != null) Row(horizontalArrangement = Arrangement.spacedBy(theme.spacing.one), verticalAlignment = Alignment.CenterVertically) { actions() }
    }
}

/** Thin horizontal rule in the border color (`.fx-menu__sep`, `.fx-status__sep`). */
@Composable
public fun AxfDivider(modifier: Modifier = Modifier) {
    val theme = Axf.theme
    Box(modifier.fillMaxWidth().heightIn(min = theme.spacing.borderWidth).background(theme.colors.border))
}

@Composable
public fun AxfSpacerH(width: Dp): Unit = Spacer(Modifier.width(width))

/* ---- empty / loading / error ---- */

@Composable
private fun StateBlock(icon: String, tint: Color, title: String, message: String?, modifier: Modifier, action: (@Composable () -> Unit)?) {
    val theme = Axf.theme
    Column(modifier.fillMaxWidth().padding(theme.spacing.four), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(theme.spacing.one)) {
        Box(Modifier.size(44.dp).background(tint.copy(alpha = 0.14f), theme.shapes.full), contentAlignment = Alignment.Center) { AxfIcon(icon, size = 22.dp, tint = tint, contentDescription = null) }
        Text(title, style = theme.typography.titleSmall, color = theme.colors.text)
        if (message != null) Text(message, style = theme.typography.bodySmall, color = theme.colors.muted, textAlign = TextAlign.Center)
        if (action != null) Box(Modifier.padding(top = theme.spacing.one)) { action() }
    }
}

@Composable
public fun AxfEmptyState(title: String, modifier: Modifier = Modifier, message: String? = null, icon: String = "box", action: (@Composable () -> Unit)? = null): Unit =
    StateBlock(icon, Axf.colors.muted, title, message, modifier, action)

@Composable
public fun AxfLoadingState(title: String = "Loading…", modifier: Modifier = Modifier, message: String? = null) {
    val theme = Axf.theme
    Column(modifier.fillMaxWidth().padding(theme.spacing.four), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(theme.spacing.one)) {
        CircularProgressIndicator(color = theme.colors.accent, trackColor = theme.colors.surface3, modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
        Text(title, style = theme.typography.titleSmall, color = theme.colors.text)
        if (message != null) Text(message, style = theme.typography.bodySmall, color = theme.colors.muted)
    }
}

@Composable
public fun AxfErrorState(title: String, modifier: Modifier = Modifier, message: String? = null, retry: (() -> Unit)? = null): Unit =
    StateBlock("alert", Axf.colors.danger, title, message, modifier, if (retry != null) ({ AxfButton("Retry", onClick = retry, icon = "refresh", tone = ButtonTone.PRIMARY) }) else null)

/** Standard screen for routes/views that exist but are not built yet. */
@Composable
public fun PlaceholderScreen(title: String = "Coming soon", modifier: Modifier = Modifier, message: String? = "This screen is declared but not built yet.", icon: String = "box"): Unit =
    AxfEmptyState(title, modifier, message, icon)

/* ---- helpers ---- */

internal fun Modifier.drawBottomBorder(color: Color, width: Dp): Modifier = this.drawBehind {
    val w = width.toPx()
    drawRect(color, topLeft = Offset(0f, size.height - w), size = Size(size.width, w))
}
