package ai.amberx.axf.ui.windows

import ai.amberx.axf.kernel.contract.Corner
import ai.amberx.axf.kernel.contract.MinimizeMode
import ai.amberx.axf.kernel.contract.MinimizeTarget
import ai.amberx.axf.kernel.contract.Pane
import ai.amberx.axf.kernel.contract.TabGroup
import ai.amberx.axf.kernel.contract.TabSpec
import ai.amberx.axf.kernel.contract.WindowManager
import ai.amberx.axf.kernel.contract.WindowSpec
import ai.amberx.axf.kernel.engine.ActionBus
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.PlaceholderScreen
import ai.amberx.axf.ui.components.axfContextMenu
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlin.math.roundToInt

/** The window a composable is rendered in (null in the main window). Tab renderers read `mode` from it. */
public val LocalWindowSpec: androidx.compose.runtime.ProvidableCompositionLocal<WindowSpec?> = androidx.compose.runtime.compositionLocalOf { null }

/* ------------------------------------------------------------------ */
/* Dock area (main window) and floating window host (overlay)          */
/* ------------------------------------------------------------------ */

/** Renders the main window's tab-group layout (what undocked windows redock into). Place it in any view. */
@Composable
public fun DockArea(wm: WindowManager, modifier: Modifier = Modifier, empty: @Composable () -> Unit = { PlaceholderScreen("No tabs", message = "Open something here, or drag a tab in.") }) {
    val st by wm.state.collectAsState()
    val layout = st.layouts[wm.mainWindowId]
    Box(modifier.fillMaxSize().onGloballyPositioned { }) { if (layout == null) empty() else PaneView(wm, wm.mainWindowId, layout) }
}

/**
 * Overlay with every floating window, the minimized title bars per corner, the floating toolbars and the
 * tab-drag ghost. AxfRoot renders it above the app content; it draws nothing while no window is open.
 */
@Composable
public fun FloatingWindowsHost(wm: WindowManager) {
    val st by wm.state.collectAsState()
    val density = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maxW = maxWidth; val maxH = maxHeight
        // The pointer position for "minimize at cursor" is tracked by AxfRoot on the app's root container (an ancestor
        // that only observes, never consumes). A full-size sibling Box here used to do it, and a topmost sibling with any
        // pointer input takes every touch, so nothing underneath ever received a tap (every app looked frozen).
        for (w in st.windows.filter { it.isFloating && it.minimized == null }.sortedBy { it.z }) key(w.id) { FloatingWindow(wm, w, maxW.value, maxH.value) }
        for (corner in Corner.entries) MinimizedCorner(wm, corner, st.windows.filter { it.minimized == MinimizeTarget.CORNER_TITLEBAR && it.settings.corner == corner })
        for (w in st.windows.filter { it.minimized == MinimizeTarget.FLOATING_TOOLBAR }) FloatingMiniToolbar(wm, w)
        st.drag?.let { d ->
            val title = st.groups.values.flatMap { it.tabs }.firstOrNull { it.id == d.tabId }?.title ?: ""
            Box(Modifier.zIndex(10_000f).offset { IntOffset(d.x.roundToInt() - 40, d.y.roundToInt() - 20) }.shadow(8.dp, Axf.shapes.smShape).background(Axf.colors.accent, Axf.shapes.smShape).padding(horizontal = 10.dp, vertical = 6.dp)) { AxfText(title, color = Axf.colors.accentText) }
        }
    }
}

