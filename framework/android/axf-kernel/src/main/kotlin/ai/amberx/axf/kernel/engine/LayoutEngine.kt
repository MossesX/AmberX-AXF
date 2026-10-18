package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.InspectorSide
import ai.amberx.axf.kernel.asset.Layout
import ai.amberx.axf.kernel.asset.MobileNav
import ai.amberx.axf.kernel.asset.NavSide
import ai.amberx.axf.kernel.asset.Side

/**
 * The layout region contract (Foundations: f.regions). Shells render these fixed regions; the engine
 * decides where each one sits. New regions may be appended by a later kernel level but never renamed.
 */
public enum class Region { MENUBAR, TOOLBAR, NAV, MAIN, INSPECTOR, STATUS, FAB, SHEET, OVERLAY;
    public val id: String get() = name.lowercase()
    public companion object { public fun parse(s: String): Region? = entries.firstOrNull { it.id == s } }
}

/**
 * Region slot contract: which asset types each region accepts. Mirrors asset-types.json
 * (layout.slots.defaults) and SLOT_REGIONS/DEFAULT_SLOTS in layout.ts; a layout overrides any region
 * with `data.slots`. Chrome (app-menu, toolbar, nav-menu) mounts only where its slot accepts it.
 */
public object Slots {
    public val DEFAULTS: Map<Region, List<String>> = linkedMapOf(
        Region.MENUBAR to listOf("app-menu"), Region.TOOLBAR to listOf("toolbar"), Region.NAV to listOf("nav-menu"),
        Region.MAIN to emptyList(), Region.INSPECTOR to emptyList(), Region.STATUS to emptyList(),
        Region.FAB to emptyList(), Region.SHEET to emptyList(), Region.OVERLAY to listOf("dialog", "popup", "context-menu"),
    )
    /** Defaults merged with the layout's overrides; unknown region names are ignored (tolerant decoding). */
    public fun compile(l: Layout): Map<Region, List<String>> = Region.entries.associateWith { r -> l.slots[r.id] ?: DEFAULTS.getValue(r) }
    public fun accepts(slots: Map<Region, List<String>>, region: Region, type: String): Boolean = slots[region]?.contains(type) == true
}

/** Window size classes (Foundations: f.windowclass), matching Material's breakpoints by default. */
public enum class WindowClass { COMPACT, MEDIUM, EXPANDED }

public enum class Orientation { VERTICAL, HORIZONTAL }

/** A column of the desktop grid. */
public data class Column(val region: Region, /** dp; null = flexible */ val width: Int?)

/** A row of the grid, spanning all columns unless it is the main row. */
public data class Row(val region: Region?, /** null = contains the column set */ val height: Int?)

/**
 * Compiled layout for one window class. On COMPACT/MEDIUM the engine produces the single-column phone
 * grid: nav becomes bottom tabs / drawer / rail, inspector becomes a sheet, toolbar may move to the bottom.
 */
public data class CompiledLayout(
    val windowClass: WindowClass,
    val regions: List<Region>,
    val rows: List<Row>,
    val columns: List<Column>,
    val navOrientation: Orientation,
    val mobileNav: MobileNav,
    val contentMaxWidth: Int?,
    val inspectorAsSheet: Boolean,
    val fab: Boolean,
    /** CSS grid-template-areas string, identical to the web port's output (for WebView hosts and devtools). */
    val cssAreas: String,
    val cssColumns: String,
    val cssRows: String,
    /** region -> accepted asset types (contract defaults merged with the layout's `slots`) */
    val slots: Map<Region, List<String>> = Slots.DEFAULTS,
) {
    public fun accepts(region: Region, type: String): Boolean = Slots.accepts(slots, region, type)
}

public object LayoutEngine {
    public fun windowClass(widthDp: Int, l: Layout): WindowClass = when {
        widthDp >= l.mobile.expandedFrom -> WindowClass.EXPANDED
        widthDp >= l.mobile.mediumFrom -> WindowClass.MEDIUM
        else -> WindowClass.COMPACT
    }

    public fun compile(l: Layout, wc: WindowClass): CompiledLayout = if (wc == WindowClass.EXPANDED) desktop(l) else mobile(l, wc)

