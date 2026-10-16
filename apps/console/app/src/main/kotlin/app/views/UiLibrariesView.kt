package ai.amberx.axf.console.views

import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.kernel.contract.TabSpec
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfCheckbox
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.kit.AxfUiKits
import ai.amberx.axf.ui.kit.LocalAxfUiKits
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.ui.windows.DockArea
import ai.amberx.axf.ui.windows.LocalWindowManager
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** A UI library the framework knows about: hot-swappable AXF kits, or third-party/existing libraries with an adapter status. */
data class UiLibrary(val id: String, val name: String, val vendor: String, val stack: String, val status: String, val note: String, val kitId: String? = null)

val THIRD_PARTY_UI = listOf(
    UiLibrary("m3", "Material 3 (Compose)", "Google", "androidx.compose.material3", "adapter", "The port's built-in kit.", "material3"),
    UiLibrary("m2", "Material 2 (Compose)", "Google", "androidx.compose.material", "planned", "Kit mapping ComponentKind → Material 2 widgets."),
    UiLibrary("foundation", "Compose Foundation (unstyled)", "Google", "androidx.compose.foundation", "adapter", "Headless kit built from foundation only.", "unstyled"),
    UiLibrary("cupertino", "Compose Cupertino", "alexzhirkevich", "io.github.alexzhirkevich:cupertino", "planned", "iOS-style widgets; kit covers controls + sheets."),
    UiLibrary("unstyled", "Compose Unstyled", "composables.com", "com.composables:core", "planned", "Accessible headless primitives."),
    UiLibrary("glance", "Jetpack Glance", "Google", "androidx.glance", "planned", "Home-screen widgets; kit covers WIDGET kinds only."),
    UiLibrary("wear", "Compose for Wear OS", "Google", "androidx.wear.compose", "placeholder", "Wear port kit."),
    UiLibrary("tv", "Compose for TV", "Google", "androidx.tv", "placeholder", "TV port kit."),
    UiLibrary("accompanist", "Accompanist", "Google", "com.google.accompanist", "planned", "Permissions/flow layouts helpers, not a kit by itself."),
    UiLibrary("lottie", "Lottie Compose", "Airbnb", "com.airbnb.android:lottie-compose", "planned", "Animations for the motion-pack asset."),
    UiLibrary("coil", "Coil", "coil-kt", "io.coil-kt:coil-compose", "planned", "Image loading for image-pack assets and MEDIA kinds."),
    UiLibrary("vico", "Vico charts", "patrykandpatrick", "com.patrykandpatrick.vico", "planned", "CHART kind."),
    UiLibrary("maplibre", "MapLibre", "MapLibre", "org.maplibre.gl", "planned", "MAP kind."),
    UiLibrary("media3", "Media3 UI", "Google", "androidx.media3:media3-ui", "planned", "MEDIA_PLAYER kind."),
    UiLibrary("mui", "MUI (web port)", "MUI", "@mui/material", "placeholder", "React kit for the web port."),
    UiLibrary("shadcn", "shadcn/ui (web port)", "shadcn", "shadcn/ui", "placeholder", "React kit for the web port."),
    UiLibrary("pyqt", "Qt Widgets (python port)", "Qt", "PyQt6.QtWidgets", "placeholder", "Python/PyQt6 port kit."),
)

