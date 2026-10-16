package ai.amberx.axf.kernel.contract

import ai.amberx.axf.kernel.asset.MenuItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/*
 * Window / tab-group / docking engine (kernel API level 1). Pure state + rules; axf-ui renders it.
 * Every window is built from a WindowSpec (the "window schema"); toolbars declare which window they are
 * attached to; floating windows force toolbars on; tab groups split into nested layouts; tabs move between
 * groups and windows; floating windows minimize to a corner (stacked or lined-up title bars) or to a
 * floating toolbar at the cursor.
 */

/** ELEMENT = an undocked element/tree node from the explorer: floating, toolbars allowed but OFF by default (its own switch turns one on). */
public enum class WindowType { MAIN, DOCK, TOOL, DIALOG, PANEL, FLOATING, ELEMENT }
public enum class MinimizeMode { STACKED, LINED }
public enum class Corner { TOP_LEFT, TOP_RIGHT, BOTTOM_RIGHT, BOTTOM_LEFT; public fun next(): Corner = entries[(ordinal + 1) % entries.size] }
public enum class MinimizeTarget { CORNER_TITLEBAR, FLOATING_TOOLBAR }
public enum class SplitMode { VERTICAL, HORIZONTAL, FOUR_WAY, GRID }

/** How a floating window minimizes (per window; the defaults come from the window settings dialog). */
public data class WindowSettings(val corner: Corner = Corner.BOTTOM_RIGHT, val mode: MinimizeMode = MinimizeMode.STACKED, val toolbarAsset: String? = null, val alwaysOnTop: Boolean = false, val opacity: Float = 1f)

/** The window schema. `toolbarsAllowed` = whether a toolbar may attach; floating windows force `toolbarEnabled`. */
public data class WindowSpec(
    val id: String,
    val type: WindowType,
    val title: String,
    val toolbarsAllowed: Boolean = true,
    val toolbarEnabled: Boolean = type != WindowType.MAIN,
    /** where it came from: the tab-group id it was undocked from, a route, a dialog… */
    val origin: String? = null,
    val settings: WindowSettings = WindowSettings(),
    val x: Float = 40f, val y: Float = 80f, val width: Float = 360f, val height: Float = 420f,
    val minimized: MinimizeTarget? = null,
    val minimizedAtX: Float = 0f, val minimizedAtY: Float = 0f,
    val closable: Boolean = true,
    val z: Int = 0,
) {
    public val isFloating: Boolean get() = type == WindowType.FLOATING || type == WindowType.DOCK || type == WindowType.ELEMENT
    /** Floating windows force the toolbar on — except ELEMENT windows, which default to off and expose their own switch. */
    public val forcesToolbar: Boolean get() = isFloating && type != WindowType.ELEMENT
    public val effectiveToolbar: Boolean get() = toolbarsAllowed && (toolbarEnabled || forcesToolbar)
}

/** A tab: what it shows is up to the app (`kind` + `payload`), the engine only moves it around. */
public data class TabSpec(val id: String, val title: String, val kind: String, val payload: String = "", val icon: String? = null, val closable: Boolean = true)

/** Nested layout of a window's content: a leaf group, a split with weights, or a grid of groups. */
public sealed class Pane {
    public data class Leaf(val groupId: String) : Pane()
    public data class Split(val vertical: Boolean, val children: List<Pane>, val weights: List<Float>) : Pane()
    public data class Grid(val rows: Int, val cols: Int, val cells: List<Pane>) : Pane()
    public fun groups(): List<String> = when (this) { is Leaf -> listOf(groupId); is Split -> children.flatMap { it.groups() }; is Grid -> cells.flatMap { it.groups() } }
    public fun replace(groupId: String, with: Pane): Pane = when (this) {
        is Leaf -> if (this.groupId == groupId) with else this
        is Split -> copy(children = children.map { it.replace(groupId, with) })
        is Grid -> copy(cells = cells.map { it.replace(groupId, with) })
    }
    public fun remove(groupId: String): Pane? = when (this) {
        is Leaf -> if (this.groupId == groupId) null else this
        is Split -> { val kept = children.mapIndexedNotNull { i, c -> c.remove(groupId)?.let { it to weights[i] } }; when (kept.size) { 0 -> null; 1 -> kept[0].first; else -> copy(children = kept.map { it.first }, weights = kept.map { it.second }) } }
        is Grid -> { val kept = cells.mapNotNull { it.remove(groupId) }; when (kept.size) { 0 -> null; 1 -> kept[0]; else -> if (kept.size == cells.size) copy(cells = kept) else Split(false, kept, kept.map { 1f }) } }
    }
}