    private fun desktop(l: Layout): CompiledLayout {
        val slots = Slots.compile(l)
        val navOn = Slots.accepts(slots, Region.NAV, "nav-menu")
        val menubar = l.showMenubar && Slots.accepts(slots, Region.MENUBAR, "app-menu")
        val toolbar = l.showToolbar && Slots.accepts(slots, Region.TOOLBAR, "toolbar")
        val cols = mutableListOf<Column>()
        if (navOn && l.nav == NavSide.LEFT) cols += Column(Region.NAV, l.navWidth)
        if (l.inspector == InspectorSide.LEFT) cols += Column(Region.INSPECTOR, l.inspectorWidth)
        cols += Column(Region.MAIN, null)
        if (l.inspector == InspectorSide.RIGHT) cols += Column(Region.INSPECTOR, l.inspectorWidth)
        if (navOn && l.nav == NavSide.RIGHT) cols += Column(Region.NAV, l.navWidth)

        val rows = mutableListOf<Row>()
        val regions = mutableListOf(Region.MAIN)
        fun add(r: Region) { rows += Row(r, null); if (r !in regions) regions += r }
        if (menubar) add(Region.MENUBAR)
        if (navOn && l.nav == NavSide.TOP) add(Region.NAV)
        if (toolbar && l.toolbarPosition == Side.TOP) add(Region.TOOLBAR)
        rows += Row(null, null)
        if (navOn && l.nav != NavSide.TOP) regions += Region.NAV
        if (l.inspector != InspectorSide.NONE) regions += Region.INSPECTOR
        if (toolbar && l.toolbarPosition == Side.BOTTOM) add(Region.TOOLBAR)
        if (l.showStatusbar) add(Region.STATUS)

        val names = cols.map { it.region.name.lowercase() }
        val areas = rows.joinToString(" ") { r -> if (r.region == null) "\"${names.joinToString(" ")}\"" else "\"${List(names.size) { r.region.name.lowercase() }.joinToString(" ")}\"" }
        val cssCols = cols.joinToString(" ") { if (it.width == null) "minmax(0, 1fr)" else "${it.width}px" }
        val cssRows = rows.joinToString(" ") { if (it.region == null) "minmax(0, 1fr)" else "auto" }
        return CompiledLayout(WindowClass.EXPANDED, regions, rows, cols, if (navOn && l.nav == NavSide.TOP) Orientation.HORIZONTAL else Orientation.VERTICAL, MobileNav.NONE,
            l.contentMaxWidth.takeIf { it > 0 }, false, l.mobile.fab, areas, cssCols, cssRows, slots)
    }

    private fun mobile(l: Layout, wc: WindowClass): CompiledLayout {
        val m = l.mobile
        val slots = Slots.compile(l)
        val navOn = Slots.accepts(slots, Region.NAV, "nav-menu")
        val menubar = l.showMenubar && Slots.accepts(slots, Region.MENUBAR, "app-menu")
        val toolbar = l.showToolbar && m.showToolbar && Slots.accepts(slots, Region.TOOLBAR, "toolbar")
        val rows = mutableListOf<Row>()
        val regions = mutableListOf(Region.MAIN)
        fun add(r: Region) { rows += Row(r, null); regions += r }
        val mNav = if (navOn) m.nav else MobileNav.NONE
        if (menubar) add(Region.MENUBAR)
        if (mNav == MobileNav.TOP_TABS) add(Region.NAV)
        if (toolbar && m.toolbarPosition == Side.TOP) add(Region.TOOLBAR)
        rows += Row(null, null)
        if (toolbar && m.toolbarPosition == Side.BOTTOM) add(Region.TOOLBAR)
        val nav = if (wc == WindowClass.MEDIUM && mNav != MobileNav.NONE) MobileNav.RAIL else mNav
        if (nav == MobileNav.BOTTOM_TABS) add(Region.NAV) else if (nav == MobileNav.RAIL || nav == MobileNav.DRAWER) regions += Region.NAV
        if (l.showStatusbar && wc == WindowClass.MEDIUM) add(Region.STATUS)
        if (l.inspector != InspectorSide.NONE) regions += if (m.inspectorAsSheet) Region.SHEET else Region.INSPECTOR
        if (m.fab) regions += Region.FAB
        val cols = if (nav == MobileNav.RAIL) listOf(Column(Region.NAV, 80), Column(Region.MAIN, null)) else listOf(Column(Region.MAIN, null))
        val areas = rows.joinToString(" ") { r -> "\"${(r.region ?: Region.MAIN).name.lowercase()}\"" }
        return CompiledLayout(wc, regions, rows, cols, Orientation.HORIZONTAL, nav, null, m.inspectorAsSheet, m.fab, areas, "minmax(0, 1fr)", rows.joinToString(" ") { if (it.region == null) "minmax(0, 1fr)" else "auto" }, slots)
    }
}
