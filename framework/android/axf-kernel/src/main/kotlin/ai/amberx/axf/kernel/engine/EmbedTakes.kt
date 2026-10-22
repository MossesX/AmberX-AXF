package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AssetTypeRegistry
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** One function a host can take over from the apps it embeds (embed@1 `takes`): its hooks, and whether it has a page. */
public data class EmbedTakeSpec(
    val actions: List<String> = emptyList(),
    val prefixes: List<String> = emptyList(),
    val views: List<String> = emptyList(),
    val providers: List<String> = emptyList(),
    val page: Boolean = false,
    /** chrome the app hides while the host takes this function (app-menu: the host's menu carries the app's) */
    val hides: List<String> = emptyList(),
)

/** One item of a menu an app sends its host (embed@1 `menu`): data only, the app keeps id → action. */
public data class EmbedMenuItem(
    val id: String,
    val label: String,
    val icon: String? = null,
    val separator: Boolean = false,
    val locked: Boolean = false,
    /** check mark state; null = not a checkable item */
    val check: Boolean? = null,
    val count: Int? = null,
    /** a submenu; null when it has none */
    val items: List<EmbedMenuItem>? = null,
)
public data class EmbedMenu(val id: String, val label: String, val items: List<EmbedMenuItem>)

/** A message between a host and an app it embeds (embed@1), checked and cut to size by [EmbedTakes.parseMessage]. */
public sealed interface EmbedMessage {
    /** guest → host: open the combined settings on this app's tab (and [tab] inside it) */
    public data class OpenSettings(val tab: String? = null) : EmbedMessage
    /** guest → host: show a notification for this app */
    public data class Notify(val title: String, val body: String? = null, val tag: String? = null, val level: String? = null, val link: String? = null) : EmbedMessage
    /** guest → host: the app is up */
    public data class Ready(val app: String? = null) : EmbedMessage
    /** host → settings page: open this settings tab */
    public data class OpenTab(val tab: String) : EmbedMessage
    /** guest → host (the host takes `app-menu`): the app's application menu */
    public data class Menu(val menus: List<EmbedMenu>) : EmbedMessage
    /** host → guest: send your menu now */
    public data object MenuRequest : EmbedMessage
    /** host → guest: the user picked this item of your menu in the host's menu; run it */
    public data class Run(val id: String) : EmbedMessage
}

/**
 * What a host takes over, page mode and host/guest messages (embed@1, Oct 21 2026). Mirrors the second half of
 * core/engines/embed.ts; fixture spec/fixtures/embed-takes.json (EmbedTakesConformanceTest).
 *
 *   query        &axf-embed-take=<fn>[,<fn>]   &axf-embed-page=<fn>
 *   user agent   AXF-Embed-Take/<fn>[+<fn>]    (its own token, next to AXF-Embed/<host>)
 *
 * The host (Patches) marks its WebViews with [userAgentSuffix] and builds settings-page URLs with [embedUrl]; it reads
 * what a page sends through its JS bridge with [parseMessage].
 */
public object EmbedTakes {
    public const val TAKE_QUERY: String = "axf-embed-take"
    public const val PAGE_QUERY: String = "axf-embed-page"
    public const val UA_TOKEN: String = "AXF-Embed-Take"
    public const val MESSAGE: String = "embed@1"

    private val registry = linkedMapOf(
        "settings" to EmbedTakeSpec(listOf("app.settings", "settings.open", "nav:settings"), listOf("settings.open:"), listOf("settings"), listOf("settings"), page = true),
        "notifications" to EmbedTakeSpec(),
        // The host's application menu carries the app's (Oct 22 2026): the app hides its menu bar and sends its menu.
        "app-menu" to EmbedTakeSpec(hides = listOf("app-menu")),
    )
    private val fnId = Regex("^[a-z0-9][a-z0-9-]{0,31}$")
    private val tabId = Regex("^[a-z0-9][a-z0-9._:-]{0,63}$", RegexOption.IGNORE_CASE)
    private val uaTakes = Regex("(?:^|[\\s(;,])" + Regex.escape(UA_TOKEN) + "/([^\\s;),]+)")
    private val inAppLink = Regex("^(view|settings):[a-z0-9][a-z0-9._:-]{0,63}$", RegexOption.IGNORE_CASE)
    private val levels = listOf("info", "success", "warning", "error")

