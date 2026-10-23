package ai.amberx.axf.hub

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor

/** What the hub said about this session and its queue (same ids as the web port's `HubFeedStatus`). */
public enum class HubFeedStatus(public val id: String) {
    OK("ok"),
    /** No session, or it expired: sign in again. */
    SIGNED_OUT("signed-out"),
    /** Signed in, but not an admin (or a first-sign-in password change is due). */
    NOT_ADMIN("not-admin"),
    /** Network error, a refused redirect, an oversized or unexpected reply, or another HTTP status. */
    UNREACHABLE("unreachable"),
}

/** One call waiting for approval, as the hub's feed lists it; [url] is always built from the id. */
public data class HubApproval(val id: String, val tool: String, val summary: String, val createdAt: String, val expiresAt: String, val url: String)

/** One reading of the approvals feed. [error] says why it is unreachable ("" otherwise). */
public data class HubFeed(val status: HubFeedStatus, val count: Int, val pending: List<HubApproval>, val approvalsUrl: String, val error: String)

/** Ring-once tracking: new ids to alert, seen ids gone (clear their alerts), and the seen list to keep. */
public data class SeenPlan(val fresh: List<String>, val gone: List<String>, val next: List<String>)

/**
 * lib-hub's pure rules (no Android imports), the Kotlin twin of `framework/libs/hub/hub.ts`; both replay
 * `framework/spec/fixtures/hub-approvals.json`. Hub address rules, hub URLs, the approvals feed of axHub decision #85
 * (`GET /auth/admin/approvals.json`) and its status mapping, seen-id tracking. The hub protocol contract (AXPP) is not
 * here: it stays parked for Fable ([PLACEHOLDERS]).
 */
public object HubRules {
    public const val DEFAULT: String = "https://axhub.amberxai.com"
    public const val FEED_MAX_BYTES: Int = 256 * 1024
    public const val FEED_MAX_ITEMS: Int = 50
    public const val SEEN_CAP: Int = 200
    public const val CAP_TOOL: Int = 120
    public const val CAP_SUMMARY: Int = 600
    public const val CAP_TIME: Int = 64

    public const val PATH_FEED: String = "/auth/admin/approvals.json"
    public const val PATH_APPROVALS: String = "/auth/admin/approvals"
    public const val PATH_LOGIN: String = "/auth/login"
    public const val PATH_ACCOUNT: String = "/auth/account"
    public const val PATH_LOGOUT: String = "/auth/logout"
    public const val PATH_APPS: String = "/apps"

    public const val MSG_ANSWERED: String = "The hub answered {status}."
    public const val MSG_UNEXPECTED: String = "The hub sent something unexpected."
    public const val MSG_TOO_LARGE: String = "Reply too large."
    public const val MSG_UNREACHABLE: String = "Can't reach the hub."

    /** Named placeholders for the parts of the hub contract not built yet (capability id to note). */
    public val PLACEHOLDERS: List<Pair<String, String>> = listOf(
        "axf.hub.axpp" to "The hub protocol contract (AXPP): typed calls, jobs and events between an AXF app and axHub. Parked for Fable; not designed here.",
        "axf.hub.push" to "Hub-pushed approvals and events instead of polling the feed.",
        "axf.hub.admin-api" to "The hub's admin API (services, jobs, audit, vault names, users, projects), hub step 4.",
    )

    private val APPROVAL_ID = Regex("^[0-9a-f-]{36}$")
    private val HOST = Regex("^[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*$")
    private val PORT = Regex("^[0-9]{1,5}$")
    private val RETURN_PATH = Regex("^/[A-Za-z0-9/_.-]*$")
    private val APK_PATH = Regex("^/apps/download/[a-z0-9][a-z0-9-]{0,63}/([A-Za-z0-9][A-Za-z0-9._-]{0,127}\\.apk)$")
    private val CSRF = Regex("name=\"csrf\" value=\"([^\"]+)\"")
    private val strict = Json { isLenient = false; ignoreUnknownKeys = true }

