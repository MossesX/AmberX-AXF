package ai.amberx.axf.ui.shell

import ai.amberx.axf.kernel.asset.MobileNav
import ai.amberx.axf.kernel.engine.Orientation
import ai.amberx.axf.kernel.engine.Region
import ai.amberx.axf.kernel.engine.WindowClass
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfLayout
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.ShellRegionContribution
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfInspector
import ai.amberx.axf.ui.components.AxfMenubar
import ai.amberx.axf.ui.components.AxfNav
import ai.amberx.axf.ui.components.AxfStatusBar
import ai.amberx.axf.ui.components.AxfToolbar
import ai.amberx.axf.ui.components.PlaceholderScreen
import ai.amberx.axf.ui.components.drawEndBorder
import ai.amberx.axf.ui.components.drawStartBorder
import ai.amberx.axf.ui.components.drawTopBorder
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * The application shell: renders the fixed regions of the compiled layout for the current window class.
 * EXPANDED → desktop grid (menubar / toolbar / nav / main / inspector / status, in the layout asset's
 * positions); MEDIUM → rail + main; COMPACT → phone grid (menubar, toolbar, main, bottom tabs / drawer / top tabs,
 * inspector as a sheet). `views` maps view ids (nav-menu asset `view`) to composables; unknown views render
 * PlaceholderScreen. Modules inject extra content into regions via `ExtensionPoints.SHELL_REGIONS`.
 */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
public fun AppShell(
    views: Map<String, @Composable () -> Unit>,
    modifier: Modifier = Modifier,
    viewTitles: Map<String, String> = emptyMap(),
    inspector: (@Composable () -> Unit)? = null,
    fab: (@Composable () -> Unit)? = null,
    onSearch: ((String) -> Boolean)? = null,
) {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val compiled = LocalAxfCompiled.current
    val layout = LocalAxfLayout.current
    val kernel = LocalAxfKernel.current
    val c = Axf.colors
    val regionExtras = remember(kernel, compiled.rev) { kernel?.extensions?.get(ExtensionPoints.SHELL_REGIONS)?.filterIsInstance<ShellRegionContribution>()?.groupBy { it.region } ?: emptyMap() }
    val viewIds = remember(views) { views.keys }
    val main: @Composable () -> Unit = { Box(Modifier.fillMaxSize()) { (views[state.view] ?: { PlaceholderScreen(viewTitles[state.view] ?: state.view) })() } }
    val hasRegion = { r: Region -> r in layout.regions }
    val inspectorContent: (@Composable () -> Unit)? = inspector ?: regionExtras[Region.INSPECTOR]?.let { list -> { AxfInspector { list.forEach { it.content() } } } }

    when (layout.windowClass) {
        WindowClass.EXPANDED -> DesktopGrid(modifier, layout, hasRegion, viewIds, viewTitles, onSearch, main, inspectorContent, regionExtras, fab)
        WindowClass.MEDIUM, WindowClass.COMPACT -> PhoneGrid(modifier, layout, hasRegion, viewIds, viewTitles, onSearch, main, inspectorContent, regionExtras, fab)
    }
}