    /** Add (or replace) a function hosts can take over (same ids on every port). */
    public fun register(id: String, spec: EmbedTakeSpec) {
        require(fnId.matches(id) && id != EmbedEngine.HIDE_NONE) { "embed: bad function id \"$id\"" }
        registry[id] = spec
    }

    public fun ids(): List<String> = registry.keys.toList()
    public fun spec(id: String): EmbedTakeSpec? = registry[id]

    /** Functions named, cleaned: known only, registry order, no repeats; nothing / `none` = nothing taken. */
    public fun takes(named: List<String>?): List<String> {
        val list = (named ?: emptyList()).map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        if (EmbedEngine.HIDE_NONE in list) return emptyList()
        val wanted = list.toSet()
        return ids().filter { it in wanted }
    }
    public fun takes(named: String?): List<String> = takes(named?.split(',', '+', ' '))

    /** A page a host may show on its own, or null. */
    public fun page(raw: String?): String? {
        val id = raw?.trim()?.lowercase() ?: return null
        return if (registry[id]?.page == true) id else null
    }

    private fun withExtras(types: AssetTypeRegistry, e: Embed, takes: List<String>, page: String?): Embed {
        val t = if (page != null) takes.filter { it != page } else takes
        // a taken function may hide chrome too (app-menu); spec order, like EmbedEngine.hidden
        val extra = t.flatMap { registry[it]?.hides ?: emptyList() }.toSet()
        val hidden = when {
            page != null -> HideEngine.hideableTypes(types)
            extra.isNotEmpty() -> HideEngine.hideableTypes(types).filter { it in e.hidden || it in extra }
            else -> e.hidden
        }
        return Embed(e.host, hidden, t, page)
    }

    private fun params(search: String): Map<String, String> {
        val q = if (search.startsWith("?")) search.substring(1) else search
        val out = LinkedHashMap<String, String>()
        for (pair in q.split('&')) {
            if (pair.isEmpty()) continue
            val at = pair.indexOf('=')
            val k = decode(if (at < 0) pair else pair.substring(0, at))
            if (k !in out) out[k] = decode(if (at < 0) "" else pair.substring(at + 1))
        }
        return out
    }

    /** The full marker in a query string (host, hidden, takes, page). */
    public fun fromQuery(types: AssetTypeRegistry, search: String?): Embed? {
        val base = EmbedEngine.fromQuery(types, search) ?: return null
        val p = params(search!!)
        return withExtras(types, base, takes(p[TAKE_QUERY]), page(p[PAGE_QUERY]))
    }

    /** The full marker in a user agent (host, hidden, takes). */
    public fun fromUserAgent(types: AssetTypeRegistry, ua: String?): Embed? {
        val base = EmbedEngine.fromUserAgent(types, ua) ?: return null
        return withExtras(types, base, takes(uaTakes.find(ua!!)?.groupValues?.get(1)), null)
    }

    /** Query marker, else user agent; the user agent's takes still apply when the query names none for the same host. */
    public fun detect(types: AssetTypeRegistry, search: String?, userAgent: String?): Embed? {
        val q = fromQuery(types, search)
        val u = fromUserAgent(types, userAgent)
        if (q == null) return u
        if (q.takes.isNotEmpty() || u == null || u.takes.isEmpty() || u.host != q.host) return q
        return withExtras(types, q, u.takes, page(params(search!!)[PAGE_QUERY]))
    }