public data class TabGroup(val id: String, val tabs: List<TabSpec>, val active: Int = 0, val windowId: String) {
    public val activeTab: TabSpec? get() = tabs.getOrNull(active)
}

public data class WindowState(val windows: List<WindowSpec>, val groups: Map<String, TabGroup>, val layouts: Map<String, Pane>, val focused: String?, val drag: TabDrag?)
public data class TabDrag(val tabId: String, val fromGroup: String, val x: Float, val y: Float)

/**
 * The windowing store. One per app (service `axf.windows`). All mutations are pure updates on [state];
 * axf-ui renders windows/groups and reports pointer events (drag positions, group bounds) back.
 */
public class WindowManager(public val mainWindowId: String = "main") {
    private val _state = MutableStateFlow(WindowState(listOf(WindowSpec(mainWindowId, WindowType.MAIN, "Main", toolbarEnabled = false, closable = false)), emptyMap(), emptyMap(), mainWindowId, null))
    public val state: StateFlow<WindowState> get() = _state
    public val current: WindowState get() = _state.value
    private var seq = 0
    private fun nextId(prefix: String): String = "$prefix-${++seq}-${java.lang.Long.toString(System.nanoTime() and 0xffff, 36)}"
    /** Group bounds in root coordinates, reported by the UI for drop targeting: groupId → (left, top, right, bottom). */
    public val groupBounds: MutableMap<String, FloatArray> = LinkedHashMap()
    public var windowDefaults: (WindowType) -> WindowSettings = { WindowSettings() }

    /* ---------- groups & tabs ---------- */

    /** Opens tabs in a new group inside `windowId` (main by default). If the window has a layout, the new group is added as a horizontal split. */
    public fun openGroup(tabs: List<TabSpec>, windowId: String = mainWindowId, title: String? = null): String {
        val gid = nextId("group")
        _state.update { s ->
            val groups = s.groups + (gid to TabGroup(gid, tabs, 0, windowId))
            val layout = s.layouts[windowId]?.let { Pane.Split(false, listOf(it, Pane.Leaf(gid)), listOf(1f, 1f)) } ?: Pane.Leaf(gid)
            s.copy(groups = groups, layouts = s.layouts + (windowId to layout))
        }
        return gid
    }

    /** Opens the tabs in a brand-new floating window (what Compare does). */
    public fun openFloating(tabs: List<TabSpec>, title: String, type: WindowType = WindowType.FLOATING, width: Float = 380f, height: Float = 460f, x: Float? = null, y: Float? = null): String {
        val wid = nextId("win")
        val count = current.windows.count { it.isFloating }
        _state.update { s -> s.copy(windows = s.windows + WindowSpec(wid, type, title, toolbarEnabled = type != WindowType.ELEMENT, settings = windowDefaults(type), x = x ?: (24f + 28f * count), y = y ?: (72f + 28f * count), width = width, height = height, z = (s.windows.maxOfOrNull { it.z } ?: 0) + 1), focused = wid) }
        openGroup(tabs, wid)
        return wid
    }

    public fun activate(groupId: String, index: Int) { _state.update { s -> s.groups[groupId]?.let { g -> s.copy(groups = s.groups + (groupId to g.copy(active = index.coerceIn(0, (g.tabs.size - 1).coerceAtLeast(0))))) } ?: s } }

