package ai.amberx.axf.phoneconnect.auth

import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.Locale

/**
 * Hub sign-in and session security, carried over from AmberX (HubRules.java / AxppLink.java, phone-connect@1 HUB):
 * - one hub, https://axhub.amberxai.com, and one console, https://console.amberxai.com: every call is held to exactly
 *   those origins, https only; nothing is sent anywhere else;
 * - the phone's own signed-in hub session cookie, never a token; redirects never followed; replies capped at 256 KB;
 * - an approval id is a uuid and every address is rebuilt from it (a link in a reply is never used);
 * - changes carry the session's CSRF value and the hub as Origin.
 */
object HubRules {
    const val HUB = "https://axhub.amberxai.com"
    const val CONSOLE = "https://console.amberxai.com"
    const val SESSION_PATH = "/auth/api/session"
    const val FEED_PATH = "/auth/admin/approvals.json"
    const val API_APPROVALS_PATH = "/auth/api/approvals"
    const val REPLY_MAX_BYTES = 256 * 1024
    const val AUTH_RETRY_MS = 60_000L
    val BACKOFF_MS = longArrayOf(5_000, 15_000, 30_000, 60_000)
    private val APPROVAL_ID = Regex("^[0-9a-f-]{36}$")
    private val CSRF = Regex("\"csrf\"\\s*:\\s*\"([A-Za-z0-9_\\-]{8,200})\"")
    val VETO_ACTIONS = listOf("deny", "approve-now", "shelve")

    /** https://host[:port] or null. */
    fun normalize(raw: String?): String? = runCatching {
        val u = URI(raw!!.trim())
        if (u.scheme != "https" || u.host == null || u.userInfo != null) null
        else "https://" + u.host.lowercase(Locale.ROOT) + (if (u.port > 0 && u.port != 443) ":${u.port}" else "")
    }.getOrNull()

    fun isOrigin(origin: String, url: String?): Boolean { val o = normalize(origin); return o != null && o == normalize(url) }
    fun isHub(url: String?) = isOrigin(HUB, url)
    fun isConsole(url: String?) = isOrigin(CONSOLE, url)

    fun isApprovalId(id: String?) = id != null && APPROVAL_ID.matches(id)
    fun approvalApiUrl(id: String?): String? = if (isApprovalId(id)) "$HUB$API_APPROVALS_PATH/$id" else null
    fun vetoActionUrl(id: String?, action: String): String? = if (isApprovalId(id) && action in VETO_ACTIONS) "$HUB$API_APPROVALS_PATH/$id/$action" else null

    fun csrfFromSession(json: String?): String? = if (json == null || !json.contains("\"signedIn\":true")) null else CSRF.find(json)?.groupValues?.get(1)

    fun backoff(failures: Int): Long = BACKOFF_MS[(failures - 1).coerceIn(0, BACKOFF_MS.size - 1)]

    /** After a reply: signed-out (401/403 → wait AUTH_RETRY_MS), ok, or retry with backoff. */
    fun afterStatus(status: Int, failures: Int): Pair<String, Long> = when {
        status == 401 || status == 403 -> "signed-out" to AUTH_RETRY_MS
        status in 200..299 -> "ok" to 0L
        else -> "retry" to backoff(failures + 1)
    }

    fun approvedReply(code: Int, body: String?) = code == 200 && body != null && body.contains("\"ok\":true") && body.contains("\"result\":\"approved\"")
    fun declinedReply(code: Int, body: String?) = code == 200 && body != null && body.contains("\"ok\":true")

    data class Reply(val status: Int, val body: String)

    /** One request to the hub or the console with the session cookie; refuses any other origin before sending. */
    fun request(method: String, url: String, cookie: String?, body: String? = null, csrf: String? = null): Reply {
        require(isHub(url) || isConsole(url)) { "not the hub or the console" }
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.instanceFollowRedirects = false
            c.connectTimeout = 10_000; c.readTimeout = 30_000; c.useCaches = false
            c.requestMethod = method
            c.setRequestProperty("Accept", "application/json")
            c.setRequestProperty("Accept-Encoding", "identity")
            c.setRequestProperty("X-Axf-Via", "phone")
            if (cookie != null) c.setRequestProperty("Cookie", cookie)
            if (csrf != null) { c.setRequestProperty("X-AxHub-CSRF", csrf); c.setRequestProperty("Origin", HUB) }
            if (body != null) {
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream: InputStream? = if (code >= 400) c.errorStream else c.inputStream
            return Reply(code, stream?.let { readLimited(it, REPLY_MAX_BYTES) } ?: "")
        } finally { c.disconnect() }
    }

    fun readLimited(input: InputStream, max: Int): String = input.use { s ->
        val buf = ByteArray(8192); val out = java.io.ByteArrayOutputStream(); var total = 0
        while (true) { val n = s.read(buf); if (n < 0) break; total += n; if (total > max) break; out.write(buf, 0, n) }
        out.toString("UTF-8")
    }
}
