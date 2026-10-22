package ai.amberx.axf.ui.settings

import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.contract.asText
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * Generic renderer for a settings group: one control per [SettingKind]. `values` holds the current value
 * per key (JSON), `onChange` writes one. ASSET_SLOT settings list the assets of their type and hot-swap on
 * tap; ACTION settings dispatch; LINK settings navigate. lib-settings wires this to its store.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun SettingsGroupView(group: SettingsGroup, values: Map<String, JsonElement>, onChange: (String, JsonElement) -> Unit, modifier: Modifier = Modifier, filter: String = "") {
    val runtime = LocalAxfRuntime.current
    val uac = LocalAxfUac.current
    val actions = LocalAxfActions.current
    val state = LocalAxfState.current
    val compiled = LocalAxfCompiled.current
    val visible = group.settings.filter { (filter.isBlank() || it.label.contains(filter, true) || it.key.contains(filter, true) || (it.description?.contains(filter, true) == true)) && uac.gate(it.requires) != Gate.HIDE }
    if (visible.isEmpty()) return
    AxfCard(modifier, title = group.label, icon = group.icon) {
        if (group.description != null) AxfText(group.description!!, muted = true)
        Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            for (s in visible) {
                // A setting about a hidden slot (Appearance → Assets → Hidden) is greyed out until it's shown again.
                val off = s.slot?.let { runtime.slotHidden(it) } == true
                val enabled = !off && uac.gate(s.requires) == Gate.ALLOW
                val v = values[s.key] ?: s.default
                when (s.kind) {
                    SettingKind.SECTION -> ai.amberx.axf.ui.components.AxfSectionHeader(s.label, accent = true)
                    SettingKind.TOGGLE -> AxfSwitch(v.asText().toBooleanStrictOrNull() ?: false, { onChange(s.key, JsonPrimitive(it)) }, label = s.label, description = s.description, enabled = enabled)
                    SettingKind.TEXT -> AxfTextField(v.asText(), { onChange(s.key, JsonPrimitive(it)) }, Modifier.fillMaxWidth(), label = s.label, placeholder = s.description, enabled = enabled)
                    SettingKind.SECRET -> AxfTextField(v.asText(), { onChange(s.key, JsonPrimitive(it)) }, Modifier.fillMaxWidth(), label = s.label, placeholder = s.description, enabled = enabled, secret = true)
                    SettingKind.NUMBER -> AxfTextField(v.asText(), { t -> t.toDoubleOrNull()?.let { onChange(s.key, JsonPrimitive(it)) } ?: if (t.isEmpty()) onChange(s.key, JsonPrimitive("")) else Unit }, Modifier.fillMaxWidth(), label = s.label, placeholder = s.description, enabled = enabled, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    SettingKind.SLIDER -> AxfSlider(s.label, v.asText().toFloatOrNull() ?: (s.min ?: 0.0).toFloat(), { onChange(s.key, JsonPrimitive(it)) }, min = (s.min ?: 0.0).toFloat(), max = (s.max ?: 100.0).toFloat(), step = (s.step ?: 1.0).toFloat(), enabled = enabled)
                    SettingKind.CHOICE -> Column { AxfText(s.label); FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for ((id, label) in s.options) AxfChip(label, selected = v.asText() == id, onClick = if (enabled) ({ onChange(s.key, JsonPrimitive(id)) }) else null) } }
                    SettingKind.MULTI_CHOICE -> { val set = v.asText().split(',').filter { it.isNotBlank() }.toSet(); Column { AxfText(s.label); FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for ((id, label) in s.options) AxfChip(label, selected = id in set, onClick = if (enabled) ({ onChange(s.key, JsonPrimitive((if (id in set) set - id else set + id).joinToString(","))) }) else null) } } }
                    SettingKind.COLOR -> { val rgba = ai.amberx.axf.kernel.engine.Rgba.parse(v.asText()); AxfListItem(s.label, subtitle = v.asText(), trailing = { Box(Modifier.size(22.dp).background(rgba?.let { Color(it.r, it.g, it.b, (it.a * 255).toInt()) } ?: Axf.colors.border, Axf.shapes.xsShape)) }); AxfTextField(v.asText(), { onChange(s.key, JsonPrimitive(it)) }, Modifier.fillMaxWidth(), monospace = true, enabled = enabled) }
                    SettingKind.ASSET_SLOT -> { val type = s.target ?: ""; val list = runtime.registry.list(type); val active = state.active[type]
                        // Chrome slots (hideable in asset-types.json) also offer Hidden.
                        val canHide = ai.amberx.axf.kernel.engine.HideEngine.hideable(runtime.registry.types, type); val hidden = runtime.slotHidden(type)
                        // embed@1: a host app shows this chrome for the app; the choice is the host's until the app runs on its own.
                        val byHost = runtime.slotHiddenByHost(type); val pickable = enabled && !byHost
                        Column { AxfText(s.label); if (s.description != null) AxfText(s.description!!, muted = true); FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            for (a in list) AxfChip(a.name, selected = !hidden && a.id == active, onClick = if (pickable) ({ if (hidden) runtime.setSlotHidden(type, false); if (a.id != active) runtime.swap(type, a.id) }) else null)
                            if (canHide) AxfChip(if (byHost) "Shown by ${runtime.embedded?.host}" else "Hidden", selected = hidden, onClick = if (pickable) ({ runtime.setSlotHidden(type, true) }) else null)
                        } } }
                    SettingKind.ACTION -> AxfListItem(s.label, subtitle = s.description, icon = s.icon ?: "zap", enabled = enabled, onClick = { s.target?.let { actions.dispatch(it) } }, trailing = { AxfBadge("run") })
                    SettingKind.LINK -> AxfListItem(s.label, subtitle = s.description, icon = s.icon ?: "chevron-right", enabled = enabled, onClick = { s.target?.let { runtime.navigate(it) } })
                    SettingKind.CUSTOM -> AxfListItem(s.label, subtitle = s.description ?: "Custom setting (rendered by its module)", icon = s.icon ?: "box", enabled = enabled)
                }
                if (s.restartRequired) AxfText("Takes effect after restart.", muted = true)
                if (off) AxfText("${runtime.registry.types.get(s.slot!!)?.label ?: s.slot} is hidden (Assets above).", muted = true)
            }
        }
    }
}
