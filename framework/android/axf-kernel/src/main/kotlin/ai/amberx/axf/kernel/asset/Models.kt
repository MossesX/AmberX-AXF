package ai.amberx.axf.kernel.asset

import kotlinx.serialization.json.JsonObject

/*
 * Typed, tolerant views over asset `data`. Every decoder accepts missing/extra fields and falls back
 * to the framework defaults, so an app built against kernel API level 1 keeps working with assets
 * authored for a later level. Field names are identical to framework/core/types.ts.
 */

public data class MenuItem(
    val id: String,
    val label: String? = null,
    val icon: String? = null,
    /** Action spec, e.g. "file.save" or "swap:color-theme:next" */
    val action: String? = null,
    val shortcut: String? = null,
    /** Permission required (UAC engine) */
    val requires: String? = null,
    val items: List<MenuItem> = emptyList(),
    val separator: Boolean = false,
) {
    public companion object {
        public fun fromJson(o: JsonObject): MenuItem = MenuItem(
            id = o.str("id"), label = o.strOrNull("label"), icon = o.strOrNull("icon"), action = o.strOrNull("action"),
            shortcut = o.strOrNull("shortcut"), requires = o.strOrNull("requires"),
            items = o.objList("items").map(::fromJson), separator = o.bool("separator"),
        )
        public fun list(o: JsonObject, key: String): List<MenuItem> = o.objList(key).map(::fromJson)
    }
}

/* ---------- themes ---------- */

public enum class Scheme { LIGHT, DARK; public companion object { public fun parse(s: String?): Scheme = if (s == "dark") DARK else LIGHT } }

/** The color token vocabulary. CORE tokens are required by the spec; EXTENDED tokens are optional and derived when absent. */
public object ColorTokens {
    public val CORE: List<String> = listOf("bg", "surface", "surface2", "surface3", "text", "muted", "border", "accent", "accentText", "accentSoft", "danger", "success", "warning", "info", "focus", "shadow")
    public val EXTENDED: List<String> = listOf(
        "accentHover", "accentPressed", "accent2", "accent2Text", "link", "selection", "overlay", "scrim", "inverseSurface", "inverseText",
        "dangerSoft", "successSoft", "warningSoft", "infoSoft", "onDanger", "onSuccess", "onWarning", "onInfo", "outline", "outlineVariant",
        "disabledBg", "disabledText", "placeholder", "divider", "tooltipBg", "tooltipText", "codeBg", "codeText", "navBg", "navText", "navActive",
        "toolbarBg", "statusBg", "chart1", "chart2", "chart3", "chart4", "chart5", "chart6", "gradientStart", "gradientEnd", "glassTint",
    )
    public val ALL: List<String> = CORE + EXTENDED
}

public data class ColorTheme(val scheme: Scheme, val tokens: Map<String, String>, /** id of the light/dark counterpart, when authored as a pair */ val pair: String? = null) {
    public operator fun get(token: String): String? = tokens[token]
    public companion object {
        public fun fromJson(o: JsonObject): ColorTheme = ColorTheme(Scheme.parse(o.strOrNull("scheme")), o.strMap("tokens"), o.strOrNull("pair"))
    }
}

public enum class Density(public val k: Double) { COMPACT(0.78), COMFORTABLE(1.0), SPACIOUS(1.22);
    public companion object { public fun parse(s: String?): Density = entries.firstOrNull { it.name.equals(s, true) } ?: COMFORTABLE } }

public data class Radii(val sm: Int, val md: Int, val lg: Int, /** extended ladder */ val xs: Int = sm / 2, val xl: Int = lg + 8, val full: Int = 999)
public data class Shadows(val sm: String, val md: String, val lg: String)

