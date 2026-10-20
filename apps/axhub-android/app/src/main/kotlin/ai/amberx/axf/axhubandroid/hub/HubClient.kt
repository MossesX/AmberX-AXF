package ai.amberx.axf.axhubandroid.hub

import android.webkit.CookieManager
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** One call waiting for approval, as the hub's feed lists it (decision #85 on the hub). */
data class PendingApproval(val id: String, val tool: String, val summary: String, val createdAt: String, val expiresAt: String)

/** What the hub said about this phone's session and its queue. */
sealed interface Feed {
    data class Ok(val count: Int, val pending: List<PendingApproval>) : Feed
    /** No session, or it expired: sign in again inside the app. */
    data object SignedOut : Feed
    /** Signed in, but not an admin (or a first-sign-in password change is due). */
    data object NotAdmin : Feed
    data class Error(val message: String) : Feed
}

/** Where the hub lives. Only https, a plain host and no path, so a typo can never send the session elsewhere. */
object HubAddress {
    const val DEFAULT = "https://axhub.amberxai.com"
    private val ID = Regex("^[0-9a-f-]{36}$")

    fun normalize(raw: String?): String? {
        val t = raw?.trim()?.trimEnd('/') ?: return null
        val u = runCatching { URL(t) }.getOrNull() ?: return null
        if (u.protocol != "https" || u.host.isNullOrBlank() || !u.userInfo.isNullOrEmpty() || (u.path ?: "").isNotEmpty() || u.query != null || u.ref != null) return null
        return "https://${u.host.lowercase()}${if (u.port != -1) ":${u.port}" else ""}"
    }

    fun approvals(base: String): String = "$base/auth/admin/approvals"
    /** The hub's single-request page; ids are checked so nothing else can be built into the link. */
    fun approval(base: String, id: String): String? = if (ID.matches(id)) "${approvals(base)}/$id" else null
    fun login(base: String): String = "$base/auth/login?rd=${java.net.URLEncoder.encode("/auth/admin/approvals", "UTF-8")}"
    fun isHub(base: String, url: String?): Boolean {
        val u = runCatching { URL(url) }.getOrNull() ?: return false
        val b = URL(base)
        return u.protocol == "https" && u.host.equals(b.host, true) && u.port == b.port
    }
}

/**
 * Reads `GET /auth/admin/approvals.json` with this phone's own hub session (the cookie the in-app sign-in
 * left in the WebView cookie store). Read-only: the app never approves through the API; approving happens
 * on the hub's own page, inside the app's web view.
 */
object HubClient {
    suspend fun feed(base: String): Feed = withContext(Dispatchers.IO) {
        val cookie = runCatching { CookieManager.getInstance().getCookie(base) }.getOrNull()
        if (cookie.isNullOrBlank()) return@withContext Feed.SignedOut
        val conn = (URL("$base/auth/admin/approvals.json").openConnection() as HttpURLConnection)
        try {
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 10_000; conn.readTimeout = 10_000
            conn.setRequestProperty("Cookie", cookie)
            conn.setRequestProperty("Accept", "application/json")
            conn.useCaches = false
            when (val code = conn.responseCode) {
                200 -> parse(conn.inputStream.use { readLimited(it) })
                401 -> Feed.SignedOut
                403 -> Feed.NotAdmin
                else -> Feed.Error("The hub answered $code.")
            }
        } catch (e: Exception) {
            Feed.Error(e.message?.take(120) ?: "Can't reach the hub.")
        } finally { conn.disconnect() }
    }

    internal fun parse(text: String): Feed = try {
        val o = Json.parseToJsonElement(text).jsonObject
        when {
            o.bool("signedIn") == false -> Feed.SignedOut
            o.bool("admin") == false -> Feed.NotAdmin
            else -> {
                val list = o["pending"]?.jsonArray.orEmpty().mapNotNull { e ->
                    val p = e as? JsonObject ?: return@mapNotNull null
                    val id = p.str("id") ?: return@mapNotNull null
                    PendingApproval(id, p.str("tool") ?: "call", p.str("summary").orEmpty().take(600), p.str("createdAt").orEmpty(), p.str("expiresAt").orEmpty())
                }
                Feed.Ok(o["count"]?.jsonPrimitive?.intOrNull ?: list.size, list)
            }
        }
    } catch (e: Exception) { Feed.Error("The hub sent something unexpected.") }

    private fun JsonObject.str(k: String): String? = (this[k] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.bool(k: String): Boolean? = (this[k] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull
    private fun readLimited(input: java.io.InputStream): String {
        val out = java.io.ByteArrayOutputStream(); val buf = ByteArray(8192)
        while (true) { val n = input.read(buf); if (n < 0) break; if (out.size() + n > MAX) throw java.io.IOException("Reply too large."); out.write(buf, 0, n) }
        return out.toString("UTF-8")
    }
    private const val MAX = 256 * 1024
}