    /** Lowercases A–Z only (no locale or Unicode folding), like the web port. */
    private fun asciiLower(s: String): String = buildString(s.length) { for (c in s) append(if (c in 'A'..'Z') c + 32 else c) }

    /** Index where the authority of an `https://` URL ends (first `/`, `?`, `#` or `\`), or -1. */
    private fun authorityEnd(rest: String): Int {
        var end = -1
        for (c in charArrayOf('/', '?', '#', '\\')) { val i = rest.indexOf(c); if (i >= 0 && (end < 0 || i < end)) end = i }
        return end
    }

    /** The origin of an https URL (`https://host[:port]`, default port dropped, host lowercased), or null. */
    public fun origin(url: String?): String? {
        if (url == null || url.length < 8 || asciiLower(url.substring(0, 8)) != "https://") return null
        val rest = url.substring(8)
        val e = authorityEnd(rest)
        val authority = if (e < 0) rest else rest.substring(0, e)
        if (authority.isEmpty() || authority.contains('@')) return null
        val colon = authority.indexOf(':')
        val rawHost = if (colon >= 0) authority.substring(0, colon) else authority
        val portText = if (colon >= 0) authority.substring(colon + 1) else ""
        if (rawHost.isEmpty() || rawHost.length > 253 || !HOST.matches(rawHost)) return null
        val host = asciiLower(rawHost)
        var port = ""
        if (colon >= 0) {
            if (!PORT.matches(portText)) return null
            val n = portText.toInt()
            if (n < 1 || n > 65535) return null
            if (n != 443) port = ":$n"
        }
        return "https://$host$port"
    }

    /** A hub address as typed or configured → `https://host[:port]`, or null when it is anything more or less than that. */
    public fun normalize(raw: String?): String? {
        if (raw == null) return null
        val t = raw.trim { it.code <= 0x20 }.trimEnd('/')
        val o = origin(t) ?: return null
        val after = t.substring(8)
        return if (after.any { it == '/' || it == '?' || it == '#' || it == '\\' }) null else o
    }

    /** True when [url] points at exactly the hub's origin (https, same host, same port). */
    public fun isHub(base: String?, url: String?): Boolean {
        val b = normalize(base) ?: return false
        val o = origin(url) ?: return false
        return b == o
    }

    public fun approvalsUrl(base: String): String = "$base$PATH_APPROVALS"
    public fun appsUrl(base: String): String = "$base$PATH_APPS"
    public fun accountUrl(base: String): String = "$base$PATH_ACCOUNT"
    public fun logoutUrl(base: String): String = "$base$PATH_LOGOUT"
    public fun feedUrl(base: String): String = "$base$PATH_FEED"
    public fun isApprovalId(id: String?): Boolean = id != null && APPROVAL_ID.matches(id)
    /** The hub's single-request page; ids are checked so nothing else can be built into the link. */
    public fun approvalUrl(base: String, id: String?): String? = if (isApprovalId(id)) "${approvalsUrl(base)}/$id" else null
    /** The hub's sign-in page, returning to [returnPath] afterwards (a plain hub path; anything else → the approvals list). */
    public fun loginUrl(base: String, returnPath: String = PATH_APPROVALS): String {
        val rd = if (RETURN_PATH.matches(returnPath) && !returnPath.startsWith("//") && !returnPath.contains("..")) returnPath else PATH_APPROVALS
        return "$base$PATH_LOGIN?rd=${rd.replace("/", "%2F")}"
    }

    /** The file name of a hub app download (`/apps/download/<project>/<file>.apk` on the hub, no query or fragment), or null. */
    public fun apkDownloadName(base: String, url: String?): String? {
        if (url == null || !isHub(base, url)) return null
        val rest = url.substring(8)
        val end = authorityEnd(rest)
        if (end < 0 || rest[end] != '/') return null
        val path = rest.substring(end)
        if (path.any { it == '?' || it == '#' || it == '\\' }) return null
        return APK_PATH.matchEntire(path)?.groupValues?.get(1)
    }