public data class StyleTheme(
    val fontFamily: String, val fontDisplay: String, val fontMono: String,
    /** base font size in px/sp */ val fontSize: Int,
    val radius: Radii,
    /** base spacing unit */ val space: Int,
    val borderWidth: Int,
    val shadow: Shadows,
    val density: Density,
    /** transition duration ms */ val motion: Int,
    /** backdrop blur px */ val blur: Int,
    val headingWeight: Int,
    /** heading letter-spacing em */ val tracking: Double,
    /* ---- Android extensions (optional in the JSON) ---- */
    val lineHeight: Double = 1.45,
    val typeScale: Double = 1.2,
    val iconSize: Int = 20,
    val controlHeight: Int = 40,
    val touchTarget: Int = 48,
    val elevationLevels: List<Int> = listOf(0, 1, 3, 6, 8, 12),
    val opacityDisabled: Double = 0.38,
    val opacityMuted: Double = 0.62,
    val easing: String = "standard",
    val springStiffness: Double = 400.0,
    val springDamping: Double = 0.8,
    val glass: Boolean = true,
    val extra: Map<String, String> = emptyMap(),
) {
    public companion object {
        public fun fromJson(o: JsonObject): StyleTheme {
            val r = o.obj("radius"); val s = o.obj("shadow")
            val sm = r?.int("sm", 6) ?: 6; val md = r?.int("md", 10) ?: 10; val lg = r?.int("lg", 14) ?: 14
            return StyleTheme(
                fontFamily = o.str("fontFamily", "sans-serif"), fontDisplay = o.str("fontDisplay", o.str("fontFamily", "sans-serif")), fontMono = o.str("fontMono", "monospace"),
                fontSize = o.int("fontSize", 14),
                radius = Radii(sm, md, lg, xs = r?.int("xs", sm / 2) ?: sm / 2, xl = r?.int("xl", lg + 8) ?: lg + 8),
                space = o.int("space", 8), borderWidth = o.int("borderWidth", 1),
                shadow = Shadows(s?.str("sm", "") ?: "", s?.str("md", "") ?: "", s?.str("lg", "") ?: ""),
                density = Density.parse(o.strOrNull("density")), motion = o.int("motion", 180), blur = o.int("blur", 14),
                headingWeight = o.int("headingWeight", 650), tracking = o.double("tracking", -0.02),
                lineHeight = o.double("lineHeight", 1.45), typeScale = o.double("typeScale", 1.2), iconSize = o.int("iconSize", 20),
                controlHeight = o.int("controlHeight", 40), touchTarget = o.int("touchTarget", 48),
                elevationLevels = o.arr("elevationLevels")?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content?.toIntOrNull() }?.takeIf { it.size >= 4 } ?: listOf(0, 1, 3, 6, 8, 12),
                opacityDisabled = o.double("opacityDisabled", 0.38), opacityMuted = o.double("opacityMuted", 0.62),
                easing = o.str("easing", "standard"), springStiffness = o.double("springStiffness", 400.0), springDamping = o.double("springDamping", 0.8),
                glass = o.bool("glass", true),
                extra = o.strMap("extra"),
            )
        }
    }
}

/* ---------- layout ---------- */

public enum class NavSide { LEFT, RIGHT, TOP; public companion object { public fun parse(s: String?): NavSide = entries.firstOrNull { it.name.equals(s, true) } ?: LEFT } }
public enum class Side { TOP, BOTTOM; public companion object { public fun parse(s: String?): Side = if (s == "bottom") BOTTOM else TOP } }
public enum class InspectorSide { LEFT, RIGHT, NONE; public companion object { public fun parse(s: String?): InspectorSide = entries.firstOrNull { it.name.equals(s, true) } ?: RIGHT } }

/** Phone/tablet behaviour of a layout (Android extension of the shared layout asset; all optional). */
public enum class MobileNav { BOTTOM_TABS, DRAWER, RAIL, TOP_TABS, NONE;
    public companion object { public fun parse(s: String?): MobileNav = when (s) { "drawer" -> DRAWER; "rail" -> RAIL; "top-tabs" -> TOP_TABS; "none" -> NONE; else -> BOTTOM_TABS } } }
public enum class AppBarStyle { SMALL, MEDIUM, LARGE, CENTER, NONE;
    public companion object { public fun parse(s: String?): AppBarStyle = entries.firstOrNull { it.name.equals(s, true) } ?: SMALL } }

