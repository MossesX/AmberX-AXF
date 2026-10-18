package ai.amberx.axf.ui.studio

import ai.amberx.axf.kernel.asset.AssetEnvelope
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfCompiled
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
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSegmented
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.axfContextMenu
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.kit.AxfUiKits
import ai.amberx.axf.ui.kit.LocalAxfUiKits
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import ai.amberx.axf.kernel.contract.TabSpec
import ai.amberx.axf.kernel.contract.WindowType
import ai.amberx.axf.ui.windows.LocalWindowManager
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * Element explorer: a categorized, collapsible tree of every UI element the framework renders, each with
 * branches for the color tokens and style parameters it reads and a root "Element options" branch of on/off
 * flags. Every row has a tooltip (long-press); rows are greyed out when the active kit does not cover the
 * element, editable inline otherwise. Edits derive a custom copy of the relevant asset (color-theme,
 * style-theme or the component asset) and import it, so the preview pane hot-swaps immediately.
 */

public data class StyleParam(val key: String, val label: String, val tooltip: String, val assetType: String, val path: List<String>, val kind: String, val min: Float = 0f, val max: Float = 100f, val options: List<String> = emptyList())
public data class FlagSpec(val key: String, val label: String, val tooltip: String, val assetType: String, val path: List<String>)
public data class ElementSpec(val kind: ComponentKind, val label: String, val category: String, val tooltip: String, val tokens: List<Pair<String, String>>, val params: List<StyleParam>, val flags: List<FlagSpec>)

private fun p(key: String, label: String, tip: String, type: String, vararg path: String, kind: String = "number", min: Float = 0f, max: Float = 100f, options: List<String> = emptyList()) = StyleParam(key, label, tip, type, path.toList(), kind, min, max, options)
private fun f(key: String, label: String, tip: String, type: String, vararg path: String) = FlagSpec(key, label, tip, type, path.toList())
private val T = AssetTypes
private val radius = listOf(p("radius.sm", "Radius sm", "Small corner radius (style-theme)", T.STYLE_THEME, "radius", "sm", max = 24f), p("radius.md", "Radius md", "Medium corner radius", T.STYLE_THEME, "radius", "md", max = 32f), p("radius.lg", "Radius lg", "Large corner radius", T.STYLE_THEME, "radius", "lg", max = 40f))
private val spacing = listOf(p("space", "Spacing unit", "Base spacing unit; every padding is a multiple", T.STYLE_THEME, "space", min = 4f, max = 16f), p("density", "Density", "compact / comfortable / spacious scales row heights and paddings", T.STYLE_THEME, "density", kind = "enum", options = listOf("compact", "comfortable", "spacious")))
private val type = listOf(p("fontSize", "Font size", "Base font size (sp)", T.STYLE_THEME, "fontSize", min = 10f, max = 20f), p("headingWeight", "Heading weight", "Font weight of headings", T.STYLE_THEME, "headingWeight", min = 300f, max = 900f))