/**
 * The nested "UI libraries" tab of the library manager: left pane = hot-swappable AXF kits (from the kernel's
 * extension point + ui-kit assets), right pane = third-party/existing libraries. Multi-select from either and
 * Compare opens every selection as a tab in one floating tab group (undockable, splittable, drag-and-drop).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UiLibrariesTab() {
    val runtime = LocalAxfRuntime.current
    val kits = LocalAxfUiKits.current
    val wm = LocalWindowManager.current
    val state by runtime.state.collectAsState()
    var selected by remember { mutableStateOf<Set<String>>(emptySet()) }
    val activeKit = runtime.asset(AssetTypes.UI_KIT)?.data?.let { ai.amberx.axf.kernel.asset.strOrNull(it, "kit") } ?: "material3"
    val hotSwappable = kits.kits.map { k -> UiLibrary("kit:${k.spec.id}", k.spec.label, k.spec.module, k.spec.library, if (k.spec.id == activeKit) "active" else "ready", "${k.spec.covers.size}/${ComponentKind.entries.size} component kinds", k.spec.id) }
    val thirdParty = THIRD_PARTY_UI.filter { tp -> hotSwappable.none { it.kitId == tp.kitId && tp.kitId != null } }
    fun compare() {
        if (wm == null) { runtime.toast("Windows engine not installed.", ToastKind.WARNING); return }
        val all = hotSwappable + THIRD_PARTY_UI
        val tabs = selected.mapNotNull { id -> all.firstOrNull { it.id == id } }.map { lib -> TabSpec("cmp-${lib.id}-${System.nanoTime().toString(36)}", lib.name, if (lib.kitId != null) "kit-preview" else "library-info", lib.kitId ?: lib.id, icon = if (lib.kitId != null) "grid" else "box") }
        if (tabs.isEmpty()) { runtime.toast("Select at least one library to compare.", ToastKind.WARNING); return }
        wm.openFloating(tabs, "Compare: ${tabs.size} libraries", width = 400f, height = 520f)
    }
    val pane: @Composable (String, List<UiLibrary>) -> Unit = { title, libs ->
        AxfCard(title = title, icon = "grid", actions = { AxfBadge("${libs.count { it.id in selected }}/${libs.size}") }) {
            Column {
                for (lib in libs) Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AxfCheckbox(lib.id in selected, { on -> selected = if (on) selected + lib.id else selected - lib.id })
                    Column(Modifier.weight(1f)) { AxfText(lib.name); AxfText("${lib.vendor} · ${lib.stack} · ${lib.note}", muted = true) }
                    AxfBadge(lib.status, tone = when (lib.status) { "active" -> "success"; "ready", "adapter" -> "info"; "planned" -> "warning"; else -> "accent" })
                    if (lib.kitId != null && lib.status != "active" && hotSwappable.any { it.id == lib.id }) AxfButton("Swap", { runtime.swap(AssetTypes.UI_KIT, lib.kitId).let { ok -> if (!ok) runtime.toast("Add a ui-kit asset with kit \"${lib.kitId}\" to swap to it.", ToastKind.INFO) } }, icon = "zap", requires = "assets.swap")
                }
            }
        }
    }
    LazyColumn(Modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("UI libraries", eyebrow = "active kit: $activeKit · ${selected.size} selected", description = "Left: kits that hot-swap into any AXF app. Right: third-party / existing libraries and their adapter status. Select from either pane and compare them side by side in floating tabs.", actions = {
            AxfButton("Compare", { compare() }, tone = ButtonTone.PRIMARY, icon = "layers", enabled = selected.isNotEmpty())
            AxfButton("Clear", { selected = emptySet() }, icon = "x")
        }) }
        item { pane("Hot-swappable (AXF kits)", hotSwappable) }
        item { pane("Third-party / existing", thirdParty) }
        item { AxfSectionHeader("Docked comparisons", accent = true) }
        item { if (wm != null) androidx.compose.foundation.layout.Box(Modifier.fillMaxWidth().height(360.dp)) { DockArea(wm, empty = { AxfEmptyState("Nothing docked", message = "Redock a floating comparison window and its tab groups land here.") }) } }
    }
}

/** Tab renderer for `kit-preview`: the element explorer (preview pane + categorized tree of elements, tokens, style parameters and flags) forced to that kit. */
@Composable
fun KitPreviewTab(kitId: String) { ai.amberx.axf.ui.studio.ElementExplorer(kitId) }

/** Tab renderer for `library-info`: a third-party library without a kit yet. */
@Composable
fun LibraryInfoTab(id: String) {
    val lib = THIRD_PARTY_UI.firstOrNull { it.id == id } ?: return AxfEmptyState("Unknown library")
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Axf.space.oneHalf), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        AxfText(lib.name, style = Axf.type.titleMedium); AxfText("${lib.vendor} · ${lib.stack}", muted = true); AxfBadge(lib.status, tone = if (lib.status == "planned") "warning" else "accent")
        AxfText(lib.note)
        AxfText("To make it hot-swappable: implement AxfComponents for the kinds it covers, contribute an AxfUiKit to ExtensionPoints.UI_KITS and ship a ui-kit asset. Until then this tab is informational.", muted = true)
    }
}