public data class MobileLayout(
    val nav: MobileNav = MobileNav.BOTTOM_TABS,
    val appBar: AppBarStyle = AppBarStyle.SMALL,
    val showToolbar: Boolean = true,
    val toolbarPosition: Side = Side.BOTTOM,
    val fab: Boolean = false,
    val edgeToEdge: Boolean = true,
    val inspectorAsSheet: Boolean = true,
    /** window width in dp from which the desktop grid is used instead of the mobile one */
    val expandedFrom: Int = 840,
    val mediumFrom: Int = 600,
) {
    public companion object {
        public fun fromJson(o: JsonObject?): MobileLayout = if (o == null) MobileLayout() else MobileLayout(
            nav = MobileNav.parse(o.strOrNull("nav")), appBar = AppBarStyle.parse(o.strOrNull("appBar")),
            showToolbar = o.bool("showToolbar", true), toolbarPosition = Side.parse(o.strOrNull("toolbarPosition") ?: "bottom"),
            fab = o.bool("fab"), edgeToEdge = o.bool("edgeToEdge", true), inspectorAsSheet = o.bool("inspectorAsSheet", true),
            expandedFrom = o.int("expandedFrom", 840), mediumFrom = o.int("mediumFrom", 600),
        )
    }
}

public data class Layout(
    val nav: NavSide, val navWidth: Int, val showMenubar: Boolean, val showToolbar: Boolean, val toolbarPosition: Side,
    val showStatusbar: Boolean, val inspector: InspectorSide, val inspectorWidth: Int, val contentMaxWidth: Int,
    val mobile: MobileLayout = MobileLayout(),
) {
    public companion object {
        public fun fromJson(o: JsonObject): Layout = Layout(
            nav = NavSide.parse(o.strOrNull("nav")), navWidth = o.int("navWidth", 224), showMenubar = o.bool("showMenubar", true),
            showToolbar = o.bool("showToolbar", true), toolbarPosition = Side.parse(o.strOrNull("toolbarPosition")),
            showStatusbar = o.bool("showStatusbar", true), inspector = InspectorSide.parse(o.strOrNull("inspector")),
            inspectorWidth = o.int("inspectorWidth", 260), contentMaxWidth = o.int("contentMaxWidth", 1080),
            mobile = MobileLayout.fromJson(o.obj("mobile")),
        )
    }
}

/* ---------- navigation ---------- */

public data class AppMenu(val menus: List<Menu>) {
    public data class Menu(val id: String, val label: String, val items: List<MenuItem>)
    public companion object {
        public fun fromJson(o: JsonObject): AppMenu = AppMenu(o.objList("menus").map { Menu(it.str("id"), it.str("label"), MenuItem.list(it, "items")) })
    }
}

public enum class ToolbarVariant { ICONS, ICONS_LABELS, LABELS; public companion object { public fun parse(s: String?): ToolbarVariant = when (s) { "icons-labels" -> ICONS_LABELS; "labels" -> LABELS; else -> ICONS } } }
public enum class Align { START, CENTER, SPREAD; public companion object { public fun parse(s: String?): Align = entries.firstOrNull { it.name.equals(s, true) } ?: START } }
public data class ToolbarItem(val id: String, val icon: String, val label: String, val action: String, val requires: String? = null)
public data class Toolbar(val variant: ToolbarVariant, val align: Align, val groups: List<Group>, val showSearch: Boolean) {
    public data class Group(val id: String, val items: List<ToolbarItem>)
    public companion object {
        public fun fromJson(o: JsonObject): Toolbar = Toolbar(
            ToolbarVariant.parse(o.strOrNull("variant")), Align.parse(o.strOrNull("align")),
            o.objList("groups").map { g -> Group(g.str("id"), g.objList("items").map { ToolbarItem(it.str("id"), it.str("icon"), it.str("label"), it.str("action"), it.strOrNull("requires")) }) },
            o.bool("showSearch"),
        )
    }
}

public enum class NavStyle { LIST, PILLS, RAIL; public companion object { public fun parse(s: String?): NavStyle = entries.firstOrNull { it.name.equals(s, true) } ?: LIST } }
public data class NavItem(val id: String, val label: String, val icon: String, val view: String, val badge: String? = null, val requires: String? = null)
public data class NavMenu(val style: NavStyle, val header: String?, val sections: List<Section>) {
    public data class Section(val label: String?, val items: List<NavItem>)
    public val items: List<NavItem> get() = sections.flatMap { it.items }
    public companion object {
        public fun fromJson(o: JsonObject): NavMenu = NavMenu(
            NavStyle.parse(o.strOrNull("style")), o.strOrNull("header"),
            o.objList("sections").map { s -> Section(s.strOrNull("label"), s.objList("items").map { NavItem(it.str("id"), it.str("label"), it.str("icon"), it.str("view"), it.strOrNull("badge"), it.strOrNull("requires")) }) },
        )
    }
}

