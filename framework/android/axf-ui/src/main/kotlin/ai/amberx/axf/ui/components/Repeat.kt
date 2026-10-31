package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.engine.CompiledRepeat
import ai.amberx.axf.kernel.engine.Region
import ai.amberx.axf.kernel.engine.RepeatEngine
import ai.amberx.axf.kernel.engine.RepeatFallback
import ai.amberx.axf.kernel.engine.RepeatItem
import ai.amberx.axf.kernel.engine.RepeatStyle
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import kotlinx.serialization.json.JsonElement

/*
 * Repeating slots (layout.repeat, kernel RepeatEngine), twin of web components/Repeat.tsx. A screen declares its data
 * sets with PageDataSets(sets) { … }; AxfRepeatingSlot(id) draws one item per entry of the set the active layout names,
 * in the layout's style (tabs, cards, grid, stacked), or the slot's fallback when the screen declares none or it is
 * empty. Swapping the layout swaps the style; the screen never decides it.
 */

/** Data sets the current screen declares (name -> JSON array of entries). */
public val LocalPageDataSets: ProvidableCompositionLocal<Map<String, JsonElement?>> = compositionLocalOf { emptyMap() }

/** A screen declares the data sets its layout's repeating slots draw from; nested declarations add to (and override) outer ones. */
@Composable
public fun PageDataSets(sets: Map<String, JsonElement?>, content: @Composable () -> Unit) {
    val outer = LocalPageDataSets.current
    val merged = remember(outer, sets) { outer + sets }
    CompositionLocalProvider(LocalPageDataSets provides merged, content = content)
}

/** One repeating slot of the active layout, by id. Draws nothing when the layout has no slot by that id. */
@Composable
public fun AxfRepeatingSlot(
    id: String,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    fallback: @Composable (RepeatFallback, CompiledRepeat) -> Unit = { f, _ -> RepeatFallbackLabel(f) },
    item: @Composable (RepeatItem, CompiledRepeat) -> Unit = { i, _ -> Text(i.label, style = Axf.type.bodyMedium, color = Axf.theme.colors.text) },
) {
    val layout = LocalAxfCompiled.current.layout
    val sets = LocalPageDataSets.current
    var active by remember { mutableStateOf(emptyMap<String, String>()) }
    val def = layout.repeat.firstOrNull { (it as? kotlinx.serialization.json.JsonObject)?.get("id")?.let { v -> (v as? kotlinx.serialization.json.JsonPrimitive)?.content } == id } ?: return
    val slot = RepeatEngine.compile(def, sets, active) ?: return
    AxfRepeatView(slot, modifier, compact, onSelect = { key -> active = active + (id to key) }, fallback = fallback, item = item)
}

/** Every repeating slot the active layout puts in `region`, in order. */
@Composable
public fun AxfRepeatingSlots(
    region: Region,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    fallback: @Composable (RepeatFallback, CompiledRepeat) -> Unit = { f, _ -> RepeatFallbackLabel(f) },
    item: @Composable (RepeatItem, CompiledRepeat) -> Unit = { i, _ -> Text(i.label, style = Axf.type.bodyMedium, color = Axf.theme.colors.text) },
) {
    val layout = LocalAxfCompiled.current.layout
    val sets = LocalPageDataSets.current
    var active by remember { mutableStateOf(emptyMap<String, String>()) }
    val slots = RepeatEngine.repeatsIn(RepeatEngine.compileAll(layout, sets, active), region)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Axf.theme.spacing.one)) {
        for (s in slots) AxfRepeatView(s, Modifier, compact, onSelect = { key -> active = active + (s.id to key) }, fallback = fallback, item = item)
    }
}

@Composable
private fun RepeatFallbackLabel(f: RepeatFallback) {
    val label = f.label ?: return
    Text(label, style = Axf.type.bodyMedium, color = Axf.theme.colors.muted, modifier = Modifier.padding(Axf.theme.spacing.one))
}

/** Draws a compiled slot (web `RepeatView`). `compact` = phone width: grid and cards fall to one column, like the web's media query. */
@Composable
public fun AxfRepeatView(
    slot: CompiledRepeat,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onSelect: ((String) -> Unit)? = null,
    fallback: @Composable (RepeatFallback, CompiledRepeat) -> Unit = { f, _ -> RepeatFallbackLabel(f) },
    item: @Composable (RepeatItem, CompiledRepeat) -> Unit = { i, _ -> Text(i.label, style = Axf.type.bodyMedium, color = Axf.theme.colors.text) },
) {
    val theme = Axf.theme
    val c = theme.colors
    val gap = theme.spacing.one
    if (slot.empty) { Box(modifier) { fallback(slot.fallback ?: RepeatFallback(), slot) }; return }
    val more: @Composable () -> Unit = {
        if (slot.overflow > 0) Text("+${slot.overflow}", style = Axf.type.bodySmall, color = c.muted, modifier = Modifier.padding(horizontal = theme.spacing.half))
    }
    when (slot.style) {
        RepeatStyle.TABS -> {
            var local by remember(slot.id) { mutableStateOf<String?>(null) }
            val key = local?.takeIf { k -> slot.items.any { it.key == k } } ?: slot.active
            val current = slot.items.firstOrNull { it.key == key } ?: slot.items.first()
            Column(modifier, verticalArrangement = Arrangement.spacedBy(gap)) {
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).drawBottomBorder(c.border, theme.spacing.borderWidth), verticalAlignment = Alignment.CenterVertically) {
                    for (entry in slot.items) {
                        val on = entry.key == current.key
                        Row(
                            Modifier.clickable(role = Role.Tab) { local = entry.key; onSelect?.invoke(entry.key) }
                                .then(if (on) Modifier.drawBottomBorder(c.accent, theme.spacing.borderWidth * 2) else Modifier)
                                .padding(horizontal = theme.spacing.oneHalf, vertical = theme.spacing.one),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.half),
                        ) {
                            if (entry.icon != null) AxfIcon(entry.icon, size = theme.spacing.iconSize, tint = if (on) c.text else c.muted, contentDescription = null)
                            Text(entry.label, style = Axf.type.bodyMedium, color = if (on) c.text else c.muted, maxLines = 1)
                        }
                    }
                    more()
                }
                item(current, slot)
            }
        }
        RepeatStyle.STACKED -> Column(modifier, verticalArrangement = Arrangement.spacedBy(gap)) {
            for (entry in slot.items) item(entry, slot)
            more()
        }
        RepeatStyle.GRID, RepeatStyle.CARDS -> {
            val cols = if (compact) 1 else slot.columns
            Column(modifier, verticalArrangement = Arrangement.spacedBy(gap)) {
                for (row in slot.items.chunked(cols)) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(gap)) {
                    for (entry in row) Box(Modifier.weight(1f)) {
                        if (slot.style == RepeatStyle.CARDS) M3Container(title = entry.label, icon = entry.icon) { item(entry, slot) } else item(entry, slot)
                    }
                    repeat(cols - row.size) { Spacer(Modifier.weight(1f)) }
                }
                more()
            }
        }
    }
}
