package ai.amberx.axf.ui.studio

import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfCheckbox
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfDivider
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfErrorState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfLoadingState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSegmented
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.kit.LocalAxfUiKits
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Every control in every variant and state, rendered through the active UI kit, with a kit switcher. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun ComponentGallery(modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val kits = LocalAxfUiKits.current
    var text by remember { mutableStateOf("Hello AXF") }
    var on by remember { mutableStateOf(true) }
    var checked by remember { mutableStateOf(false) }
    var slider by remember { mutableFloatStateOf(40f) }
    var seg by remember { mutableStateOf("a") }
    val kitName = { kind: ComponentKind -> kits.kitFor(kind).spec.label }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item {
            AxfPageHead("Components", eyebrow = "UI kit: ${kits.kitFor(ComponentKind.BUTTON).spec.label}", description = "Every control reads the active button / slider / container / dialog / popup / context-menu assets and the active UI kit.", actions = {
                AxfButton("Next kit", { actions.dispatch("swap:${AssetTypes.UI_KIT}:next") }, icon = "grid")
                AxfButton("Next button", { actions.dispatch("swap:button:next") }, icon = "zap")
                AxfButton("Next slider", { actions.dispatch("swap:slider:next") }, icon = "sliders")
                AxfButton("Next container", { actions.dispatch("swap:container:next") }, icon = "box")
            })
        }
        item { AxfCard(title = "Buttons", actions = { AxfBadge(kitName(ComponentKind.BUTTON)) }) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AxfButton("Primary", {}, tone = ButtonTone.PRIMARY, icon = "zap"); AxfButton("Neutral", {}); AxfButton("Danger", {}, tone = ButtonTone.DANGER, icon = "trash"); AxfButton("Ghost", {}, tone = ButtonTone.GHOST)
                AxfButton("Disabled", {}, enabled = false); AxfButton("Needs deploy", {}, requires = "dev.deploy", icon = "lock")
                AxfIconButton("settings", "Settings", {}); AxfIconButton("star", "Star", {}, active = true)
            }
        } }
        item { AxfCard(title = "Inputs", actions = { AxfBadge(kitName(ComponentKind.TEXT_FIELD)) }) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), label = "Text field", placeholder = "Type…", leadingIcon = "edit")
                AxfTextField("", {}, Modifier.fillMaxWidth(), label = "Secret", secret = true, placeholder = "••••••")
                AxfTextField("not valid", {}, Modifier.fillMaxWidth(), label = "With error", error = "This value is not allowed.")
                AxfSwitch(on, { on = it }, label = "Switch", description = "With a description line")
                AxfCheckbox(checked, { checked = it }, label = "Checkbox")
                AxfSegmented(listOf("a" to "One", "b" to "Two", "c" to "Three"), seg, { seg = it })
                AxfSlider("Slider", slider, { slider = it }, unit = "%")
            }
        } }
        item { AxfCard(title = "Chips & badges", actions = { AxfBadge(kitName(ComponentKind.CHIP)) }) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                AxfChip("Default"); AxfChip("Selected", selected = true, onClick = {}); AxfChip("Success", tone = "success", icon = "check"); AxfChip("Warning", tone = "warning"); AxfChip("Danger", tone = "danger")
                AxfBadge("accent"); AxfBadge("3", tone = "danger"); AxfBadge("new", tone = "success")
            }
        } }
        item { AxfCard(title = "Lists", actions = { AxfBadge(kitName(ComponentKind.LIST_ITEM)) }) {
            Column { AxfSectionHeader("Section"); AxfListItem("First item", subtitle = "Subtitle", icon = "file", onClick = {}); AxfDivider(); AxfListItem("Selected item", icon = "star", selected = true, onClick = {}); AxfListItem("Disabled", icon = "lock", enabled = false, trailing = { AxfBadge("off") }) }
        } }
        item { AxfCard(title = "Containers", actions = { AxfBadge(kitName(ComponentKind.CARD)) }) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { AxfCard(title = "Nested card", icon = "box") { AxfText("Cards follow the container asset: card / panel / glass / outline, header plain / divided / accent.") } }
        } }
        item { AxfCard(title = "States") {
            Column { AxfEmptyState("Nothing here yet", message = "Empty state with an action", action = { AxfButton("Add", {}, tone = ButtonTone.PRIMARY, icon = "plus") }); AxfLoadingState(); AxfErrorState("Could not load", message = "Error state with retry", retry = {}) }
        } }
        item { AxfCard(title = "Overlays") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AxfButton("Dialog", { runtime.openDialog("about") }, icon = "box"); AxfButton("Toast", { actions.dispatch("toast:success:Saved:Everything is in order") }, icon = "bell"); AxfButton("Shortcuts", { runtime.openDialog("shortcuts") }, icon = "keyboard")
            }
        } }
    }
}
