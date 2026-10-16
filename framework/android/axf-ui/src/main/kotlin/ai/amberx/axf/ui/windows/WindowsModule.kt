package ai.amberx.axf.ui.windows

import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.strOrNull
import ai.amberx.axf.kernel.contract.Corner
import ai.amberx.axf.kernel.contract.MinimizeMode
import ai.amberx.axf.kernel.contract.MinimizeTarget
import ai.amberx.axf.kernel.contract.SplitMode
import ai.amberx.axf.kernel.contract.TabSpec
import ai.amberx.axf.kernel.contract.WindowManager
import ai.amberx.axf.kernel.contract.WindowSettings
import ai.amberx.axf.kernel.contract.WindowSpec
import ai.amberx.axf.kernel.contract.WindowType
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.DialogContribution
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf

/** Renders what a tab of `kind` shows. Apps register one per kind. */
public fun interface TabRenderer { @Composable public fun Render(tab: TabSpec) }

/** Registry of tab kinds → renderers (service `axf.windows.tabs`). */
public class TabRenderers {
    private val map = LinkedHashMap<String, TabRenderer>()
    public fun register(kind: String, r: TabRenderer) { map[kind] = r }
    public fun get(kind: String): TabRenderer? = map[kind]
    public fun kinds(): Set<String> = map.keys
}

public val LocalTabRenderers: ProvidableCompositionLocal<TabRenderers> = staticCompositionLocalOf { TabRenderers() }
public val LocalWindowManager: ProvidableCompositionLocal<WindowManager?> = staticCompositionLocalOf { null }

/**
 * Wires the kernel WindowManager into the UI: actions (`windows.*`), context targets `tab-group` and
 * `window-title`, the Split-grid and Window-settings dialogs, and window defaults from the `window` asset.
 */
public class WindowsModule : BaseModule(ID, "Windows & tabs") {
    override val provides: List<Capability> = listOf(Capability("axf.windows.ui", "Floating windows, tab groups, docking, splits"))
    public val renderers: TabRenderers = TabRenderers()

    override fun register(ctx: ModuleContext) {
        val wm = ctx.service(WindowManager::class) ?: return
        val runtime = ctx.service(AxfRuntime::class)
        ctx.services.register(TabRenderers::class, renderers, "axf.windows.tabs")
        for (k in listOf("element", "element-category", "element-flags")) renderers.register(k) { tab -> ai.amberx.axf.ui.studio.UndockedElementTab(tab.kind, tab.payload) }
        renderers.register("placeholder") { tab -> ai.amberx.axf.ui.components.PlaceholderScreen(tab.title) }
        runtime?.contextExtras?.put("tab-group", wm.groupMenu())
        runtime?.contextExtras?.put("window-title", wm.windowMenu())
        runtime?.asset(ai.amberx.axf.kernel.asset.AssetTypes.WINDOW)?.data?.let { d ->
            val m = d.obj("minimize")
            val corner = Corner.entries.firstOrNull { it.name.equals(m?.strOrNull("corner")?.replace('-', '_'), true) } ?: Corner.BOTTOM_RIGHT
            val mode = if (m?.strOrNull("mode") == "lined") MinimizeMode.LINED else MinimizeMode.STACKED
            wm.windowDefaults = { WindowSettings(corner, mode) }
        }
        fun act(id: String, label: String, fn: (List<String>) -> Unit) = ctx.extensions.contribute(ExtensionPoints.ACTIONS, this.id, ActionContribution(id, ActionMeta(label, module = this.id)) { a, _ -> fn(a) })
        act("windows.undock", "Undock tab group") { a -> a.getOrNull(0)?.let { wm.undock(it) } }
        act("windows.split", "Split tab group") { a -> val g = a.getOrNull(0) ?: return@act; when (a.getOrNull(1)) { "vertical" -> wm.split(g, SplitMode.VERTICAL); "horizontal" -> wm.split(g, SplitMode.HORIZONTAL); "four" -> wm.split(g, SplitMode.FOUR_WAY); "grid" -> wm.split(g, SplitMode.GRID, a.getOrNull(2)?.toIntOrNull() ?: 2, a.getOrNull(3)?.toIntOrNull() ?: 2); else -> wm.split(g, SplitMode.HORIZONTAL) } }
        act("windows.closeGroup", "Close tab group") { a -> a.getOrNull(0)?.let { wm.closeGroup(it) } }
        act("windows.redock", "Redock window") { a -> a.getOrNull(0)?.let { wm.redock(it) } }
        act("windows.close", "Close window") { a -> a.getOrNull(0)?.let { wm.close(it) } }
        act("windows.minimizeCorner", "Minimize to title bar") { a -> a.getOrNull(0)?.let { wm.minimizeToNextCorner(it) } }
        act("windows.minimizeToolbar", "Minimize to floating toolbar") { a -> a.getOrNull(0)?.let { wm.minimize(it, MinimizeTarget.FLOATING_TOOLBAR, WindowPointer.x, WindowPointer.y) } }
        act("windows.restore", "Restore window") { a -> a.getOrNull(0)?.let { wm.restore(it) } }
        act("windows.focus", "Focus window") { a -> a.getOrNull(0)?.let { wm.focus(it) } }
        act("windows.openFloating", "Open floating window") { a -> wm.openFloating(listOf(TabSpec("tab-${System.nanoTime()}", a.getOrElse(1) { "Tab" }, a.getOrElse(0) { "placeholder" }, a.getOrElse(2) { "" })), a.getOrElse(1) { "Window" }) }
        ctx.extensions.contribute(ExtensionPoints.DIALOGS, id, DialogContribution("split-grid", "Custom grid", "grid") { st -> SplitGridDialog(st.props["arg"] ?: "") })
        ctx.extensions.contribute(ExtensionPoints.DIALOGS, id, DialogContribution("window-settings", "Window settings", "settings") { st -> WindowSettingsDialog(st.props["arg"] ?: "") })
    }
    public companion object { public const val ID: String = "ai.amberx.axf.ui.windows" }
}

/** Last pointer position in root coordinates, kept by the window host so "minimize at cursor" knows where. */
public object WindowPointer { public var x: Float = 100f; public var y: Float = 200f }
