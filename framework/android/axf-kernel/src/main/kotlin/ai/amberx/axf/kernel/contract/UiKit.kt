package ai.amberx.axf.kernel.contract

/*
 * UI-kit switching contract (kernel API level 1). Every AXF component the apps use (button, slider,
 * card, text field, nav, dialog, …) is an abstract kind; a *UI kit* supplies the concrete widget for
 * each kind. Kits come from any third-party library (on Android: Material 3, Material 2, an unstyled
 * kit, a Cupertino-style kit; on the web: MUI, Chakra, shadcn, Ant; on Python: Qt Widgets vs QML) and
 * the active kit is chosen by the hot-swappable `ui-kit` asset, so switching libraries is a swap, not
 * a rewrite. Every kit renders from the same compiled tokens, so themes and style packs keep working.
 */

/** The abstract component vocabulary. A kit may cover a subset; uncovered kinds fall back to the default kit. */
public enum class ComponentKind {
    BUTTON, ICON_BUTTON, FAB, TEXT_FIELD, SEARCH_FIELD, PASSWORD_FIELD, SWITCH, CHECKBOX, RADIO, CHIP, SEGMENTED, SLIDER, STEPPER, PROGRESS,
    CARD, PANEL, LIST_ITEM, SECTION_HEADER, BADGE, DIVIDER, AVATAR, TOOLTIP,
    TOP_BAR, MENUBAR, TOOLBAR, NAV_LIST, NAV_RAIL, NAV_BOTTOM, NAV_TABS, DRAWER, STATUS_BAR, BREADCRUMBS,
    DIALOG, BOTTOM_SHEET, SIDE_SHEET, POPUP, TOAST, SNACKBAR, BANNER, CONTEXT_MENU, DROPDOWN_MENU,
    EMPTY_STATE, LOADING_STATE, ERROR_STATE, DATE_PICKER, TIME_PICKER, COLOR_PICKER, TABLE, CHART, MARKDOWN, CODE_EDITOR, RICH_TEXT, MEDIA_PLAYER, MAP,
    // Form controls (Oct 21 2026): shared Field / SelectField / ChoiceGrid / Note / Section / LibraryParamField on both ports.
    SELECT_FIELD, CHOICE_GRID, LIBRARY_PARAM, SECTION, NOTE;
}

/** Identity of a kit; the implementation table lives in the port's UI layer (Compose composables, React components, Qt widgets). */
public data class UiKitSpec(
    /** asset id of the ui-kit asset that selects it, e.g. `material3`, `material2`, `unstyled`, `cupertino` */
    val id: String,
    val label: String,
    /** the third-party library behind it, for the console's module manager */
    val library: String,
    val version: String = "",
    val covers: Set<ComponentKind> = ComponentKind.entries.toSet(),
    val module: String = "axf-ui",
    /** true when the kit is the port's built-in default (Material 3 on Android) */
    val isDefault: Boolean = false,
) {
    public fun covers(kind: ComponentKind): Boolean = kind in covers
}

/** Resolves which kit renders which kind: the active kit if it covers the kind, else the default. */
public class UiKitResolver(private val kits: () -> List<UiKitSpec>, private val active: () -> String?) {
    public fun kitFor(kind: ComponentKind): UiKitSpec? {
        val all = kits()
        val chosen = all.firstOrNull { it.id == active() }
        return if (chosen != null && chosen.covers(kind)) chosen else all.firstOrNull { it.isDefault } ?: all.firstOrNull()
    }
    public fun coverage(id: String): Map<ComponentKind, String> = ComponentKind.entries.associateWith { kind -> (kits().firstOrNull { it.id == id }?.takeIf { it.covers(kind) } ?: kits().firstOrNull { it.isDefault })?.id ?: "none" }
}