public enum class ContextVariant { COMPACT, ROOMY, GLASS; public companion object { public fun parse(s: String?): ContextVariant = entries.firstOrNull { it.name.equals(s, true) } ?: COMPACT } }
public data class ContextMenu(val variant: ContextVariant, val showIcons: Boolean, val showShortcuts: Boolean, /** target name -> items; "default" is the fallback */ val targets: Map<String, List<MenuItem>>) {
    public companion object {
        public fun fromJson(o: JsonObject): ContextMenu = ContextMenu(
            ContextVariant.parse(o.strOrNull("variant")), o.bool("showIcons", true), o.bool("showShortcuts", true),
            o.obj("targets")?.mapValues { (_, v) -> (v as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? JsonObject)?.let(MenuItem::fromJson) } ?: emptyList() } ?: emptyMap(),
        )
    }
}

/* ---------- overlays ---------- */

public enum class DialogVariant { MODAL, DRAWER, SHEET; public companion object { public fun parse(s: String?): DialogVariant = entries.firstOrNull { it.name.equals(s, true) } ?: MODAL } }
public enum class Backdrop { DIM, BLUR, NONE; public companion object { public fun parse(s: String?): Backdrop = entries.firstOrNull { it.name.equals(s, true) } ?: DIM } }
public enum class DialogAnim { SCALE, SLIDE, FADE; public companion object { public fun parse(s: String?): DialogAnim = entries.firstOrNull { it.name.equals(s, true) } ?: SCALE } }
public enum class HeaderStyle { PLAIN, ACCENT_BAR, FILLED, DIVIDED, ACCENT; public companion object { public fun parse(s: String?): HeaderStyle = when (s) { "accent-bar" -> ACCENT_BAR; "filled" -> FILLED; "divided" -> DIVIDED; "accent" -> ACCENT; else -> PLAIN } } }
public data class Dialog(val variant: DialogVariant, val width: Int, val backdrop: Backdrop, val animation: DialogAnim, val header: HeaderStyle, val closeOnBackdrop: Boolean) {
    public companion object {
        public fun fromJson(o: JsonObject): Dialog = Dialog(DialogVariant.parse(o.strOrNull("variant")), o.int("width", 480), Backdrop.parse(o.strOrNull("backdrop")), DialogAnim.parse(o.strOrNull("animation")), HeaderStyle.parse(o.strOrNull("header")), o.bool("closeOnBackdrop", true))
    }
}

public enum class PopupPosition { TOP_RIGHT, BOTTOM_RIGHT, BOTTOM_CENTER, TOP_CENTER; public companion object { public fun parse(s: String?): PopupPosition = entries.firstOrNull { it.name.equals(s?.replace('-', '_'), true) } ?: BOTTOM_RIGHT } }
public enum class PopupVariant { SOLID, OUTLINE, MINIMAL; public companion object { public fun parse(s: String?): PopupVariant = entries.firstOrNull { it.name.equals(s, true) } ?: SOLID } }
public data class Popup(val position: PopupPosition, val variant: PopupVariant, val duration: Int, val showIcon: Boolean, val maxVisible: Int) {
    public companion object {
        public fun fromJson(o: JsonObject): Popup = Popup(PopupPosition.parse(o.strOrNull("position")), PopupVariant.parse(o.strOrNull("variant")), o.int("duration", 4000), o.bool("showIcon", true), o.int("maxVisible", 3))
    }
}

/* ---------- controls ---------- */

