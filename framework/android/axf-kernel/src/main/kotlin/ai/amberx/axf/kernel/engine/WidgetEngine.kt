package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Widget engine: widgets (asset types with "widget": true: clock, search bar) and the hosts that hold them.
 * Same rules as the web reference engine (framework/core/engines/widgets.ts); fixtures in spec/fixtures/widgets.json.
 *
 * A *host* is any chrome asset with a list of attached assets. The framework ships two, both declared in
 * asset-types.json (so a port, a validator and this engine read one definition): the banner (`banner.attach`, sides
 * left / center / right, takes badges and every widget) and the toolbar (`toolbar.widgets`, sides start / end, widgets
 * only). Modules attach more at run time; a run-time entry with the same type + id replaces the host's own. Types the
 * host doesn't take, unknown sides and assets that don't exist are skipped. Hosts are an open registry ([registerHost]).
 */
public data class HostSpec(val host: String, val field: String, val types: List<String>, val sides: List<String>)

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

/** A search bar's normalized live-search config (defaults filled, maxResults clamped): web `searchBarConfig`. */
public data class SearchBarConfig(val placeholder: String, val maxResults: Int, val width: Int, val kinds: List<String>?, val shortcut: Boolean)

public object WidgetEngine {
    public val WIDGET_TYPES: List<String> = listOf("clock", "search-bar")
    public val ATTACHABLE_TYPES: List<String> = listOf("clock", "search-bar", "badge")
    public val TOOLBAR_SIDES: List<String> = listOf("start", "end")
    /** Search bar width in multiples of the theme's space token. */
    public val SEARCH_BAR_WIDTH: Map<String, Int> = linkedMapOf("compact" to 18, "regular" to 30, "wide" to 46)
    public const val SEARCH_MAX_RESULTS_MIN: Int = 1
    public const val SEARCH_MAX_RESULTS_MAX: Int = 50
    public const val SEARCH_MAX_RESULTS_DEFAULT: Int = 12

    private val hosts = LinkedHashMap<String, HostSpec>()
    init {
        // The same two hosts asset-types.json declares (toolbar first, as the spec lists `toolbar` before `banner`).
        registerHost(HostSpec("toolbar", "widgets", WIDGET_TYPES, TOOLBAR_SIDES))
        registerHost(HostSpec("banner", "attach", listOf("badge") + WIDGET_TYPES, listOf("left", "center", "right")))
    }

    /** Register (or replace) a host. Libraries may make any chrome asset a host without a kernel change. */
    public fun registerHost(h: HostSpec) { hosts[h.host] = h }
    public fun hostSpec(host: String): HostSpec? = hosts[host]
    public fun hostSpecs(): List<HostSpec> = hosts.values.toList()
    public fun isHost(type: String): Boolean = type in hosts
    public fun isWidget(type: String): Boolean = type in WIDGET_TYPES

    /** Hosts declared by a type registry's specs (`attach` / `widgets` blocks) — lets a module's own spec file add hosts. */
    public fun loadHosts(types: AssetTypeRegistry, specJson: JsonObject) {
        val widgetTypes = (specJson.obj("types") ?: return).entries.filter { (_, v) -> (v as? JsonObject)?.bool("widget") == true }.map { it.key }.ifEmpty { WIDGET_TYPES }
        for ((id, v) in specJson.obj("types") ?: return) {
            val o = v as? JsonObject ?: continue
            if (types.get(id) == null) continue
            o.obj("attach")?.let { a -> registerHost(HostSpec(id, "attach", a.strList("types").ifEmpty { widgetTypes }, a.strList("sides"))) }
            o.obj("widgets")?.let { w -> registerHost(HostSpec(id, "widgets", widgetTypes, w.strList("sides"))) }
        }
    }

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

    /** The attachment list a host asset's data carries (its host field). */
    public fun ownAttachments(host: String, data: JsonObject): List<BannerAttachment> {
        val h = hostSpec(host) ?: return emptyList()
        return data.objList(h.field).map { BannerAttachment(it.str("type"), it.str("id"), it.str("at"), (it["order"] as? JsonPrimitive)?.takeUnless { p -> p.isString }?.doubleOrNull) }
    }

    /**
     * Place attachments on a registered host from the host asset's data plus run-time ones. With [requireHost] (the
     * toolbar's rule) no host asset means nothing is placed; without it (the banner's rule) run-time entries still place.
     */
    public fun placeHost(host: String, data: JsonObject?, extra: List<BannerAttachment>, has: (String, String) -> Boolean, requireHost: Boolean = true): Map<String, List<PlacedAttachment>> {
        val h = hostSpec(host) ?: return emptyMap()
        return placeOnHost(data?.let { ownAttachments(host, it) }, if (data != null || !requireHost) extra else emptyList(), has, h.types, h.sides)
    }

    /** A toolbar's own widgets (`toolbar.widgets`). */
    public fun toolbarWidgets(toolbar: JsonObject): List<BannerAttachment> = ownAttachments("toolbar", toolbar)

    /** The toolbar as a widget host: widgets only, at its start or end; no toolbar means nothing. */
    public fun placeToolbar(toolbar: JsonObject?, extra: List<BannerAttachment>, has: (String, String) -> Boolean): Map<String, List<PlacedAttachment>> =
        placeHost("toolbar", toolbar, extra, has)

    /** Validate a host's own attachment list; same messages as validateHostAttachments in widgets.ts / build-engine.mjs. */
    public fun validateHostAttachments(host: String, list: JsonElement?): List<String> {
        val h = hostSpec(host) ?: return emptyList()
        val arr = list as? JsonArray ?: return listOf("data.${h.field} must be a list")
        val errors = mutableListOf<String>()
        arr.forEachIndexed { i, a ->
            val p = "data.${h.field}[$i]"
            val e = a as? JsonObject
            if (e == null) { errors += "$p must be an object {type, id, at}"; return@forEachIndexed }
            val type = (e["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (type == null || type !in h.types) errors += "$p.type must be one of: ${h.types.joinToString(", ")}"
            val id = (e["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (id.isNullOrEmpty()) errors += "$p.id must be an asset id"
            val at = (e["at"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            if (at == null || at !in h.sides) errors += "$p.at must be one of: ${h.sides.joinToString(", ")}"
            if ("order" in e) { val n = (e["order"] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull; if (n == null || !n.isFinite()) errors += "$p.order must be a number" }
        }
        return errors
    }

    /** Normalized search bar config, same numbers as the web port's `searchBarConfig`. */
    public fun searchBarConfig(d: JsonObject?): SearchBarConfig {
        val n = (d?.get("maxResults") as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull?.takeIf { it.isFinite() }?.let { Math.floor(it + 0.5).toInt() } ?: SEARCH_MAX_RESULTS_DEFAULT
        val kinds = (d?.get("kinds") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.takeIf { s -> s.isNotEmpty() } }?.takeIf { it.isNotEmpty() }
        val placeholder = (d?.get("placeholder") as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotEmpty() } ?: "Search…"
        val width = (d?.get("width") as? JsonPrimitive)?.takeIf { it.isString }?.content?.let { SEARCH_BAR_WIDTH[it] } ?: SEARCH_BAR_WIDTH.getValue("regular")
        val sp = d?.get("shortcut") as? JsonPrimitive
        val shortcut = !(sp != null && !sp.isString && sp.content == "false") // only a boolean false turns it off, as on the web
        return SearchBarConfig(placeholder, n.coerceIn(SEARCH_MAX_RESULTS_MIN, SEARCH_MAX_RESULTS_MAX), width, kinds, shortcut)
    }
}
