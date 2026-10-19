package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Widget engine: widgets (asset types with "widget": true: clock, search bar) and the hosts that hold them.
 * Same rules as the web reference engine (framework/core/engines/widgets.ts); fixtures in spec/fixtures/widgets.json.
 *
 * A host is any chrome asset with a list of attached assets: the banner (`banner.attach`, sides left / center / right,
 * also takes badges) and the toolbar (`toolbar.widgets`, sides start / end). Modules attach more at run time; a run-time
 * entry with the same type + id replaces the host's own. Types the host doesn't take, unknown sides and assets that don't
 * exist are skipped.
 */
public data class SearchBarData(val placeholder: String, val maxResults: Int, val width: String, val kinds: List<String>? = null, val shortcut: Boolean = true) {
    public companion object {
        public fun fromJson(o: JsonObject): SearchBarData = SearchBarData(
            placeholder = o.str("placeholder", "Search…"),
            maxResults = (o["maxResults"] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull?.toInt() ?: 12,
            width = o.str("width", "regular"),
            kinds = if (o["kinds"] is JsonArray) o.strList("kinds") else null,
            shortcut = o.bool("shortcut", true),
        )
    }
}

public object WidgetEngine {
    public val WIDGET_TYPES: List<String> = listOf("clock", "search-bar")
    public val TOOLBAR_SIDES: List<String> = listOf("start", "end")
    /** Search bar width in multiples of the theme's space token. */
    public val SEARCH_BAR_WIDTH: Map<String, Int> = linkedMapOf("compact" to 18, "regular" to 30, "wide" to 46)

    public fun isWidget(type: String): Boolean = type in WIDGET_TYPES

    /** Where every attachment of a host goes, side by side (each side sorted by order, then key). */
    public fun placeOnHost(own: List<BannerAttachment>?, extra: List<BannerAttachment>, has: (String, String) -> Boolean,
                           types: List<String>, sides: List<String>): Map<String, List<PlacedAttachment>> {
        val byKey = LinkedHashMap<String, PlacedAttachment>()
        fun add(a: BannerAttachment, fallbackOrder: Double, origin: String) {
            if (a.type !in types || a.at !in sides || !has(a.type, a.id)) return
            val order = a.order?.takeIf { it.isFinite() } ?: fallbackOrder
            byKey[a.key] = PlacedAttachment(a.key, a.type, a.id, a.at, order, a.origin ?: origin)
        }
        own?.forEachIndexed { i, a -> add(a, i * 10.0, "asset") }
        extra.forEachIndexed { i, a -> add(a, 1000.0 + i * 10, "runtime") }
        return sides.associateWith { side -> byKey.values.filter { it.at == side }.sortedWith(compareBy<PlacedAttachment> { it.order }.thenBy { it.key }) }
    }

    /** A toolbar's own widgets (`toolbar.widgets`). */
    public fun toolbarWidgets(toolbar: JsonObject): List<BannerAttachment> = toolbar.objList("widgets").map {
        BannerAttachment(it.str("type"), it.str("id"), it.str("at"), (it["order"] as? JsonPrimitive)?.takeUnless { p -> p.isString }?.doubleOrNull)
    }

    /** The toolbar as a widget host: widgets only, at its start or end; no toolbar means nothing. */
    public fun placeToolbar(toolbar: JsonObject?, extra: List<BannerAttachment>, has: (String, String) -> Boolean): Map<String, List<PlacedAttachment>> =
        placeOnHost(toolbar?.let { toolbarWidgets(it) }, if (toolbar == null) emptyList() else extra, has, WIDGET_TYPES, TOOLBAR_SIDES)
}
