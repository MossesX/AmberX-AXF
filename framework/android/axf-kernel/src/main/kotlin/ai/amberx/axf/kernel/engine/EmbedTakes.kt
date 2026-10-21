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
)

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

    private fun withExtras(types: AssetTypeRegistry, e: Embed, takes: List<String>, page: String?): Embed =
        Embed(e.host, if (page != null) HideEngine.hideableTypes(types) else e.hidden, if (page != null) takes.filter { it != page } else takes, page)

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
        if (raw == null || raw.length > 4000) return null
        val o = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return null
        return parseMessage(o)
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
            else -> null
        }
    }

    /** The JSON a host sends a settings page to open one of its tabs (`AxfEmbedGuest.receive(<this>)`). */
    public fun openTab(tab: String): String? = if (tabId.matches(tab)) buildJsonObject { put("\$axf", MESSAGE); put("type", "open-tab"); put("tab", tab) }.toString() else null

    /** The settings tab an action names (`settings.open:<tab>`), or null. */
    public fun settingsTabOf(action: String): String? = Regex("^settings\\.open:([^:\\s]+)").find(action)?.groupValues?.get(1)?.takeIf { tabId.matches(it) }

    private fun decode(s: String): String = runCatching { java.net.URLDecoder.decode(s, "UTF-8") }.getOrDefault(s)
}
