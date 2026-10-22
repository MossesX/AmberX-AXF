package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AssetTypeRegistry

/**
 * Hide engine — which slots may be hidden, and which are hidden now. Mirrors core/engines/hide.ts:
 * a type with `"hideable": true` in asset-types.json (the chrome: app-menu, toolbar, nav-menu, context-menu)
 * gets a Hidden choice; while hidden its chrome is not drawn (LayoutEngine drops its region, a hidden
 * context menu never opens) and randomize rolls skip it. Themes, layouts, controls and the access policy
 * are never hideable. Fixtures: spec/fixtures/hide.json, layout-slots.json (`hidden-*` cases).
 */
public object HideEngine {
    public fun hideable(types: AssetTypeRegistry, type: String): Boolean = types.get(type)?.hideable == true

    /** Every hideable type, in spec order. */
    public fun hideableTypes(types: AssetTypeRegistry): List<String> = types.ids().filter { hideable(types, it) }

    /**
     * The hidden slots given runtime overrides (type -> hidden) and the app's defaults (`manifest.hidden`: hidden until
     * the user shows them). An override wins either way (true hides, false shows); with no override the default
     * decides. Non-hideable types never hide, whatever either says.
     *
     * [forced] (embed@1, EmbedEngine): chrome a host app shows for this one while it is embedded; always hidden, over
     * any override — the user's choice stays saved for when the app runs on its own.
     */
    public fun hiddenSlots(types: AssetTypeRegistry, overrides: Map<String, Boolean>, defaults: List<String> = emptyList(), forced: List<String> = emptyList()): List<String> =
        hideableTypes(types).filter { t -> t in forced || (overrides[t]?.let { it } ?: (t in defaults)) }

    /** The app's default hidden slots, cleaned: hideable types only, in spec order, no repeats. */
    public fun defaultHidden(types: AssetTypeRegistry, manifestHidden: List<String>): List<String> =
        hideableTypes(types).filter { it in manifestHidden }
}