@Composable
private fun FloatingWindow(wm: WindowManager, w: WindowSpec, maxW: Float, maxH: Float) {
    val c = Axf.colors
    val st by wm.state.collectAsState()
    val density = LocalDensity.current
    val focused = st.focused == w.id
    val layout = st.layouts[w.id]
    Column(
        Modifier.zIndex(100f + w.z).offset { IntOffset(with(density) { w.x.dp.roundToPx() }, with(density) { w.y.dp.roundToPx() }) }
            .width(w.width.coerceAtMost(maxW - 8f).dp).height(w.height.coerceAtMost(maxH - 8f).dp)
            .alpha(w.settings.opacity).shadow(if (focused) 16.dp else 8.dp, Axf.shapes.lgShape).clip(Axf.shapes.lgShape).background(c.surface).border(1.dp, if (focused) c.accent else c.border, Axf.shapes.lgShape)
            .pointerInput(w.id) { awaitPointerEventScope { while (true) { awaitPointerEvent(androidx.compose.ui.input.pointer.PointerEventPass.Initial).let { if (it.changes.any { ch -> ch.pressed } && st.focused != w.id) wm.focus(w.id) } } } },
    ) {
        TitleBar(wm, w)
        if (w.effectiveToolbar) WindowToolbar(wm, w)
        androidx.compose.runtime.CompositionLocalProvider(LocalWindowSpec provides w) {
            Box(Modifier.weight(1f).fillMaxWidth()) { if (layout == null) PlaceholderScreen("Empty window") else PaneView(wm, w.id, layout) }
        }
        // resize grip
        Box(Modifier.align(Alignment.End).size(20.dp).pointerInput(w.id) { detectDragGestures { change, drag -> change.consume(); val dw = with(density) { drag.x.toDp().value }; val dh = with(density) { drag.y.toDp().value }; wm.resize(w.id, w.width + dw, w.height + dh) } }, contentAlignment = Alignment.Center) { AxfIcon("chevron-right", size = 12.dp, tint = c.muted, contentDescription = "Resize") }
    }
}

@Composable
private fun TitleBar(wm: WindowManager, w: WindowSpec) {
    val c = Axf.colors
    val density = LocalDensity.current
    Row(
        Modifier.fillMaxWidth().background(c.surface2).axfContextMenu("window-title", w.id)
            .pointerInput(w.id) { detectDragGestures { change, drag -> change.consume(); wm.move(w.id, with(density) { drag.x.toDp().value }, with(density) { drag.y.toDp().value }) } }
            .padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        AxfIcon(when (w.type) { ai.amberx.axf.kernel.contract.WindowType.DOCK -> "layers"; ai.amberx.axf.kernel.contract.WindowType.ELEMENT -> "zap"; else -> "box" }, size = 14.dp, tint = c.muted, contentDescription = null)
        AxfText(w.title, Modifier.weight(1f), style = Axf.type.labelLarge, maxLines = 1)
        if (w.toolbarsAllowed && !w.forcesToolbar) AxfIconButton("sliders", if (w.toolbarEnabled) "Hide toolbar" else "Show toolbar", { wm.setToolbar(w.id, !w.toolbarEnabled) }, size = 22.dp, iconSize = 12.dp, active = w.toolbarEnabled)
        AxfIconButton("minus", "Minimize", { wm.minimizeToNextCorner(w.id) }, size = 22.dp, iconSize = 12.dp)
        if (w.closable) AxfIconButton("x", "Close", { wm.close(w.id) }, size = 22.dp, iconSize = 12.dp)
    }
}

/**
 * The toolbar of a floating window: the hard-coded default (settings, redock, minimize to corner, minimize to
 * floating toolbar, close) unless `settings.toolbarAsset` names a toolbar asset, in which case that asset's
 * groups render and the window-settings icon is appended because the toolbar is inside a floating window.
 */
@Composable
private fun WindowToolbar(wm: WindowManager, w: WindowSpec) {
    val c = Axf.colors
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    val uac = LocalAxfUac.current
    Row(Modifier.fillMaxWidth().background(c.toolbarBg).padding(horizontal = 6.dp, vertical = 2.dp).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        val asset = w.settings.toolbarAsset?.let { runtime.registry.get(ai.amberx.axf.kernel.asset.AssetTypes.TOOLBAR, it) }?.let { ai.amberx.axf.kernel.asset.Toolbar.fromJson(it.data) }
        if (asset == null) {
            AxfIconButton("settings", "Window settings", { runtime.openDialog("window-settings", mapOf("arg" to w.id)) })
            AxfIconButton(if (w.mode == "grid") "list" else "grid", if (w.mode == "grid") "View as tree" else "View as grid", { wm.setMode(w.id, if (w.mode == "grid") "tree" else "grid") }, active = w.mode == "grid")
            AxfIconButton("download", "Redock", { wm.redock(w.id) })
            AxfIconButton("minus", "Minimize to title bar (cycles corners)", { wm.minimizeToNextCorner(w.id) })
            AxfIconButton("sliders", "Minimize to floating toolbar at cursor", { wm.minimize(w.id, MinimizeTarget.FLOATING_TOOLBAR, WindowPointer.x, WindowPointer.y) })
            Box(Modifier.weight(1f))
            if (w.closable) AxfIconButton("x", "Close window", { wm.close(w.id) })
        } else {
            for ((gi, g) in asset.groups.withIndex()) {
                if (gi > 0) Box(Modifier.width(1.dp).height(18.dp).background(c.border))
                for (item in g.items) { if (uac.gate(item.requires) == ai.amberx.axf.kernel.engine.Gate.HIDE) continue; AxfIconButton(item.icon, item.label, { actions.dispatch(item.action, w.id) }, enabled = uac.gate(item.requires) == ai.amberx.axf.kernel.engine.Gate.ALLOW) }
            }
            Box(Modifier.weight(1f))
            // always present inside a floating window, whatever toolbar asset is attached
            AxfIconButton("settings", "Window settings", { runtime.openDialog("window-settings", mapOf("arg" to w.id)) })
        }
    }
}