public enum class Shape { ROUNDED, PILL, SQUARE; public companion object { public fun parse(s: String?): Shape = entries.firstOrNull { it.name.equals(s, true) } ?: ROUNDED } }
public enum class Fill { SOLID, SOFT, OUTLINE, GRADIENT, NONE; public companion object { public fun parse(s: String?): Fill = entries.firstOrNull { it.name.equals(s, true) } ?: SOLID } }
public enum class Size { SM, MD, LG; public companion object { public fun parse(s: String?): Size = entries.firstOrNull { it.name.equals(s, true) } ?: MD } }
public data class Button(val shape: Shape, val fill: Fill, val weight: Int, val uppercase: Boolean, val size: Size, val elevation: Boolean) {
    public companion object { public fun fromJson(o: JsonObject): Button = Button(Shape.parse(o.strOrNull("shape")), Fill.parse(o.strOrNull("fill")), o.int("weight", 600), o.bool("uppercase"), Size.parse(o.strOrNull("size")), o.bool("elevation")) }
}
public enum class Thumb { CIRCLE, SQUARE, BAR; public companion object { public fun parse(s: String?): Thumb = entries.firstOrNull { it.name.equals(s, true) } ?: CIRCLE } }
public enum class ShowValue { ALWAYS, HOVER, NEVER; public companion object { public fun parse(s: String?): ShowValue = entries.firstOrNull { it.name.equals(s, true) } ?: HOVER } }
public data class Slider(val track: Int, val thumb: Thumb, val thumbSize: Int, val fill: Fill, val showValue: ShowValue, val ticks: Boolean) {
    public companion object { public fun fromJson(o: JsonObject): Slider = Slider(o.int("track", 4), Thumb.parse(o.strOrNull("thumb")), o.int("thumbSize", 18), Fill.parse(o.strOrNull("fill")), ShowValue.parse(o.strOrNull("showValue")), o.bool("ticks")) }
}
public enum class ContainerVariant { CARD, PANEL, GLASS, OUTLINE; public companion object { public fun parse(s: String?): ContainerVariant = entries.firstOrNull { it.name.equals(s, true) } ?: CARD } }
public data class Container(val variant: ContainerVariant, val header: HeaderStyle, val padding: Size, val elevation: Int, val collapsible: Boolean) {
    public companion object { public fun fromJson(o: JsonObject): Container = Container(ContainerVariant.parse(o.strOrNull("variant")), HeaderStyle.parse(o.strOrNull("header")), Size.parse(o.strOrNull("padding")), o.int("elevation", 1).coerceIn(0, 3), o.bool("collapsible")) }
}

/* ---------- system ---------- */

public enum class Gating { HIDE, DISABLE; public companion object { public fun parse(s: String?): Gating = if (s == "hide") HIDE else DISABLE } }
public data class UacRole(val id: String, val label: String, val description: String? = null, /** permission ids; "*" = all, "assets.*" = namespace wildcard */ val permissions: List<String>, val inherits: List<String> = emptyList())
public data class UacPolicy(val defaultRole: String, val gating: Gating, val roles: List<UacRole>, /** permission id -> description */ val permissions: Map<String, String>) {
    public fun role(id: String): UacRole? = roles.firstOrNull { it.id == id }
    public companion object {
        public fun fromJson(o: JsonObject): UacPolicy = UacPolicy(
            o.str("defaultRole", "user"), Gating.parse(o.strOrNull("gating")),
            o.objList("roles").map { UacRole(it.str("id"), it.str("label", it.str("id")), it.strOrNull("description"), it.strList("permissions"), it.strList("inherits")) },
            o.strMap("permissions"),
        )
    }
}

/** Typed decode of a core asset's data by its type. Returns null for types without a kernel model (modules decode those). */
public fun AssetEnvelope.decode(): Any? = when (type) {
    AssetTypes.COLOR_THEME -> ColorTheme.fromJson(data)
    AssetTypes.STYLE_THEME -> StyleTheme.fromJson(data)
    AssetTypes.LAYOUT -> Layout.fromJson(data)
    AssetTypes.APP_MENU -> AppMenu.fromJson(data)
    AssetTypes.TOOLBAR -> Toolbar.fromJson(data)
    AssetTypes.NAV_MENU -> NavMenu.fromJson(data)
    AssetTypes.CONTEXT_MENU -> ContextMenu.fromJson(data)
    AssetTypes.DIALOG -> Dialog.fromJson(data)
    AssetTypes.POPUP -> Popup.fromJson(data)
    AssetTypes.BUTTON -> Button.fromJson(data)
    AssetTypes.SLIDER -> Slider.fromJson(data)
    AssetTypes.CONTAINER -> Container.fromJson(data)
    AssetTypes.UAC_POLICY -> UacPolicy.fromJson(data)
    else -> null
}