    public fun closeTab(tabId: String) {
        _state.update { s ->
            val g = s.groups.values.firstOrNull { gr -> gr.tabs.any { it.id == tabId } } ?: return@update s
            val tabs = g.tabs.filterNot { it.id == tabId }
            if (tabs.isEmpty()) removeGroup(s, g.id) else s.copy(groups = s.groups + (g.id to g.copy(tabs = tabs, active = g.active.coerceAtMost(tabs.size - 1))))
        }
    }

    private fun removeGroup(s: WindowState, groupId: String): WindowState {
        val g = s.groups[groupId] ?: return s
        val layout = s.layouts[g.windowId]?.remove(groupId)
        var out = s.copy(groups = s.groups - groupId, layouts = if (layout == null) s.layouts - g.windowId else s.layouts + (g.windowId to layout))
        val w = out.windows.firstOrNull { it.id == g.windowId }
        if (layout == null && w != null && w.isFloating) out = out.copy(windows = out.windows.filterNot { it.id == w.id }, focused = mainWindowId)
        return out
    }

    /** Move a tab to another group (any window) at `index` (-1 = end). Empty source groups disappear; an emptied floating window closes. */
    public fun moveTab(tabId: String, toGroup: String, index: Int = -1) {
        _state.update { s ->
            val from = s.groups.values.firstOrNull { gr -> gr.tabs.any { it.id == tabId } } ?: return@update s
            val tab = from.tabs.first { it.id == tabId }
            if (from.id == toGroup) {
                val list = from.tabs.toMutableList(); list.remove(tab); list.add(if (index < 0) list.size else index.coerceIn(0, list.size), tab)
                return@update s.copy(groups = s.groups + (from.id to from.copy(tabs = list, active = list.indexOf(tab))))
            }
            val target = s.groups[toGroup] ?: return@update s
            val remaining = from.tabs - tab
            val tList = target.tabs.toMutableList().apply { add(if (index < 0) size else index.coerceIn(0, size), tab) }
            var out = s.copy(groups = s.groups + (toGroup to target.copy(tabs = tList, active = tList.indexOf(tab))) + (from.id to from.copy(tabs = remaining, active = from.active.coerceAtMost((remaining.size - 1).coerceAtLeast(0)))))
            if (remaining.isEmpty()) out = removeGroup(out, from.id)
            out
        }
    }