/* ------------------------------------------------------------------ */
/* Panes and tab groups                                                */
/* ------------------------------------------------------------------ */

@Composable
public fun PaneView(wm: WindowManager, windowId: String, pane: Pane) {
    val c = Axf.colors
    when (pane) {
        is Pane.Leaf -> wm.current.groups[pane.groupId]?.let { TabGroupView(wm, it) } ?: Box(Modifier.fillMaxSize())
        is Pane.Split -> if (pane.vertical) Column(Modifier.fillMaxSize()) { pane.children.forEachIndexed { i, ch -> Box(Modifier.weight(pane.weights.getOrElse(i) { 1f }).fillMaxWidth()) { PaneView(wm, windowId, ch) }; if (i < pane.children.size - 1) Box(Modifier.fillMaxWidth().height(2.dp).background(c.border)) } }
            else Row(Modifier.fillMaxSize()) { pane.children.forEachIndexed { i, ch -> Box(Modifier.weight(pane.weights.getOrElse(i) { 1f }).fillMaxHeight()) { PaneView(wm, windowId, ch) }; if (i < pane.children.size - 1) Box(Modifier.width(2.dp).fillMaxHeight().background(c.border)) } }
        is Pane.Grid -> Column(Modifier.fillMaxSize()) {
            for (r in 0 until pane.rows) { Row(Modifier.weight(1f).fillMaxWidth()) { for (col in 0 until pane.cols) { val cell = pane.cells.getOrNull(r * pane.cols + col); Box(Modifier.weight(1f).fillMaxHeight().border(0.5.dp, c.border)) { if (cell != null) PaneView(wm, windowId, cell) } } } }
        }
    }
}

/** One tab group: tab strip (tap to activate, long-press-drag to move to another group or window, context menu), group toolbar, content. */
@Composable
public fun TabGroupView(wm: WindowManager, group: TabGroup) {
    val c = Axf.colors
    val runtime = LocalAxfRuntime.current
    val renderers = LocalTabRenderers.current
    val st by wm.state.collectAsState()
    val g = st.groups[group.id] ?: return
    var origin by remember { mutableStateOf(Offset.Zero) }
    var size by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    Column(Modifier.fillMaxSize().onGloballyPositioned { lc -> origin = lc.positionInRoot(); size = lc.size; wm.groupBounds[g.id] = floatArrayOf(origin.x, origin.y, origin.x + size.width, origin.y + size.height) }) {
        Row(Modifier.fillMaxWidth().background(c.surface2).axfContextMenu("tab-group", g.id), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
                for ((i, tab) in g.tabs.withIndex()) TabChip(wm, g, i, tab, i == g.active)
            }
            var menu by remember { mutableStateOf(false) }
            AxfIconButton("external", "Undock", { wm.undock(g.id) }, size = 24.dp, iconSize = 13.dp)
            Box { AxfIconButton("grid", "Split", { menu = true }, size = 24.dp, iconSize = 13.dp); if (menu) ai.amberx.axf.ui.components.AxfDropdown({ menu = false }) { ai.amberx.axf.ui.components.AxfMenuList(wm.groupMenu().first { it.id == "split" }.items, onDone = { menu = false }, payload = g.id, showShortcuts = false) } }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val tab = g.activeTab
            if (tab == null) PlaceholderScreen("Empty group") else { val r = renderers.get(tab.kind); if (r != null) r.Render(tab) else PlaceholderScreen(tab.title, message = "No renderer for tab kind \"${tab.kind}\".") }
        }
    }
}

