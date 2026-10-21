package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.library.LibraryParam
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.error
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/*
 * Form controls every AXF Android app shares (harvested Oct 21 2026; same names, props and behaviour as the web
 * `framework/react/components/Forms.tsx`): AxfField, AxfSelectField, AxfChoiceGrid, AxfNote, AxfSection and
 * AxfLibraryParamField. AxfSwitch and AxfTextField already existed (kit-dispatched in Dispatch.kt).
 *
 * Everything reads theme tokens (`Axf.theme`): colours, type, radii and the spacing unit, so the user's Spacing
 * choice (Super tight / Compact / Regular) sizes these controls too. Accessibility: fields carry their label and
 * error in semantics, choice cards are selectable with Role.RadioButton / Role.Checkbox inside a selectable group,
 * notes with a warning or danger tone are live regions. Written without a compiler (Maven is blocked here).
 */

/** Web `Field`: label + control + hint-or-error wrapper. `content` is the control. */
@Composable
public fun AxfField(label: String, modifier: Modifier = Modifier, hint: String? = null, error: String? = null, required: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val theme = Axf.theme
    val c = theme.colors
    Column(modifier.fillMaxWidth().semantics { if (error != null) this.error(error) }, verticalArrangement = Arrangement.spacedBy(theme.spacing.x(0.4))) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = theme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold), color = c.text)
            if (required) Text(" *", style = theme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold), color = c.danger)
        }
        content()
        if (error != null) Text(error, style = theme.typography.bodySmall, color = c.danger, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        else if (hint != null) Text(hint, style = theme.typography.bodySmall, color = c.muted)
    }
}

/** One option of [AxfSelectField]. */
public data class SelectOption(val value: String, val label: String, val enabled: Boolean = true)

/**
 * Web `SelectField`: a drop-down inside a field. Shows the selected option's label (or `empty`), opens a menu with every
 * option. `empty` adds a "" choice at the top.
 */
@Composable
public fun AxfSelectField(
    label: String,
    value: String,
    options: List<SelectOption>,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    hint: String? = null,
    error: String? = null,
    empty: String? = null,
    required: Boolean = false,
    enabled: Boolean = true,
) {
    val theme = Axf.theme
    val c = theme.colors
    var open by remember { mutableStateOf(false) }
    val all: List<SelectOption> = if (empty != null) listOf(SelectOption("", empty)) + options else options
    val current: SelectOption? = all.firstOrNull { it.value == value }
    val shown: String = current?.label ?: value
    AxfField(label, modifier, hint = hint, error = error, required = required) {
        Box {
            Row(
                Modifier.fillMaxWidth().heightIn(min = theme.spacing.controlHeight)
                    .clip(theme.shapes.smShape).background(c.bg, theme.shapes.smShape)
                    .border(theme.spacing.borderWidth, if (error != null) c.danger else c.border, theme.shapes.smShape)
                    .clickable(enabled = enabled, role = Role.DropdownList, onClickLabel = "Choose $label") { open = true }
                    .alpha(if (enabled) 1f else theme.opacityDisabled)
                    .padding(horizontal = theme.spacing.x(1.25), vertical = theme.spacing.one)
                    .semantics { contentDescription = "$label: ${shown.ifBlank { "none" }}" },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.half),
            ) {
                Text(shown, Modifier.weight(1f), style = theme.typography.bodyMedium, color = if (shown.isBlank()) c.placeholder else c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                AxfIcon("chevron-down", size = 14.dp, tint = c.muted, contentDescription = null)
            }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                for (o in all) DropdownMenuItem(
                    text = { Text(o.label, style = theme.typography.bodyMedium, color = if (o.value == value) c.accent else c.text) },
                    onClick = { open = false; onChange(o.value) }, enabled = o.enabled,
                )
            }
        }
    }
}

/** One card of [AxfChoiceGrid] (web `Choice`). */
public data class Choice(val id: String, val title: String, val text: String? = null, val icon: String? = null, val tag: String? = null, val enabled: Boolean = true)