    /** The CSRF token in one of the hub's own pages (its sign-out form), or null. */
    public fun csrfFromPage(html: String?): String? = html?.let { CSRF.find(it)?.groupValues?.get(1) }

    /** A feed reading with no items. */
    public fun feedOf(base: String, status: HubFeedStatus, error: String = ""): HubFeed = HubFeed(status, 0, emptyList(), approvalsUrl(base), error)
    /** A feed outcome for a transport failure (network error, refused redirect, oversized reply). */
    public fun unreachable(base: String, error: String = MSG_UNREACHABLE): HubFeed = feedOf(base, HubFeedStatus.UNREACHABLE, error)

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.isFalse(k: String): Boolean = (this[k] as? JsonPrimitive)?.let { !it.isString && it !is JsonNull && it.content == "false" } == true

    /**
     * What a reply from the feed means: 401 → signed out, 403 → not admin, 200 → the list (a body saying `signedIn: false` /
     * `admin: false` maps the same way), anything else → unreachable. Items need a real approval id and a `url` pointing at the
     * hub (the link is rebuilt from the id); duplicates are dropped and fields capped; `count` is never less than the items.
     */
    public fun interpretFeed(base: String, status: Int, body: String): HubFeed {
        if (status == 401) return feedOf(base, HubFeedStatus.SIGNED_OUT)
        if (status == 403) return feedOf(base, HubFeedStatus.NOT_ADMIN)
        if (status != 200) return feedOf(base, HubFeedStatus.UNREACHABLE, MSG_ANSWERED.replace("{status}", status.toString()))
        val el: JsonElement = try { strict.parseToJsonElement(body) } catch (e: Exception) { return feedOf(base, HubFeedStatus.UNREACHABLE, MSG_UNEXPECTED) }
        val j = el as? JsonObject ?: return feedOf(base, HubFeedStatus.UNREACHABLE, MSG_UNEXPECTED)
        if (j.isFalse("signedIn")) return feedOf(base, HubFeedStatus.SIGNED_OUT)
        if (j.isFalse("admin")) return feedOf(base, HubFeedStatus.NOT_ADMIN)
        val pending = ArrayList<HubApproval>()
        val ids = HashSet<String>()
        val list = j["pending"] as? JsonArray
        if (list != null) for (e in list) {
            if (pending.size >= FEED_MAX_ITEMS) break
            val p = e as? JsonObject ?: continue
            val id = p.str("id") ?: continue
            val url = approvalUrl(base, id) ?: continue
            if (id in ids) continue
            if (!isHub(base, p.str("url"))) continue
            ids += id
            pending += HubApproval(
                id = id,
                tool = (p.str("tool") ?: "call").take(CAP_TOOL),
                summary = (p.str("summary") ?: "").take(CAP_SUMMARY),
                createdAt = (p.str("createdAt") ?: "").take(CAP_TIME),
                expiresAt = (p.str("expiresAt") ?: "").take(CAP_TIME),
                url = url,
            )
        }
        val cp = j["count"] as? JsonPrimitive
        val n = if (cp != null && !cp.isString && cp !is JsonNull) cp.doubleOrNull else null
        val c = if (n != null && n.isFinite()) floor(n).coerceIn(0.0, 1_000_000.0).toInt() else pending.size
        return HubFeed(HubFeedStatus.OK, maxOf(c, pending.size), pending, approvalsUrl(base), "")
    }

    /** Which waiting ids are new, which seen ids are gone, and the seen list to keep (last [cap]). */
    public fun seenPlan(seen: List<String>, current: List<String>, cap: Int = SEEN_CAP): SeenPlan {
        val cur = current.distinct()
        val was = seen.distinct()
        val fresh = cur.filter { it !in was }
        val gone = was.filter { it !in cur }
        val keep = was.filter { it in cur } + fresh
        return SeenPlan(fresh, gone, if (cap > 0) keep.takeLast(cap) else emptyList())
    }
}