/** The element catalog: what each kind reads. Shared by every app's explorer. */
public val ELEMENTS: List<ElementSpec> = listOf(
    ElementSpec(ComponentKind.BUTTON, "Button", "Controls", "Primary / neutral / danger / ghost buttons from the button asset", listOf("accent" to "Primary fill", "accentText" to "Text on primary", "surface2" to "Neutral fill", "border" to "Outline", "danger" to "Danger fill", "text" to "Neutral text"),
        listOf(p("shape", "Shape", "rounded / pill / square", T.BUTTON, "shape", kind = "enum", options = listOf("rounded", "pill", "square")), p("fill", "Fill", "solid / soft / outline / gradient", T.BUTTON, "fill", kind = "enum", options = listOf("solid", "soft", "outline", "gradient")), p("weight", "Label weight", "Font weight of the label", T.BUTTON, "weight", min = 300f, max = 900f), p("size", "Size", "sm / md / lg paddings", T.BUTTON, "size", kind = "enum", options = listOf("sm", "md", "lg"))) + radius.take(2),
        listOf(f("elevation", "Elevation", "Drop shadow under buttons", T.BUTTON, "elevation"), f("uppercase", "Uppercase labels", "Uppercase with tracking", T.BUTTON, "uppercase"))),
    ElementSpec(ComponentKind.ICON_BUTTON, "Icon button", "Controls", "Square icon-only button", listOf("muted" to "Icon tint", "accentSoft" to "Active background"), radius.take(1), emptyList()),
    ElementSpec(ComponentKind.SWITCH, "Switch", "Controls", "On/off toggle with label", listOf("accent" to "On track", "surface3" to "Off track", "accentText" to "Thumb on"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.CHECKBOX, "Checkbox", "Controls", "Checkbox with label", listOf("accent" to "Checked", "border" to "Unchecked border"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.CHIP, "Chip", "Controls", "Filter / tone chips", listOf("accent" to "Selected", "surface2" to "Default", "successSoft" to "Success tone", "warningSoft" to "Warning tone", "dangerSoft" to "Danger tone"), radius.take(1), emptyList()),
    ElementSpec(ComponentKind.SEGMENTED, "Segmented", "Controls", "Segmented control", listOf("surface2" to "Track", "accent" to "Selected"), radius.take(1), emptyList()),
    ElementSpec(ComponentKind.SLIDER, "Slider", "Controls", "Slider from the slider asset", listOf("accent" to "Fill", "surface3" to "Track", "gradientStart" to "Gradient start", "gradientEnd" to "Gradient end"),
        listOf(p("track", "Track height", "Track thickness (dp)", T.SLIDER, "track", min = 2f, max = 14f), p("thumbSize", "Thumb size", "Thumb diameter (dp)", T.SLIDER, "thumbSize", min = 10f, max = 32f), p("thumb", "Thumb shape", "circle / square / bar", T.SLIDER, "thumb", kind = "enum", options = listOf("circle", "square", "bar")), p("fill", "Fill", "solid / gradient / none", T.SLIDER, "fill", kind = "enum", options = listOf("solid", "gradient", "none")), p("showValue", "Show value", "always / hover / never", T.SLIDER, "showValue", kind = "enum", options = listOf("always", "hover", "never"))),
        listOf(f("ticks", "Ticks", "Tick marks along the track", T.SLIDER, "ticks"))),
    ElementSpec(ComponentKind.TEXT_FIELD, "Text field", "Inputs", "Single/multi-line input", listOf("bg" to "Field background", "border" to "Border", "accent" to "Focus border", "placeholder" to "Placeholder", "danger" to "Error"), radius.take(1) + type.take(1), emptyList()),
    ElementSpec(ComponentKind.PASSWORD_FIELD, "Password field", "Inputs", "Masked input with reveal", listOf("bg" to "Background", "border" to "Border"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.SEARCH_FIELD, "Search field", "Inputs", "Toolbar search", listOf("bg" to "Background", "muted" to "Icon"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.CARD, "Card / container", "Containers", "Card from the container asset", listOf("surface" to "Card", "border" to "Border", "accent" to "Accent header", "glassTint" to "Glass tint", "shadow" to "Shadow"),
        listOf(p("variant", "Variant", "card / panel / glass / outline", T.CONTAINER, "variant", kind = "enum", options = listOf("card", "panel", "glass", "outline")), p("header", "Header", "plain / divided / accent", T.CONTAINER, "header", kind = "enum", options = listOf("plain", "divided", "accent")), p("padding", "Padding", "sm / md / lg", T.CONTAINER, "padding", kind = "enum", options = listOf("sm", "md", "lg")), p("elevation", "Elevation", "0–3 shadow level", T.CONTAINER, "elevation", max = 3f)) + radius.drop(2),
        listOf(f("collapsible", "Collapsible", "Header toggles the body", T.CONTAINER, "collapsible"), f("wrapGroups", "Wrap groups", "Every section / group gets a collapse toggle top-right (style-theme, --wrap-groups)", T.STYLE_THEME, "wrapGroups"))),
    ElementSpec(ComponentKind.LIST_ITEM, "List item", "Containers", "Row with icon, title, subtitle, trailing", listOf("text" to "Title", "muted" to "Subtitle", "surface3" to "Selected"), spacing, emptyList()),
    ElementSpec(ComponentKind.SECTION_HEADER, "Section header", "Containers", "Uppercase eyebrow", listOf("muted" to "Text", "accent" to "Accent"), type.drop(1), emptyList()),
    ElementSpec(ComponentKind.BADGE, "Badge", "Containers", "Small pill", listOf("accent" to "Accent", "danger" to "Danger", "success" to "Success"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.DIVIDER, "Divider", "Containers", "1px rule", listOf("border" to "Line"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.MENUBAR, "Menubar", "Navigation", "App menu from the app-menu asset", listOf("surface" to "Bar", "text" to "Items", "accentSoft" to "Open menu"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.TOOLBAR, "Toolbar", "Navigation", "Toolbar from the toolbar asset", listOf("toolbarBg" to "Background", "muted" to "Icons"), listOf(p("variant", "Variant", "icons / icons-labels / labels", T.TOOLBAR, "variant", kind = "enum", options = listOf("icons", "icons-labels", "labels")), p("align", "Align", "start / center / spread", T.TOOLBAR, "align", kind = "enum", options = listOf("start", "center", "spread"))), listOf(f("showSearch", "Search box", "Show the search field", T.TOOLBAR, "showSearch"))),
    ElementSpec(ComponentKind.NAV_LIST, "Navigation", "Navigation", "Nav from the nav-menu asset", listOf("navBg" to "Background", "navText" to "Items", "navActive" to "Active"), listOf(p("style", "Style", "list / pills / rail", T.NAV_MENU, "style", kind = "enum", options = listOf("list", "pills", "rail"))), emptyList()),
    ElementSpec(ComponentKind.STATUS_BAR, "Status bar", "Navigation", "Bottom status strip", listOf("statusBg" to "Background", "muted" to "Text"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.DIALOG, "Dialog", "Overlays", "Dialog from the dialog asset", listOf("surface" to "Panel", "scrim" to "Backdrop", "accent" to "Accent bar"), listOf(p("variant", "Variant", "modal / drawer / sheet", T.DIALOG, "variant", kind = "enum", options = listOf("modal", "drawer", "sheet")), p("backdrop", "Backdrop", "dim / blur / none", T.DIALOG, "backdrop", kind = "enum", options = listOf("dim", "blur", "none")), p("animation", "Animation", "scale / slide / fade", T.DIALOG, "animation", kind = "enum", options = listOf("scale", "slide", "fade")), p("width", "Width", "Max width (dp)", T.DIALOG, "width", min = 280f, max = 720f)), listOf(f("closeOnBackdrop", "Close on backdrop tap", "Tap outside to dismiss", T.DIALOG, "closeOnBackdrop"))),
    ElementSpec(ComponentKind.TOAST, "Toast", "Overlays", "Toasts from the popup asset", listOf("surface" to "Solid", "success" to "Success", "warning" to "Warning", "danger" to "Danger"), listOf(p("position", "Position", "Screen corner", T.POPUP, "position", kind = "enum", options = listOf("top-right", "bottom-right", "bottom-center", "top-center")), p("variant", "Variant", "solid / outline / minimal", T.POPUP, "variant", kind = "enum", options = listOf("solid", "outline", "minimal")), p("duration", "Duration", "ms before auto-dismiss (0 = sticky)", T.POPUP, "duration", max = 10000f), p("maxVisible", "Max visible", "Stack size", T.POPUP, "maxVisible", min = 1f, max = 6f)), listOf(f("showIcon", "Icon", "Kind icon on each toast", T.POPUP, "showIcon"))),
    ElementSpec(ComponentKind.CONTEXT_MENU, "Context menu", "Overlays", "Long-press menu from the context-menu asset", listOf("surface" to "Panel", "text" to "Items", "muted" to "Shortcuts"), listOf(p("variant", "Variant", "compact / roomy / glass", T.CONTEXT_MENU, "variant", kind = "enum", options = listOf("compact", "roomy", "glass"))), listOf(f("showIcons", "Icons", "Icon per item", T.CONTEXT_MENU, "showIcons"), f("showShortcuts", "Shortcuts", "Shortcut hints", T.CONTEXT_MENU, "showShortcuts"))),
    ElementSpec(ComponentKind.EMPTY_STATE, "Empty state", "States", "Empty / loading / error blocks", listOf("accentSoft" to "Icon disc", "muted" to "Message"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.PROGRESS, "Progress", "States", "Indeterminate progress", listOf("accent" to "Indicator"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.TABLE, "Table", "Data & media", "Data grid (library)", listOf("border" to "Grid lines"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.CHART, "Chart", "Data & media", "Charts (library)", listOf("chart1" to "Series 1", "chart2" to "Series 2", "chart3" to "Series 3"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.MEDIA_PLAYER, "Media player", "Data & media", "Video/audio player (library)", listOf("surface3" to "Surface"), emptyList(), emptyList()),
    ElementSpec(ComponentKind.MAP, "Map", "Data & media", "Map view (library)", listOf("surface2" to "Surface"), emptyList(), emptyList()),
)

/** Long-press tooltip wrapper used on every explorer row. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
public fun AxfTooltip(text: String, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    TooltipBox(positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(), tooltip = { PlainTooltip { androidx.compose.material3.Text(text) } }, state = rememberTooltipState(), modifier = modifier) { content() }
}

/** Preview + tree, or the grid view when the hosting window's mode is `grid`. `kitId` forces a kit (null = active). */
@Composable
public fun ElementExplorer(kitId: String? = null, modifier: Modifier = Modifier) {
    val mode = ai.amberx.axf.ui.windows.LocalWindowSpec.current?.mode ?: "tree"
    if (mode == "grid") { ElementGrid(kitId, modifier); return }
    val kits = LocalAxfUiKits.current
    val forced = remember(kits, kitId) { if (kitId == null) kits else AxfUiKits(kits.kits, kitId, emptyMap()) }
    var selected by remember { mutableStateOf(ComponentKind.BUTTON) }
    val spec = ELEMENTS.firstOrNull { it.kind == selected } ?: ELEMENTS.first()
    CompositionLocalProvider(LocalAxfUiKits provides forced) {
        Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Axf.space.oneHalf), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val kit = forced.kitFor(selected)
            AxfCard(title = "Preview · ${spec.label}", icon = "eye", actions = { AxfBadge(kit.spec.label, tone = if (kit.spec.id == (kitId ?: forced.activeId ?: kit.spec.id)) "success" else "warning") }) {
                Box(Modifier.fillMaxWidth().padding(4.dp)) { ElementPreview(spec.kind) }
                if (!kit.spec.covers(selected) || (kitId != null && kit.spec.id != kitId)) AxfText("Rendered by ${kit.spec.label} (fallback — the selected kit does not cover this element).", muted = true)
            }
            ElementTree(forced, kitId, selected) { selected = it }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun ElementTree(kits: AxfUiKits, kitId: String?, selected: ComponentKind, onSelect: (ComponentKind) -> Unit) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val c = Axf.colors
    var open by remember { mutableStateOf(setOf("Controls")) }
    var openElement by remember { mutableStateOf<ComponentKind?>(selected) }
    val target = kitId?.let { id -> kits.kits.firstOrNull { it.spec.id == id } } ?: kits.kitFor(selected)
    val covers = { k: ComponentKind -> target.spec.covers(k) || kitId == null }
    val categories = ELEMENTS.groupBy { it.category }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        AxfSectionHeader("Elements · ${ELEMENTS.size}", accent = true)
        for ((cat, items) in categories) {
            val isOpen = cat in open
            AxfTooltip("$cat: ${items.size} element(s); ${items.count { covers(it.kind) }} available in ${target.spec.label}") {
                Row(Modifier.fillMaxWidth().undockable("element-category", cat, cat, kitId).clickable { open = if (isOpen) open - cat else open + cat }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AxfIcon(if (isOpen) "minus" else "plus", size = 14.dp, tint = c.muted, contentDescription = null); AxfText(cat, Modifier.weight(1f), style = Axf.type.titleSmall); AxfBadge("${items.size}")
                }
            }
            if (isOpen) for (e in items) {
                val available = covers(e.kind)
                val expanded = openElement == e.kind
                AxfTooltip(if (available) e.tooltip else "${e.label}: not available in ${target.spec.label} (falls back to Material 3)") {
                    Row(Modifier.fillMaxWidth().padding(start = 18.dp).alpha(if (available) 1f else 0.4f).undockable("element", e.kind.name, e.label, kitId).clickable { onSelect(e.kind); openElement = if (expanded) null else e.kind }.padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        AxfIcon(if (expanded) "minus" else "chevron-right", size = 12.dp, tint = c.muted, contentDescription = null)
                        AxfText(e.label, Modifier.weight(1f), color = if (selected == e.kind) c.accent else c.text)
                        AxfBadge("${e.tokens.size + e.params.size}", tone = if (available) "accent" else "warning")
                        if (!available) AxfIcon("lock", size = 12.dp, tint = c.muted, contentDescription = "Unavailable")
                    }
                }
                if (expanded) Column(Modifier.padding(start = 36.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(Modifier.fillMaxWidth().border(1.dp, c.border, Axf.shapes.smShape).padding(6.dp)) { ElementPreview(e.kind) }
                    if (e.tokens.isNotEmpty()) { AxfSectionHeader("Tokens · ${e.tokens.size}"); for ((tok, what) in e.tokens) TokenRow(tok, what, available) }
                    if (e.params.isNotEmpty()) { AxfSectionHeader("Style parameters · ${e.params.size}"); for (pr in e.params) ParamRow(pr, available) }
                    if (e.flags.isNotEmpty()) { AxfSectionHeader("Element options · ${e.flags.size}"); for (fl in e.flags) FlagRow(fl, available) }
                }
            }
        }
        AxfDivider()
        val allFlags = ELEMENTS.flatMap { e -> e.flags.map { e to it } }
        val flagsOpen = "Element options" in open
        AxfTooltip("Every on/off option across all elements, at its current (default) state. Toggling hot-swaps the preview.") {
            Row(Modifier.fillMaxWidth().undockable("element-flags", "all", "Element options", kitId).clickable { open = if (flagsOpen) open - "Element options" else open + "Element options" }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AxfIcon(if (flagsOpen) "minus" else "plus", size = 14.dp, tint = c.muted, contentDescription = null); AxfText("Element options / flags", Modifier.weight(1f), style = Axf.type.titleSmall); AxfBadge("${allFlags.size}")
            }
        }
        if (flagsOpen) for ((e, fl) in allFlags) Box(Modifier.padding(start = 18.dp)) { FlagRow(fl, covers(e.kind), prefix = e.label) }
        AxfText("Edits create a custom copy of the asset they touch (…-custom) and activate it; reset from Assets › Reset.", muted = true)
    }
}

/**
 * Long-press-drag a tree node (category, element or the flags root — anything that is not a bare parameter)
 * to open it in its own floating window of type ELEMENT ("undocked element"): toolbars allowed, off by default,
 * its own switch in the title bar / window settings turns one on. The window lands where the finger lifts.
 */
@Composable
public fun Modifier.undockable(kind: String, payload: String, title: String, kitId: String?): Modifier {
    val wm = LocalWindowManager.current ?: return this
    var origin by remember { mutableStateOf(Offset.Zero) }
    var last by remember { mutableStateOf(Offset.Zero) }
    return this.onGloballyPositioned { origin = it.positionInRoot() }.pointerInput(kind, payload) {
        detectDragGesturesAfterLongPress(
            onDragStart = { o -> last = origin + o; wm.dragStart("new:$kind:$payload", "", last.x, last.y) },
            onDrag = { change, _ -> change.consume(); last = origin + change.position; wm.dragMove(last.x, last.y) },
            onDragEnd = { wm.dragEnd(); wm.openFloating(listOf(TabSpec("el-${System.nanoTime().toString(36)}", title, kind, if (kitId != null) "$payload|$kitId" else payload, icon = "zap")), title, WindowType.ELEMENT, 340f, 420f, (last.x - 170f).coerceAtLeast(0f), (last.y - 24f).coerceAtLeast(0f)) },
            onDragCancel = { wm.dragEnd() },
        )
    }
}

/* ---------- editable rows ---------- */

private fun derive(base: AssetEnvelope, data: JsonObject): JsonObject = buildJsonObject {
    put("\$axf", JsonPrimitive(base.frame)); put("type", JsonPrimitive(base.type)); put("id", JsonPrimitive(if (base.id.endsWith("-custom")) base.id else "${base.id}-custom")); put("name", JsonPrimitive(if (base.name.endsWith(" (custom)")) base.name else "${base.name} (custom)")); put("version", JsonPrimitive("0.1.0"))
    put("description", JsonPrimitive("Edited in the element explorer (from ${base.id})")); put("author", JsonPrimitive("Element explorer")); put("tags", kotlinx.serialization.json.JsonArray(base.tags.map { JsonPrimitive(it) })); put("data", data)
}

private fun JsonObject.setPath(path: List<String>, value: kotlinx.serialization.json.JsonElement): JsonObject =
    if (path.size == 1) JsonObject(this + (path[0] to value)) else JsonObject(this + (path[0] to ((this[path[0]] as? JsonObject) ?: JsonObject(emptyMap())).setPath(path.drop(1), value)))

private fun JsonObject.getPath(path: List<String>): kotlinx.serialization.json.JsonElement? = if (path.size == 1) this[path[0]] else (this[path[0]] as? JsonObject)?.getPath(path.drop(1))

@Composable
private fun applyEdit(assetType: String, path: List<String>, value: kotlinx.serialization.json.JsonElement) {
    val runtime = LocalAxfRuntime.current
    val base = runtime.requireAsset(assetType)
    val r = runtime.importAsset(derive(base, base.data.setPath(path, value)))
    if (!r.ok) runtime.toast(r.errors.joinToString(), ToastKind.DANGER, "Invalid edit")
}

@Composable
private fun TokenRow(token: String, what: String, enabled: Boolean) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val value = compiled.theme.colors[token] ?: ""
    val rgba = ai.amberx.axf.kernel.engine.Rgba.parse(value)
    var editing by remember(token) { mutableStateOf(false) }
    var text by remember(token, value) { mutableStateOf(value) }
    AxfTooltip("$token — $what. ${if (enabled) "Tap to edit; applies to the color theme." else "Unavailable in this kit."}") {
        Column(Modifier.fillMaxWidth().alpha(if (enabled) 1f else 0.4f)) {
            Row(Modifier.fillMaxWidth().clickable(enabled = enabled) { editing = !editing }.padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(16.dp).background(rgba?.let { Color(it.r, it.g, it.b, (it.a * 255).toInt()) } ?: Axf.colors.border, Axf.shapes.xsShape).border(1.dp, Axf.colors.border, Axf.shapes.xsShape))
                AxfText(token, Modifier.weight(1f), mono = true); AxfText(what, muted = true); AxfText(value, mono = true, muted = true)
            }
            if (editing && enabled) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                AxfTextField(text, { text = it }, Modifier.weight(1f), monospace = true)
                val apply = { v: String -> val base = runtime.requireAsset(AssetTypes.COLOR_THEME); val tokens = ((base.data["tokens"] as? JsonObject) ?: JsonObject(emptyMap())); runtime.importAsset(derive(base, JsonObject(base.data + ("tokens" to JsonObject(tokens + (token to JsonPrimitive(v))))))).let { r -> if (!r.ok) runtime.toast(r.errors.joinToString(), ToastKind.DANGER) } }
                AxfIconButton("check", "Apply", { apply(text) })
                if (rgba != null) AxfIconButton("sun", "Lighter", { apply(rgba.mix(ai.amberx.axf.kernel.engine.Rgba.WHITE, 0.15).toCss()) })
                if (rgba != null) AxfIconButton("moon", "Darker", { apply(rgba.mix(ai.amberx.axf.kernel.engine.Rgba.BLACK, 0.15).toCss()) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ParamRow(pr: StyleParam, enabled: Boolean) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val asset = runtime.asset(pr.assetType)
    val current = asset?.data?.getPath(pr.path)?.let { (it as? JsonPrimitive)?.content } ?: ""
    var pending by remember(pr.key, current, compiled.rev) { mutableStateOf<kotlinx.serialization.json.JsonElement?>(null) }
    AxfTooltip("${pr.label} — ${pr.tooltip} (asset: ${pr.assetType}.${pr.path.joinToString(".")})") {
        Column(Modifier.fillMaxWidth().alpha(if (enabled) 1f else 0.4f).padding(vertical = 2.dp)) {
            when (pr.kind) {
                "enum" -> { Row(verticalAlignment = Alignment.CenterVertically) { AxfText(pr.label, Modifier.weight(1f)); AxfText(current, mono = true, muted = true) }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { for (o in pr.options) AxfChip(o, selected = o == current, onClick = if (enabled) ({ pending = JsonPrimitive(o) }) else null) } }
                else -> AxfSlider(pr.label, current.toFloatOrNull() ?: pr.min, { pending = if (pr.key.startsWith("tracking")) JsonPrimitive(it.toDouble()) else JsonPrimitive(it.toInt()) }, min = pr.min, max = pr.max, step = if (pr.max - pr.min > 200) 10f else 1f, enabled = enabled)
            }
        }
    }
    pending?.let { v -> applyEdit(pr.assetType, pr.path, v); pending = null }
}

@Composable
private fun FlagRow(fl: FlagSpec, enabled: Boolean, prefix: String? = null) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val current = runtime.asset(fl.assetType)?.data?.getPath(fl.path)?.let { (it as? JsonPrimitive)?.content?.toBooleanStrictOrNull() } ?: false
    var pending by remember(fl.key, current, compiled.rev) { mutableStateOf<Boolean?>(null) }
    AxfTooltip("${fl.label} — ${fl.tooltip}. Default: ${if (current) "on" else "off"} (asset ${fl.assetType}.${fl.path.joinToString(".")})") {
        Box(Modifier.alpha(if (enabled) 1f else 0.4f)) { AxfSwitch(current, { pending = it }, label = if (prefix != null) "$prefix · ${fl.label}" else fl.label, description = fl.tooltip, enabled = enabled) }
    }
    pending?.let { v -> applyEdit(fl.assetType, fl.path, JsonPrimitive(v)); pending = null }
}

/* ---------- previews per element kind, rendered through the active kit ---------- */

@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun ElementPreview(kind: ComponentKind) {
    val runtime = LocalAxfRuntime.current
    var text by remember { mutableStateOf("Sample") }
    var on by remember { mutableStateOf(true) }
    var v by remember { mutableStateOf(40f) }
    var seg by remember { mutableStateOf("a") }
    when (kind) {
        ComponentKind.BUTTON -> FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { AxfButton("Primary", {}, tone = ButtonTone.PRIMARY, icon = "zap"); AxfButton("Neutral", {}); AxfButton("Danger", {}, tone = ButtonTone.DANGER); AxfButton("Ghost", {}, tone = ButtonTone.GHOST); AxfButton("Disabled", {}, enabled = false) }
        ComponentKind.ICON_BUTTON -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { AxfIconButton("settings", "Settings", {}); AxfIconButton("star", "Star", {}, active = true); AxfIconButton("trash", "Delete", {}, enabled = false) }
        ComponentKind.SWITCH -> AxfSwitch(on, { on = it }, label = "Switch", description = "With description")
        ComponentKind.CHECKBOX -> AxfCheckbox(on, { on = it }, label = "Checkbox")
        ComponentKind.CHIP -> FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { AxfChip("Default"); AxfChip("Selected", selected = true, onClick = {}); AxfChip("Success", tone = "success", icon = "check"); AxfChip("Warning", tone = "warning"); AxfChip("Danger", tone = "danger") }
        ComponentKind.SEGMENTED -> AxfSegmented(listOf("a" to "One", "b" to "Two", "c" to "Three"), seg, { seg = it })
        ComponentKind.SLIDER -> AxfSlider("Slider", v, { v = it }, unit = "%")
        ComponentKind.TEXT_FIELD, ComponentKind.SEARCH_FIELD -> AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), label = "Text field", leadingIcon = if (kind == ComponentKind.SEARCH_FIELD) "search" else null)
        ComponentKind.PASSWORD_FIELD -> AxfTextField("secret", {}, Modifier.fillMaxWidth(), label = "Password", secret = true)
        ComponentKind.CARD -> AxfCard(title = "Card", icon = "box", actions = { AxfBadge("new") }) { AxfText("Container asset: variant, header, padding, elevation.") }
        ComponentKind.LIST_ITEM -> Column { AxfListItem("List item", subtitle = "Subtitle", icon = "file", onClick = {}); AxfListItem("Selected", icon = "star", selected = true, onClick = {}) }
        ComponentKind.SECTION_HEADER -> AxfSectionHeader("Section header", accent = true)
        ComponentKind.BADGE -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { AxfBadge("accent"); AxfBadge("3", tone = "danger"); AxfBadge("ok", tone = "success") }
        ComponentKind.DIVIDER -> AxfDivider()
        ComponentKind.MENUBAR -> ai.amberx.axf.ui.components.AxfMenubar(Modifier.fillMaxWidth(), compact = true)
        ComponentKind.TOOLBAR -> ai.amberx.axf.ui.components.AxfToolbar(Modifier.fillMaxWidth())
        ComponentKind.NAV_LIST -> ai.amberx.axf.ui.components.AxfNav(Modifier.fillMaxWidth(), views = runtime.compiled.value.navMenu.items.map { it.view }.toSet(), orientation = ai.amberx.axf.kernel.engine.Orientation.HORIZONTAL)
        ComponentKind.STATUS_BAR -> ai.amberx.axf.ui.components.AxfStatusBar(Modifier.fillMaxWidth())
        ComponentKind.DIALOG -> AxfButton("Open dialog", { runtime.openDialog("about") }, icon = "box")
        ComponentKind.TOAST -> AxfButton("Show toast", { runtime.toast("Preview toast", ToastKind.SUCCESS, "Toast") }, icon = "bell")
        ComponentKind.CONTEXT_MENU -> Box(Modifier.fillMaxWidth().height(44.dp).border(1.dp, Axf.colors.border, Axf.shapes.smShape).axfContextMenu("default"), contentAlignment = Alignment.Center) { AxfText("Long-press for the context menu", muted = true) }
        ComponentKind.EMPTY_STATE -> AxfEmptyState("Empty state", message = "Nothing here")
        ComponentKind.LOADING_STATE -> AxfLoadingState()
        ComponentKind.ERROR_STATE -> AxfErrorState("Error state", message = "Something failed", retry = {})
        ComponentKind.PROGRESS -> androidx.compose.material3.LinearProgressIndicator(Modifier.fillMaxWidth(), color = Axf.colors.accent, trackColor = Axf.colors.surface3)
        else -> AxfEmptyState(kind.name.lowercase().replace('_', ' '), message = "Rendered by a library kit (placeholder)", icon = "box")
    }
}


/* ---------- tab renderers for undocked tree nodes (registered by WindowsModule) ---------- */

/** `element` → preview + its tokens/params/flags; `element-category` → every element of the category; `element-flags` → all flags. Payload may carry `|kitId`. */
@Composable
public fun UndockedElementTab(kind: String, payload: String) {
    val value = payload.substringBefore('|'); val kitId = payload.substringAfter('|', "").ifEmpty { null }
    val kits = LocalAxfUiKits.current
    val forced = remember(kits, kitId) { if (kitId == null) kits else AxfUiKits(kits.kits, kitId, emptyMap()) }
    CompositionLocalProvider(LocalAxfUiKits provides forced) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Axf.space.one), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when (kind) {
                "element" -> { val e = ELEMENTS.firstOrNull { it.kind.name == value } ?: return@Column AxfEmptyState("Unknown element $value"); val available = forced.kitFor(e.kind).spec.covers(e.kind) || kitId == null
                    Box(Modifier.fillMaxWidth().border(1.dp, Axf.colors.border, Axf.shapes.smShape).padding(6.dp)) { ElementPreview(e.kind) }
                    if (e.tokens.isNotEmpty()) { AxfSectionHeader("Tokens · ${e.tokens.size}"); for ((tok, what) in e.tokens) TokenRow(tok, what, available) }
                    if (e.params.isNotEmpty()) { AxfSectionHeader("Style parameters · ${e.params.size}"); for (pr in e.params) ParamRow(pr, available) }
                    if (e.flags.isNotEmpty()) { AxfSectionHeader("Element options · ${e.flags.size}"); for (fl in e.flags) FlagRow(fl, available) } }
                "element-category" -> for (e in ELEMENTS.filter { it.category == value }) { AxfSectionHeader(e.label, accent = true); Box(Modifier.fillMaxWidth().border(1.dp, Axf.colors.border, Axf.shapes.smShape).padding(6.dp)) { ElementPreview(e.kind) } }
                "element-flags" -> for (e in ELEMENTS) for (fl in e.flags) FlagRow(fl, forced.kitFor(e.kind).spec.covers(e.kind) || kitId == null, prefix = e.label)
                else -> AxfEmptyState("Nothing to show")
            }
        }
    }
}


/* ---------- grid view ---------- */

/**
 * Grid view (toggled from the floating window's toolbar): one expandable row per category. An expanded row
 * shows a horizontally scrolling, snapping strip of element previews and, under it, a sub-grid of the
 * tokens, style parameters and flags of whichever element is currently in view — hot-rendered as you scroll.
 */
@OptIn(ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
public fun ElementGrid(kitId: String?, modifier: Modifier = Modifier) {
    val kits = LocalAxfUiKits.current
    val forced = remember(kits, kitId) { if (kitId == null) kits else AxfUiKits(kits.kits, kitId, emptyMap()) }
    val target = kitId?.let { id -> kits.kits.firstOrNull { it.spec.id == id } } ?: kits.kitFor(ComponentKind.BUTTON)
    var open by remember { mutableStateOf(setOf(ELEMENTS.first().category)) }
    val c = Axf.colors
    CompositionLocalProvider(LocalAxfUiKits provides forced) {
        androidx.compose.foundation.lazy.LazyColumn(modifier.fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(Axf.space.one), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { AxfText("Elements grid · ${target.spec.label}", style = Axf.type.titleSmall); AxfBadge("${ELEMENTS.size}") } }
            for ((cat, items) in ELEMENTS.groupBy { it.category }) {
                val isOpen = cat in open
                item(key = "row-$cat") {
                    Row(Modifier.fillMaxWidth().background(c.surface2, Axf.shapes.smShape).clickable { open = if (isOpen) open - cat else open + cat }.padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AxfIcon(if (isOpen) "minus" else "plus", size = 14.dp, tint = c.muted, contentDescription = null); AxfText(cat, Modifier.weight(1f), style = Axf.type.titleSmall)
                        for (e in items.take(6)) Box(Modifier.size(8.dp).background(if (target.spec.covers(e.kind) || kitId == null) c.success else c.border, Axf.shapes.full))
                        AxfBadge("${items.size}")
                    }
                }
                if (isOpen) item(key = "body-$cat") { CategoryStrip(items, target, kitId) }
            }
        }
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun CategoryStrip(items: List<ElementSpec>, target: ai.amberx.axf.ui.kit.AxfUiKit, kitId: String?) {
    val c = Axf.colors
    val listState = androidx.compose.foundation.lazy.rememberLazyListState()
    val fling = androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior(listState)
    // the element "in view" = the item nearest the viewport start (snapping keeps one item per page)
    val visibleIndex by remember { androidx.compose.runtime.derivedStateOf { val info = listState.layoutInfo; val center = (info.viewportStartOffset + info.viewportEndOffset) / 2; info.visibleItemsInfo.minByOrNull { kotlin.math.abs(it.offset + it.size / 2 - center) }?.index ?: listState.firstVisibleItemIndex } }
    val e = items.getOrElse(visibleIndex) { items.first() }
    val available = target.spec.covers(e.kind) || kitId == null
    Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BoxWithConstraintsStrip(listState, fling, items, target, kitId)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { AxfText(e.label, Modifier.weight(1f), style = Axf.type.titleSmall); AxfBadge("${visibleIndex + 1}/${items.size}"); if (!available) AxfBadge("unavailable", tone = "warning") }
        // sub-grid: tokens · params · flags, hot-rendered for the element in view
        androidx.compose.foundation.layout.FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), maxItemsInEachRow = 2) {
            for ((tok, what) in e.tokens) Box(Modifier.weight(1f).border(1.dp, c.border, Axf.shapes.smShape).padding(6.dp)) { TokenRow(tok, what, available) }
            for (pr in e.params) Box(Modifier.weight(1f).border(1.dp, c.border, Axf.shapes.smShape).padding(6.dp)) { ParamRow(pr, available) }
            for (fl in e.flags) Box(Modifier.weight(1f).border(1.dp, c.border, Axf.shapes.smShape).padding(6.dp)) { FlagRow(fl, available) }
            if (e.tokens.isEmpty() && e.params.isEmpty() && e.flags.isEmpty()) AxfText("No editable tokens for this element.", muted = true)
        }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun BoxWithConstraintsStrip(listState: androidx.compose.foundation.lazy.LazyListState, fling: androidx.compose.foundation.gestures.FlingBehavior, items: List<ElementSpec>, target: ai.amberx.axf.ui.kit.AxfUiKit, kitId: String?) {
    val c = Axf.colors
    androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth()) {
        val pageWidth = maxWidth - 24.dp
        androidx.compose.foundation.lazy.LazyRow(state = listState, flingBehavior = fling, horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 12.dp)) {
            items(items.size, key = { items[it].kind.name }) { i ->
                val e = items[i]; val available = target.spec.covers(e.kind) || kitId == null
                Column(Modifier.width(pageWidth).border(1.dp, c.border, Axf.shapes.mdShape).background(c.surface, Axf.shapes.mdShape).padding(8.dp).alpha(if (available) 1f else 0.45f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) { AxfText(e.label, Modifier.weight(1f), style = Axf.type.labelLarge); AxfText(e.category, muted = true); if (!available) AxfIcon("lock", size = 12.dp, tint = c.muted, contentDescription = "Unavailable") }
                    Box(Modifier.fillMaxWidth().height(120.dp)) { ElementPreview(e.kind) }
                }
            }
        }
    }
}
