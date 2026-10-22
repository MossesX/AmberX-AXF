package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AssetTypeRegistry

/**
 * The host app this one runs inside (embed@1): its id, the chrome it shows for the app (forced hidden here), the app
 * functions it takes over ([EmbedTakes]: `settings`, `notifications`) and the one page it shows on its own, if any.
 */
public data class Embed(val host: String, val hidden: List<String>, val takes: List<String> = emptyList(), val page: String? = null)

/**
 * Embed engine (embed@1) — an app running inside another app's frame. Mirrors core/engines/embed.ts.
 *
 * A host app (Patches: one banner, the Dev Console / Build Pilot / axHub in tabs) marks the pages it embeds, and the
 * embedded app hides the chrome the host already shows (its banner by default), so there is one banner on screen.
 * Standalone, the same app keeps its own banner. Nothing is stored: the marker rides on every page load.
 *
 * The marker, two carriers (the query wins when both are present):
 *   query        ?axf-embed=<host>[&axf-embed-hide=<type>[,<type>]]
 *   user agent   AXF-Embed/<host>[/<type>[+<type>]]          (a WebView: survives sign-in redirects and SPA routing)
 * `<host>` is `[a-z0-9][a-z0-9-]{0,31}`; the types are hideable chrome types; unknown or non-hideable types are dropped;
 * none (valid) named = [DEFAULT_HIDDEN]; `none` = hide nothing. A marker without a valid host is no marker.
 *
 * Host side (Patches): [userAgentSuffix] / [embedUrl] mark what a WebView loads. Guest side: [detect].
 * Fixture: spec/fixtures/embed.json.
 */
public object EmbedEngine {
    public const val QUERY: String = "axf-embed"
    public const val HIDE_QUERY: String = "axf-embed-hide"
    public const val UA_TOKEN: String = "AXF-Embed"
    public const val HIDE_NONE: String = "none"
    /** What a host hides in the apps it embeds unless it says otherwise: the banner (one banner on screen, the host's). */
    public val DEFAULT_HIDDEN: List<String> = listOf("banner")

    private val hostId = Regex("^[a-z0-9][a-z0-9-]{0,31}$")
    private val uaMarker = Regex("(?:^|[\\s(;,])" + Regex.escape(UA_TOKEN) + "/([^\\s/;),]+)(?:/([^\\s;),]+))?")

    /** A valid host id, lower-cased, or null. */
    public fun host(raw: String?): String? {
        val id = raw?.trim()?.lowercase() ?: return null
        return if (hostId.matches(id)) id else null
    }

    /** The types a host names, cleaned: hideable only, spec order, no repeats; nothing valid named = the default; `none` = nothing. */
    public fun hidden(types: AssetTypeRegistry, named: List<String>?): List<String> {
        val list = (named ?: emptyList()).map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        if (HIDE_NONE in list) return emptyList()
        val wanted = list.filter { HideEngine.hideable(types, it) }.toSet()
        val out = HideEngine.hideableTypes(types).filter { it in wanted }
        return if (out.isNotEmpty()) out else HideEngine.hideableTypes(types).filter { it in DEFAULT_HIDDEN }
    }

    /** Splits a `type,type` / `type+type` / `type type` list the way the web does. */
    public fun hidden(types: AssetTypeRegistry, named: String?): List<String> = hidden(types, named?.split(',', '+', ' '))

    /** The marker in a page's query string (`?axf-embed=…`, with or without the `?`), or null. */
    public fun fromQuery(types: AssetTypeRegistry, search: String?): Embed? {
        if (search.isNullOrEmpty()) return null
        val q = if (search.startsWith("?")) search.substring(1) else search
        val params = LinkedHashMap<String, String>()
        for (pair in q.split('&')) {
            if (pair.isEmpty()) continue
            val at = pair.indexOf('=')
            val k = decode(if (at < 0) pair else pair.substring(0, at))
            val v = decode(if (at < 0) "" else pair.substring(at + 1))
            if (k !in params) params[k] = v // URLSearchParams.get = the first value
        }
        val h = host(params[QUERY]) ?: return null
        return Embed(h, hidden(types, params[HIDE_QUERY]))
    }

    /** The marker in a user-agent string (`AXF-Embed/<host>[/<type>+<type>]`), or null. */
    public fun fromUserAgent(types: AssetTypeRegistry, ua: String?): Embed? {
        if (ua.isNullOrEmpty()) return null
        val m = uaMarker.find(ua) ?: return null
        val h = host(m.groupValues[1]) ?: return null
        return Embed(h, hidden(types, m.groups[2]?.value))
    }

    /** The embed an app runs in: the query marker, else the user-agent marker, else null (standalone). */
    public fun detect(types: AssetTypeRegistry, search: String?, userAgent: String?): Embed? = fromQuery(types, search) ?: fromUserAgent(types, userAgent)

    /** Host side: the user-agent suffix a host's web views append (`AXF-Embed/<host>`, plus `/<type>+<type>` or `/none` when not the default). */
    public fun userAgentSuffix(types: AssetTypeRegistry, hostName: String, hide: List<String> = DEFAULT_HIDDEN): String {
        val id = host(hostName) ?: throw IllegalArgumentException("embed: bad host id \"$hostName\"")
        val list = hidden(types, hide)
        if (isDefault(types, list)) return "$UA_TOKEN/$id"
        return "$UA_TOKEN/$id/" + (if (list.isEmpty()) HIDE_NONE else list.joinToString("+"))
    }

    /** Host side: a page URL with the query marker added (existing `axf-embed*` params replaced; hash kept). */
    public fun embedUrl(types: AssetTypeRegistry, url: String, hostName: String, hide: List<String> = DEFAULT_HIDDEN): String {
        val id = host(hostName) ?: throw IllegalArgumentException("embed: bad host id \"$hostName\"")
        val hashAt = url.indexOf('#')
        val hash = if (hashAt >= 0) url.substring(hashAt) else ""
        val noHash = if (hashAt >= 0) url.substring(0, hashAt) else url
        val qAt = noHash.indexOf('?')
        val path = if (qAt >= 0) noHash.substring(0, qAt) else noHash
        val kept = (if (qAt >= 0) noHash.substring(qAt + 1) else "").split('&').filter { it.isNotEmpty() }
            .filter { val k = decode(it.substringBefore('=')); k != QUERY && k != HIDE_QUERY }
            .map { p -> val at = p.indexOf('='); if (at < 0) encode(decode(p)) + "=" else encode(decode(p.substring(0, at))) + "=" + encode(decode(p.substring(at + 1))) }
        val list = hidden(types, hide)
        val mine = mutableListOf("$QUERY=$id")
        if (!isDefault(types, list)) mine += "$HIDE_QUERY=" + (if (list.isEmpty()) HIDE_NONE else list.joinToString(","))
        return path + "?" + (kept + mine).joinToString("&") + hash
    }

    private fun isDefault(types: AssetTypeRegistry, list: List<String>): Boolean = list == hidden(types, emptyList())

    // application/x-www-form-urlencoded, the way URLSearchParams does it (`+` = space; commas kept readable on the way out).
    private fun decode(s: String): String = runCatching { java.net.URLDecoder.decode(s, "UTF-8") }.getOrDefault(s)
    private fun encode(s: String): String = java.net.URLEncoder.encode(s, "UTF-8").replace("%2C", ",")
}
