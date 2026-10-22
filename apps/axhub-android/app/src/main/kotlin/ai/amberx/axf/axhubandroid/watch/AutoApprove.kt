package ai.amberx.axf.axhubandroid.watch

import android.content.Context
import ai.amberx.axf.hub.HubClient
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.HubSession
import ai.amberx.axf.hub.WebViewHubSession
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Auto-approval (off by default): when it's on, an approval whose tool matches one of the user's patterns is approved by
 * this phone as soon as the watcher sees it, and the alert says "Auto-approval approved" instead of asking.
 *
 * Patterns are separated by commas, spaces or new lines: an exact tool (`vps.logs`), a whole service (`github.*`), or
 * `*` for every tool. An empty list approves nothing. Approving posts the hub's own approval form with this phone's hub
 * session, the hub as Origin and the page's CSRF token (like [HubClient.signOut]), so the hub records the decision as
 * the signed-in admin and its single-use, bound-to-the-call rules still apply.
 */
object AutoApprove {
    fun patterns(raw: String?): List<String> =
        raw.orEmpty().split(',', ' ', '\n', '\t', ';').map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(50)

    /** True when [tool] (`service.tool`) matches any pattern. */
    fun matches(patterns: List<String>, tool: String): Boolean = patterns.any { p ->
        when {
            p == "*" -> true
            p.endsWith(".*") -> tool.startsWith(p.dropLast(1)) && tool.length > p.length - 1
            else -> p == tool
        }
    }

    fun applies(on: Boolean, raw: String?, tool: String): Boolean = on && matches(patterns(raw), tool)

    /**
     * Approves [id] on the hub. True only when the hub answered with its "approved" confirmation; anything else (expired,
     * decided already, signed out, unreachable) is false and the caller falls back to the normal alert.
     */
    suspend fun approve(base: String, id: String, session: HubSession = WebViewHubSession, timeoutMs: Int = 10_000): Boolean = withContext(Dispatchers.IO) {
        val hub = HubRules.normalize(base) ?: return@withContext false
        val url = HubRules.approvalUrl(hub, id) ?: return@withContext false
        val cookie = session.cookie(hub) ?: return@withContext false
        runCatching {
            val page = (URL(url).openConnection() as HttpURLConnection).run {
                instanceFollowRedirects = false; connectTimeout = timeoutMs; readTimeout = timeoutMs; useCaches = false
                setRequestProperty("Cookie", cookie)
                try { if (responseCode == 200) inputStream.use { HubClient.readLimited(it, HubRules.FEED_MAX_BYTES) } else "" } finally { disconnect() }
            }
            val csrf = HubRules.csrfFromPage(page) ?: return@runCatching false
            (URL(url).openConnection() as HttpURLConnection).run {
                instanceFollowRedirects = false; connectTimeout = timeoutMs; readTimeout = timeoutMs; useCaches = false
                requestMethod = "POST"; doOutput = true
                setRequestProperty("Cookie", cookie); setRequestProperty("Origin", hub)
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                outputStream.use { it.write("csrf=${URLEncoder.encode(csrf, "UTF-8")}&decision=approved".toByteArray()) }
                try { approvedReply(responseCode, getHeaderField("Location")) } finally { disconnect() }
            }
        }.getOrDefault(false)
    }

    /** The hub answers a successful decision with 303 back to the approval page and `ok=approved`. */
    fun approvedReply(code: Int, location: String?): Boolean = code == 303 && location != null && "ok=approved" in location && "err=" !in location
}

/** Auto-approval settings, kept beside the watcher's own (the work service reads them without the kernel). */
class AutoApprovePrefs(context: Context) {
    private val p = context.applicationContext.getSharedPreferences("axhub_watch", Context.MODE_PRIVATE)
    var on: Boolean
        get() = p.getBoolean(K_ON, false)
        set(v) { p.edit().putBoolean(K_ON, v).apply() }
    var tools: String
        get() = p.getString(K_TOOLS, "") ?: ""
        set(v) { p.edit().putString(K_TOOLS, v.take(2000)).apply() }

    fun applies(tool: String): Boolean = AutoApprove.applies(on, tools, tool)

    companion object {
        const val K_ON = "autoApprove"
        const val K_TOOLS = "autoApproveTools"
    }
}