/** Web `ChoiceGrid`: tappable cards, single (radio) or multiple (checkbox) choice. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun AxfChoiceGrid(choices: List<Choice>, selected: Set<String>, onToggle: (String) -> Unit, modifier: Modifier = Modifier, multiple: Boolean = false, label: String? = null) {
    val theme = Axf.theme
    val c = theme.colors
    val gap = theme.spacing.x(0.75)
    val minCard = theme.typography.bodyMedium.fontSize.value * 13f
    FlowRow(
        modifier.fillMaxWidth().then(if (multiple) Modifier else Modifier.selectableGroup()).semantics { if (label != null) contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(gap), verticalArrangement = Arrangement.spacedBy(gap),
    ) {
        for (ch in choices) {
            val on = ch.id in selected
            val sel = Modifier.selectable(selected = on, enabled = ch.enabled, role = if (multiple) Role.Checkbox else Role.RadioButton) { onToggle(ch.id) }
            Column(
                Modifier.width(minCard.dp).heightIn(min = theme.spacing.touchTarget)
                    .clip(theme.shapes.mdShape)
                    .background(if (on) c.accentSoft else c.surface, theme.shapes.mdShape)
                    .border(if (on) theme.spacing.borderWidth * 2 else theme.spacing.borderWidth, if (on) c.accent else c.border, theme.shapes.mdShape)
                    .then(sel)
                    .alpha(if (ch.enabled) 1f else theme.opacityDisabled)
                    .padding(theme.spacing.x(0.75)),
                verticalArrangement = Arrangement.spacedBy(theme.spacing.x(0.35)),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.half)) {
                    val ic = ch.icon
                    if (ic != null) AxfIcon(ic, size = 16.dp, tint = c.text, contentDescription = null)
                    Text(ch.title, Modifier.weight(1f), style = theme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold), color = c.text)
                    if (on) AxfIcon("check", size = 14.dp, tint = c.accent, contentDescription = null)
                }
                val tx = ch.text
                if (tx != null) Text(tx, style = theme.typography.bodySmall, color = c.muted)
                val tag = ch.tag
                if (tag != null) Text(tag, style = theme.typography.labelSmall, color = c.muted, modifier = Modifier.background(c.surface2, theme.shapes.full).padding(horizontal = theme.spacing.x(0.4)))
            }
        }
    }
}

/** Tones of [AxfNote]: info (accent tint), warning, danger, success. */
public enum class NoteTone(public val id: String) { INFO("info"), WARNING("warning"), DANGER("danger"), SUCCESS("success") }

/** Web `Note`: inline callout with an icon; warning and danger notes are announced. */
@Composable
public fun AxfNote(text: String, modifier: Modifier = Modifier, tone: NoteTone = NoteTone.INFO, icon: String? = null) {
    AxfNote(modifier, tone, icon) { Text(text, style = Axf.theme.typography.bodySmall, color = Axf.colors.text) }
}

@Composable
public fun AxfNote(modifier: Modifier = Modifier, tone: NoteTone = NoteTone.INFO, icon: String? = null, content: @Composable ColumnScope.() -> Unit) {
    val theme = Axf.theme
    val c = theme.colors
    val base = when (tone) { NoteTone.INFO -> c.accent; NoteTone.WARNING -> c.warning; NoteTone.DANGER -> c.danger; NoteTone.SUCCESS -> c.success }
    val name = icon ?: when (tone) { NoteTone.WARNING, NoteTone.DANGER -> "alert"; NoteTone.SUCCESS -> "check"; NoteTone.INFO -> "info" }
    val alert = tone == NoteTone.WARNING || tone == NoteTone.DANGER
    Row(
        modifier.fillMaxWidth().clip(theme.shapes.smShape).background(base.copy(alpha = theme.opacityTint), theme.shapes.smShape)
            .padding(horizontal = theme.spacing.x(0.75), vertical = theme.spacing.x(0.6))
            .semantics { if (alert) liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(theme.spacing.half), verticalAlignment = Alignment.Top,
    ) {
        AxfIcon(name, size = 14.dp, tint = base, contentDescription = tone.id, modifier = Modifier.padding(top = theme.spacing.x(0.15)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(theme.spacing.x(0.25))) { content() }
    }
}

/** Web `Section`: a titled block without card chrome (heading row with an optional aside). */
@Composable
public fun AxfSection(title: String, modifier: Modifier = Modifier, aside: (@Composable RowScope.() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val theme = Axf.theme
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(theme.spacing.x(0.75))) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.one)) {
            Text(title, Modifier.weight(1f).semantics { heading() }, style = theme.typography.titleSmall.copy(fontWeight = theme.typography.headingWeight), color = theme.colors.text)
            if (aside != null) aside()
        }
        content()
    }
}

/**
 * Web `LibraryParamField`: renders a library@1 parameter by type — bool → AxfSwitch, choice → AxfChoiceGrid (single),
 * list → multi-line AxfTextField, number / text → AxfTextField; shows the help and the error from `LibraryParam.validate`.
 * `value` is the answer as text (see `LibraryParams`).
 */
@Composable
public fun AxfLibraryParamField(p: LibraryParam, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val err: String? = p.validate(value)
    val def: String = p.defaultText
    when (p.type) {
        "bool" -> AxfSwitch(p.isTrue(value), { onChange(it.toString()) }, modifier, label = p.label, description = p.help, enabled = enabled)
        "choice" -> {
            val current = value.trim().ifBlank { def }
            AxfField(p.label, modifier, hint = p.help, error = err, required = p.required) {
                AxfChoiceGrid(p.choices.map { Choice(it, it, enabled = enabled) }, if (current.isBlank()) emptySet() else setOf(current), { onChange(it) }, label = p.label)
            }
        }
        else -> {
            val list = p.type == "list"
            AxfField(p.label, modifier, hint = p.help, error = err, required = p.required) {
                AxfTextField(
                    value, onChange, Modifier.fillMaxWidth(), placeholder = def.ifBlank { if (list) "one, two, three" else null },
                    enabled = enabled, monospace = list, singleLine = !list, minLines = if (list) 2 else 1,
                )
            }
        }
    }
}