@Composable
private fun DesktopGrid(
    modifier: Modifier, layout: ai.amberx.axf.kernel.engine.CompiledLayout, has: (Region) -> Boolean, viewIds: Set<String>, titles: Map<String, String>, onSearch: ((String) -> Boolean)?,
    main: @Composable () -> Unit, inspector: (@Composable () -> Unit)?, extras: Map<Region, List<ShellRegionContribution>>, fab: (@Composable () -> Unit)?,
) {
    val c = Axf.colors
    val l = LocalAxfCompiled.current.layout
    Column(modifier.fillMaxSize().background(c.bg).windowInsetsPadding(WindowInsets.statusBars)) {
        for (row in layout.rows) {
            when (row.region) {
                Region.MENUBAR -> AxfMenubar(Modifier.fillMaxWidth())
                Region.TOOLBAR -> AxfToolbar(Modifier.fillMaxWidth(), titles, onSearch)
                Region.NAV -> AxfNav(Modifier.fillMaxWidth(), viewIds, Orientation.HORIZONTAL)
                Region.STATUS -> AxfStatusBar(Modifier.fillMaxWidth(), extras[Region.STATUS]?.map { it.content } ?: emptyList())
                null -> Row(Modifier.weight(1f).fillMaxWidth()) {
                    for (col in layout.columns) {
                        when (col.region) {
                            Region.NAV -> Box(Modifier.width((col.width ?: 224).dp).fillMaxHeight().background(c.navBg).then(if (l.nav == ai.amberx.axf.kernel.asset.NavSide.LEFT) Modifier.drawEndBorder(c.border, 1.dp) else Modifier.drawStartBorder(c.border, 1.dp))) { AxfNav(Modifier.fillMaxSize(), viewIds, Orientation.VERTICAL) }
                            Region.INSPECTOR -> Box(Modifier.width((col.width ?: 260).dp).fillMaxHeight().background(c.surface).then(if (l.inspector == ai.amberx.axf.kernel.asset.InspectorSide.RIGHT) Modifier.drawStartBorder(c.border, 1.dp) else Modifier.drawEndBorder(c.border, 1.dp)).verticalScroll(rememberScrollState())) { inspector?.invoke() ?: AxfInspector { } }
                            Region.MAIN -> Box(Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
                                Box(Modifier.fillMaxSize().then(layout.contentMaxWidth?.let { Modifier.widthIn(max = it.dp) } ?: Modifier)) { main() }
                                extras[Region.OVERLAY]?.forEach { it.content() }
                                if (fab != null) Box(Modifier.align(Alignment.BottomEnd).padding(24.dp)) { fab() }
                            }
                            else -> {}
                        }
                    }
                }
                else -> {}
            }
        }
    }
}

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
private fun PhoneGrid(
    modifier: Modifier, layout: ai.amberx.axf.kernel.engine.CompiledLayout, has: (Region) -> Boolean, viewIds: Set<String>, titles: Map<String, String>, onSearch: ((String) -> Boolean)?,
    main: @Composable () -> Unit, inspector: (@Composable () -> Unit)?, extras: Map<Region, List<ShellRegionContribution>>, fab: (@Composable () -> Unit)?,
) {
    val c = Axf.colors
    val runtime = LocalAxfRuntime.current
    var sheetOpen by remember { mutableStateOf(false) }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val body: @Composable () -> Unit = {
        Column(modifier.fillMaxSize().background(c.bg).windowInsetsPadding(WindowInsets.statusBars)) {
            for (row in layout.rows) {
                when (row.region) {
                    Region.MENUBAR -> AxfMenubar(Modifier.fillMaxWidth(), compact = true)
                    Region.TOOLBAR -> AxfToolbar(Modifier.fillMaxWidth(), titles, onSearch)
                    Region.NAV -> if (layout.mobileNav == MobileNav.TOP_TABS) AxfNav(Modifier.fillMaxWidth(), viewIds, Orientation.HORIZONTAL)
                        else Box(Modifier.fillMaxWidth().background(c.navBg).drawTopBorder(c.border, 1.dp).windowInsetsPadding(WindowInsets.navigationBars)) { AxfNav(Modifier.fillMaxWidth(), viewIds, Orientation.HORIZONTAL, bottomTabs = true) }
                    Region.STATUS -> AxfStatusBar(Modifier.fillMaxWidth(), extras[Region.STATUS]?.map { it.content } ?: emptyList())
                    null -> Row(Modifier.weight(1f).fillMaxWidth()) {
                        if (layout.mobileNav == MobileNav.RAIL) Box(Modifier.width(80.dp).fillMaxHeight().background(c.navBg).drawEndBorder(c.border, 1.dp)) { AxfNav(Modifier.fillMaxSize(), viewIds, Orientation.VERTICAL, rail = true) }
                        Box(Modifier.weight(1f).fillMaxHeight()) {
                            main()
                            extras[Region.OVERLAY]?.forEach { it.content() }
                            if (layout.mobileNav == MobileNav.DRAWER) Box(Modifier.align(Alignment.TopStart).padding(8.dp)) { AxfIconButton("menu", "Open navigation", { scope.launch { drawer.open() } }) }
                            if (inspector != null && layout.inspectorAsSheet) Box(Modifier.align(Alignment.TopEnd).padding(8.dp)) { AxfIconButton("layers", "Open inspector", { sheetOpen = true }) }
                            if (fab != null) Box(Modifier.align(Alignment.BottomEnd).padding(16.dp)) { fab() }
                        }
                    }
                    else -> {}
                }
            }
        }
        if (sheetOpen && inspector != null) ModalBottomSheet(onDismissRequest = { sheetOpen = false }, containerColor = c.surface) { inspector() }
    }
    if (layout.mobileNav == MobileNav.DRAWER) {
        ModalNavigationDrawer(drawerState = drawer, drawerContent = { Box(Modifier.width(280.dp).fillMaxHeight().background(c.navBg)) { AxfNav(Modifier.fillMaxSize(), viewIds, Orientation.VERTICAL) { scope.launch { drawer.close() }; runtime.navigate(it) } } }) { body() }
    } else body()
}