@Composable
private fun TabChip(wm: WindowManager, g: TabGroup, index: Int, tab: TabSpec, active: Boolean) {
    val c = Axf.colors
    var pos by remember { mutableStateOf(Offset.Zero) }
    Row(
        Modifier.onGloballyPositioned { pos = it.positionInRoot() }
            .clip(Axf.shapes.smShape).background(if (active) c.surface else androidx.compose.ui.graphics.Color.Transparent).clickable { wm.activate(g.id, index) }
            .pointerInput(tab.id) { detectDragGesturesAfterLongPress(onDragStart = { o -> wm.dragStart(tab.id, g.id, pos.x + o.x, pos.y + o.y) }, onDrag = { change, _ -> change.consume(); wm.dragMove(pos.x + change.position.x, pos.y + change.position.y) }, onDragEnd = { wm.dragEnd() }, onDragCancel = { wm.dragEnd() }) }
            .padding(start = 10.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (tab.icon != null) AxfIcon(tab.icon, size = 12.dp, tint = if (active) c.accent else c.muted, contentDescription = null)
        AxfText(tab.title, style = Axf.type.labelMedium, color = if (active) c.text else c.muted, maxLines = 1)
        if (tab.closable) AxfIconButton("x", "Close tab", { wm.closeTab(tab.id) }, size = 18.dp, iconSize = 10.dp)
    }
}

/* ------------------------------------------------------------------ */
/* Minimized title bars (per corner, stacked or lined) and mini toolbars */
/* ------------------------------------------------------------------ */

@Composable
private fun MinimizedCorner(wm: WindowManager, corner: Corner, windows: List<WindowSpec>) {
    if (windows.isEmpty()) return
    val c = Axf.colors
    val mode = windows.first().settings.mode
    val align = when (corner) { Corner.TOP_LEFT -> Alignment.TopStart; Corner.TOP_RIGHT -> Alignment.TopEnd; Corner.BOTTOM_RIGHT -> Alignment.BottomEnd; Corner.BOTTOM_LEFT -> Alignment.BottomStart }
    val bar: @Composable (WindowSpec) -> Unit = { w ->
        Row(Modifier.shadow(6.dp, Axf.shapes.smShape).background(c.surface2, Axf.shapes.smShape).border(1.dp, c.border, Axf.shapes.smShape).clickable { wm.restore(w.id) }.axfContextMenu("window-title", w.id).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            AxfIcon("layers", size = 12.dp, tint = c.accent, contentDescription = null); AxfText(w.title, style = Axf.type.labelMedium, maxLines = 1); AxfIconButton("x", "Close", { wm.close(w.id) }, size = 18.dp, iconSize = 10.dp)
        }
    }
    Box(Modifier.fillMaxSize().zIndex(5_000f)) {
        if (mode == MinimizeMode.STACKED) Column(Modifier.align(align).padding(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { windows.forEach { bar(it) } }
        else Row(Modifier.align(align).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) { windows.forEach { bar(it) } }
    }
}

@Composable
private fun FloatingMiniToolbar(wm: WindowManager, w: WindowSpec) {
    val c = Axf.colors
    val runtime = LocalAxfRuntime.current
    Row(
        Modifier.zIndex(6_000f).offset { IntOffset(w.minimizedAtX.roundToInt(), w.minimizedAtY.roundToInt()) }
            .pointerInput(w.id) { detectDragGestures { change, drag -> change.consume(); wm.minimize(w.id, MinimizeTarget.FLOATING_TOOLBAR, w.minimizedAtX + drag.x, w.minimizedAtY + drag.y) } }
            .shadow(8.dp, Axf.shapes.full).background(c.surface2, Axf.shapes.full).border(1.dp, c.accent, Axf.shapes.full).padding(horizontal = 8.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        AxfText(w.title, style = Axf.type.labelMedium, maxLines = 1)
        AxfIconButton("external", "Restore", { wm.restore(w.id) }, size = 22.dp, iconSize = 12.dp)
        AxfIconButton("download", "Redock", { wm.redock(w.id) }, size = 22.dp, iconSize = 12.dp)
        AxfIconButton("settings", "Window settings", { runtime.openDialog("window-settings", mapOf("arg" to w.id)) }, size = 22.dp, iconSize = 12.dp)
        AxfIconButton("x", "Close", { wm.close(w.id) }, size = 22.dp, iconSize = 12.dp)
    }
}