    /** Drop at root coordinates: the group whose reported bounds contain the point receives the tab. */
    public fun dropAt(tabId: String, x: Float, y: Float): Boolean {
        val target = groupBounds.entries.firstOrNull { (_, b) -> x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] }?.key ?: return false
        moveTab(tabId, target); return true
    }
    public fun dragStart(tabId: String, fromGroup: String, x: Float, y: Float) { _state.update { it.copy(drag = TabDrag(tabId, fromGroup, x, y)) } }
    public fun dragMove(x: Float, y: Float) { _state.update { s -> s.drag?.let { s.copy(drag = it.copy(x = x, y = y)) } ?: s } }
    public fun dragEnd(): Boolean { val d = current.drag ?: return false; _state.update { it.copy(drag = null) }; return dropAt(d.tabId, d.x, d.y) }

    /* ---------- split ---------- */

    /**
     * Split a group into `mode`: its tabs are divided evenly across the new groups (5 tabs split in two →
     * 3 + 2), each new group gets its own pane; GRID uses `rows × cols` (custom grid dialog).
     */
    public fun split(groupId: String, mode: SplitMode, rows: Int = 2, cols: Int = 2) {
        _state.update { s ->
            val g = s.groups[groupId] ?: return@update s
            val n = when (mode) { SplitMode.VERTICAL, SplitMode.HORIZONTAL -> 2; SplitMode.FOUR_WAY -> 4; SplitMode.GRID -> (rows * cols).coerceAtLeast(1) }
            val parts = distribute(g.tabs, n)
            val ids = parts.indices.map { if (it == 0) groupId else nextId("group") }
            val groups = s.groups.toMutableMap()
            parts.forEachIndexed { i, tabs -> groups[ids[i]] = TabGroup(ids[i], tabs, 0, g.windowId) }
            val pane: Pane = when (mode) {
                SplitMode.VERTICAL -> Pane.Split(true, ids.map { Pane.Leaf(it) }, ids.map { 1f })
                SplitMode.HORIZONTAL -> Pane.Split(false, ids.map { Pane.Leaf(it) }, ids.map { 1f })
                SplitMode.FOUR_WAY -> Pane.Grid(2, 2, ids.map { Pane.Leaf(it) })
                SplitMode.GRID -> Pane.Grid(rows, cols, ids.map { Pane.Leaf(it) })
            }
            s.copy(groups = groups, layouts = s.layouts + (g.windowId to (s.layouts[g.windowId]?.replace(groupId, pane) ?: pane)))
        }
    }

    /** Even distribution: the first `size % n` groups get one extra tab (5 → 3 + 2, 7 in four → 2,2,2,1). Empty parts are kept so the grid has every cell. */
    public fun <T> distribute(items: List<T>, n: Int): List<List<T>> { val base = items.size / n; val extra = items.size % n; var i = 0; return List(n) { k -> val take = base + if (k < extra) 1 else 0; items.subList(i, i + take).also { i += take } } }

    public fun setWeights(windowId: String, pane: Pane, weights: List<Float>) { /* reserved for draggable dividers */ }

    /* ---------- undock / dock ---------- */

    /** Undock a tab group into a new floating window of type DOCK (toolbar forced on). */
    public fun undock(groupId: String, title: String? = null): String? {
        val g = current.groups[groupId] ?: return null
        val wid = nextId("win")
        _state.update { s ->
            var out = removeGroupKeepGroup(s, groupId)
            val w = WindowSpec(wid, WindowType.DOCK, title ?: g.activeTab?.title ?: "Tabs", toolbarEnabled = true, origin = groupId, settings = windowDefaults(WindowType.DOCK), x = 32f, y = 96f, z = (s.windows.maxOfOrNull { it.z } ?: 0) + 1)
            out = out.copy(windows = out.windows + w, groups = out.groups + (groupId to g.copy(windowId = wid)), layouts = out.layouts + (wid to Pane.Leaf(groupId)), focused = wid)
            out
        }
        return wid
    }
    private fun removeGroupKeepGroup(s: WindowState, groupId: String): WindowState { val g = s.groups[groupId] ?: return s; val layout = s.layouts[g.windowId]?.remove(groupId); var out = s.copy(layouts = if (layout == null) s.layouts - g.windowId else s.layouts + (g.windowId to layout)); val w = out.windows.firstOrNull { it.id == g.windowId }; if (layout == null && w != null && w.isFloating) out = out.copy(windows = out.windows.filterNot { it.id == w.id }); return out }

    /** Dock every group of a floating window back into the main window (as horizontal splits). */
    public fun redock(windowId: String) {
        _state.update { s ->
            val w = s.windows.firstOrNull { it.id == windowId } ?: return@update s
            if (!w.isFloating) return@update s
            val gids = s.layouts[windowId]?.groups() ?: emptyList()
            var groups = s.groups; var layout = s.layouts[mainWindowId]
            for (gid in gids) { groups = groups + (gid to groups.getValue(gid).copy(windowId = mainWindowId)); layout = layout?.let { Pane.Split(false, listOf(it, Pane.Leaf(gid)), listOf(1f, 1f)) } ?: Pane.Leaf(gid) }
            s.copy(windows = s.windows.filterNot { it.id == windowId }, groups = groups, layouts = (s.layouts - windowId) + (if (layout != null) mapOf(mainWindowId to layout) else emptyMap()), focused = mainWindowId)
        }
    }

    public fun close(windowId: String) { _state.update { s -> val gids = s.layouts[windowId]?.groups() ?: emptyList(); s.copy(windows = s.windows.filterNot { it.id == windowId }, groups = s.groups - gids.toSet(), layouts = s.layouts - windowId, focused = mainWindowId) } }
    public fun focus(windowId: String) { _state.update { s -> val top = (s.windows.maxOfOrNull { it.z } ?: 0) + 1; s.copy(windows = s.windows.map { if (it.id == windowId) it.copy(z = top) else it }, focused = windowId) } }
    public fun move(windowId: String, dx: Float, dy: Float) { update(windowId) { it.copy(x = it.x + dx, y = it.y + dy) } }
    public fun resize(windowId: String, w: Float, h: Float) { update(windowId) { it.copy(width = w.coerceAtLeast(200f), height = h.coerceAtLeast(160f)) } }
    public fun setSettings(windowId: String, settings: WindowSettings) { update(windowId) { it.copy(settings = settings) } }
    public fun setToolbar(windowId: String, enabled: Boolean) { update(windowId) { if (!it.toolbarsAllowed) it else it.copy(toolbarEnabled = enabled || it.forcesToolbar) } }

    /* ---------- minimize ---------- */

    public fun minimize(windowId: String, target: MinimizeTarget, atX: Float = 0f, atY: Float = 0f) { update(windowId) { it.copy(minimized = target, minimizedAtX = atX, minimizedAtY = atY) } }
    public fun restore(windowId: String) { update(windowId) { it.copy(minimized = null) }; focus(windowId) }
    /** "Minimize to title bar at screen location which cycles through all corners": each call moves the window's corner on. */
    public fun minimizeToNextCorner(windowId: String) { update(windowId) { it.copy(minimized = MinimizeTarget.CORNER_TITLEBAR, settings = it.settings.copy(corner = if (it.minimized == MinimizeTarget.CORNER_TITLEBAR) it.settings.corner.next() else it.settings.corner)) } }
    public fun minimizedAt(corner: Corner): List<WindowSpec> = current.windows.filter { it.minimized == MinimizeTarget.CORNER_TITLEBAR && it.settings.corner == corner }

    private fun update(windowId: String, f: (WindowSpec) -> WindowSpec) { _state.update { s -> s.copy(windows = s.windows.map { if (it.id == windowId) f(it) else it }) } }

    /* ---------- menus ---------- */

    /** Context-menu items for the `tab-group` target (payload = group id) with the Split submenu; apps merge them through the runtime's context extras. */
    public fun groupMenu(): List<MenuItem> = listOf(
        MenuItem("undock", "Undock to floating window", "external", "windows.undock:{payload}"),
        MenuItem("split", "Split", "grid", items = listOf(
            MenuItem("split-v", "Vertical", "layout", "windows.split:{payload}:vertical"),
            MenuItem("split-h", "Horizontal", "layout", "windows.split:{payload}:horizontal"),
            MenuItem("split-4", "Four-way", "grid", "windows.split:{payload}:four"),
            MenuItem("split-grid", "Custom grid…", "grid", "dialog:split-grid:{payload}"),
        )),
        MenuItem("s1", separator = true),
        MenuItem("close-group", "Close group", "x", "windows.closeGroup:{payload}"),
    )
    /** Context-menu items for the `window-title` target (payload = window id). */
    public fun windowMenu(): List<MenuItem> = listOf(
        MenuItem("settings", "Window settings…", "settings", "dialog:window-settings:{payload}"),
        MenuItem("redock", "Redock", "download", "windows.redock:{payload}"),
        MenuItem("min-corner", "Minimize to title bar (cycle corners)", "minus", "windows.minimizeCorner:{payload}"),
        MenuItem("min-toolbar", "Minimize to floating toolbar at cursor", "minus", "windows.minimizeToolbar:{payload}"),
        MenuItem("s1", separator = true),
        MenuItem("close", "Close", "x", "windows.close:{payload}"),
    )
    public fun closeGroup(groupId: String) { _state.update { s -> removeGroup(s, groupId) } }
}