    /** The taken function this action is a hook of, or null. */
    public fun takenBy(e: Embed?, action: String?): String? {
        if (e == null || e.takes.isEmpty() || action.isNullOrEmpty()) return null
        for (fn in e.takes) {
            val s = registry[fn] ?: continue
            if (action in s.actions || s.prefixes.any { action.startsWith(it) }) return fn
            if (action.startsWith("nav:") && action.substring(4) in s.views) return fn
        }
        return null
    }
    public fun takenView(e: Embed?, view: String?): String? = if (e == null || view == null) null else e.takes.firstOrNull { registry[it]?.views?.contains(view) == true }
    public fun takenProvider(e: Embed?, provider: String?): String? = if (e == null || provider == null) null else e.takes.firstOrNull { registry[it]?.providers?.contains(provider) == true }

    /** Host side: `AXF-Embed/<host>[/…]` plus ` AXF-Embed-Take/<fn>+<fn>` when it takes anything. */
    public fun userAgentSuffix(types: AssetTypeRegistry, host: String, hide: List<String> = EmbedEngine.DEFAULT_HIDDEN, take: List<String> = emptyList()): String {
        val base = EmbedEngine.userAgentSuffix(types, host, hide)
        val t = takes(take)
        return if (t.isEmpty()) base else "$base $UA_TOKEN/" + t.joinToString("+")
    }

    /** Host side: a page URL with the full marker (host, hidden, takes, page); old `axf-embed*` params replaced. */
    public fun embedUrl(types: AssetTypeRegistry, url: String, host: String, hide: List<String> = EmbedEngine.DEFAULT_HIDDEN, take: List<String> = emptyList(), page: String? = null): String {
        val base = EmbedEngine.embedUrl(types, url, host, hide)
        val hashAt = base.indexOf('#')
        val hash = if (hashAt >= 0) base.substring(hashAt) else ""
        val noHash = if (hashAt >= 0) base.substring(0, hashAt) else base
        val qAt = noHash.indexOf('?')
        val kept = noHash.substring(qAt + 1).split('&').filter { it.isNotEmpty() }
            .filter { val k = decode(it.substringBefore('=')); k != TAKE_QUERY && k != PAGE_QUERY }
        val pg = page(page)
        val t = takes(take).filter { it != pg }
        val mine = mutableListOf<String>()
        if (t.isNotEmpty()) mine += "$TAKE_QUERY=" + t.joinToString(",")
        if (pg != null) mine += "$PAGE_QUERY=$pg"
        return noHash.substring(0, qAt) + "?" + (kept + mine).joinToString("&") + hash
    }

    /** A link a notification may carry: https (no credentials), or in-app `view:<id>` / `settings:<tab>`. */
    public fun linkOk(link: String?): Boolean {
        if (link.isNullOrEmpty() || link.length > 300) return false
        if (inAppLink.matches(link)) return true
        return runCatching { val u = java.net.URI(link); u.scheme == "https" && u.userInfo == null && !u.host.isNullOrEmpty() }.getOrDefault(false)
    }

    private fun clip(v: JsonElement?, max: Int): String? {
        val s = (v as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val t = s.replace(Regex("[\\u0000-\\u001f\\u007f]+"), " ").trim()
        return if (t.isEmpty()) null else t.take(max)
    }
    private fun str(v: JsonElement?): String? = (v as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** A message as it arrived (JSON text from the page's bridge call), checked and cut to size; null when it isn't one. */
    public fun parseMessage(raw: String?): EmbedMessage? {
        // a menu may be long; every other message stays small
        if (raw == null || raw.length > MENU_RAW) return null
        val o = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return null
        if (raw.length > 4000 && str(o["type"]) != "menu") return null
        return parseMessage(o)
    }

    public const val MENU_RAW: Int = 131072
    private const val MENUS = 16
    private const val MENU_ITEMS = 600
    private const val MENU_DEPTH = 4
    private val menuItemId = Regex("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$")
    private val iconId = Regex("^[a-z0-9][a-z0-9-]{0,39}$")

    /** A menu an app sent, checked and cut to size (bad entries dropped, never the whole menu); null when not a list. */
    private fun parseMenus(raw: JsonElement?): List<EmbedMenu>? {
        val list = raw as? kotlinx.serialization.json.JsonArray ?: return null
        var budget = MENU_ITEMS
        fun item(v: JsonElement, depth: Int): EmbedMenuItem? {
            val o = v as? JsonObject ?: return null
            if (budget <= 0) return null
            val id = str(o["id"])?.takeIf { menuItemId.matches(it) } ?: return null
            if ((o["separator"] as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true) { budget--; return EmbedMenuItem(id, "", separator = true) }
            val label = clip(o["label"], 80) ?: return null
            budget--
            val check = (o["check"] as? JsonPrimitive)?.takeIf { !it.isString && (it.content == "true" || it.content == "false") }?.content?.toBoolean()
            val n = (o["count"] as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toDoubleOrNull()
            val count = if (n != null && n.isFinite() && n > 0) minOf(kotlin.math.floor(n), 99999.0).toInt() else null
            val kids = if (depth < MENU_DEPTH) (o["items"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item(it, depth + 1) }?.takeIf { it.isNotEmpty() } else null
            return EmbedMenuItem(
                id, label,
                icon = str(o["icon"])?.takeIf { iconId.matches(it) },
                locked = (o["locked"] as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true,
                check = check, count = count, items = kids,
            )
        }
        val out = mutableListOf<EmbedMenu>()
        for (m in list.take(MENUS)) {
            val o = m as? JsonObject ?: continue
            val id = str(o["id"])?.takeIf { menuItemId.matches(it) } ?: continue
            val label = clip(o["label"], 80) ?: continue
            val items = (o["items"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { item(it, 1) } ?: continue
            if (items.isNotEmpty()) out += EmbedMenu(id, label, items)
        }
        return out
    }

    public fun parseMessage(o: JsonObject): EmbedMessage? {
        if (str(o["\$axf"]) != MESSAGE) return null
        return when (str(o["type"])) {
            "open-settings" -> EmbedMessage.OpenSettings(str(o["tab"])?.takeIf { tabId.matches(it) })
            "notify" -> {
                val title = clip(o["title"], 120) ?: return null
                EmbedMessage.Notify(
                    title,
                    clip(o["body"], 500),
                    str(o["tag"])?.takeIf { tabId.matches(it) },
                    str(o["level"])?.takeIf { it in levels },
                    str(o["link"])?.takeIf { linkOk(it) },
                )
            }
            "ready" -> EmbedMessage.Ready(EmbedEngine.host(str(o["app"])))
            "open-tab" -> str(o["tab"])?.takeIf { tabId.matches(it) }?.let { EmbedMessage.OpenTab(it) }
            "menu" -> parseMenus(o["menus"])?.let { EmbedMessage.Menu(it) }
            "menu-request" -> EmbedMessage.MenuRequest
            "run" -> str(o["id"])?.takeIf { menuItemId.matches(it) }?.let { EmbedMessage.Run(it) }
            else -> null
        }
    }

    /** The JSON a host sends a settings page to open one of its tabs (`AxfEmbedGuest.receive(<this>)`). */
    public fun openTab(tab: String): String? = if (tabId.matches(tab)) buildJsonObject { put("\$axf", MESSAGE); put("type", "open-tab"); put("tab", tab) }.toString() else null

    /** The JSON a host sends an app to run one of the menu items it sent (`AxfEmbedGuest.receive(<this>)`). */
    public fun run(id: String): String? = if (menuItemId.matches(id)) buildJsonObject { put("\$axf", MESSAGE); put("type", "run"); put("id", id) }.toString() else null

    /** The JSON a host sends an app to have it send its menu now. */
    public fun menuRequest(): String = buildJsonObject { put("\$axf", MESSAGE); put("type", "menu-request") }.toString()

    /** The settings tab an action names (`settings.open:<tab>`), or null. */
    public fun settingsTabOf(action: String): String? = Regex("^settings\\.open:([^:\\s]+)").find(action)?.groupValues?.get(1)?.takeIf { tabId.matches(it) }

    private fun decode(s: String): String = runCatching { java.net.URLDecoder.decode(s, "UTF-8") }.getOrDefault(s)
}
