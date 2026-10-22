package ai.amberx.axf.hub

import android.webkit.CookieManager
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Where this app's hub session lives. The default is the WebView cookie store: the user signs in once on the hub's own
 * page inside a [LockedWebView], and the cookie it leaves is what [HubClient] sends. Apps must keep that store out of
 * backups (`<exclude domain="root" path="app_webview/" />` in both backup rule files) and turn WebView debugging off.
 */
public interface HubSession {
    /** The Cookie header for [base], or null when there is no session. Only ever sent to the hub's own address. */
    public fun cookie(base: String): String?
    /** Drops the session on this device (all of the store), then calls [done]. */
    public fun clear(done: () -> Unit = {})

    public companion object {
        /**
         * A session from the app's [HubCredentials] seam. The approvals feed and sign-out only accept the hub's session cookie
         * (axHub decision #85: a bearer token never works there), so a [HubCredential.Bearer] counts as signed out here.
         * [clear] drops the WebView cookie store.
         */
        public fun of(credentials: HubCredentials): HubSession = object : HubSession {
            override fun cookie(base: String): String? = (credentials.current() as? HubCredential.SessionCookie)?.cookie?.takeIf { it.isNotBlank() }
            override fun clear(done: () -> Unit) = WebViewHubSession.clear(done)
        }
    }
}

/** The WebView cookie store as the hub session (what [HubSignInView] / a [LockedWebView] sign-in fill; read like [cookieCredentials]). */
public object WebViewHubSession : HubSession {
    override fun cookie(base: String): String? = (cookieCredentials { base }.current() as? HubCredential.SessionCookie)?.cookie
    override fun clear(done: () -> Unit) {
        runCatching { CookieManager.getInstance().removeAllCookies { CookieManager.getInstance().flush(); done() } }.onFailure { done() }
    }
}

/**
 * Reads the approvals feed (`GET /auth/admin/approvals.json`, axHub decision #85) with this device's own hub session and
 * ends that session on the hub. Read-only: the app never approves through an API; approving happens on the hub's own page
 * (inside a [LockedWebView]), so the hub's Origin + CSRF checks apply. Redirects are never followed and replies are capped
 * at [HubRules.FEED_MAX_BYTES]. Same mapping as the web port (`fetchHubFeed`), pinned by `hub-approvals.json`.
 */
public class HubClient(private val session: HubSession = WebViewHubSession, private val timeoutMs: Int = 10_000) {

    public suspend fun feed(base: String): HubFeed = withContext(Dispatchers.IO) {
        val hub = HubRules.normalize(base) ?: return@withContext HubRules.unreachable(HubRules.DEFAULT)
        val cookie = session.cookie(hub) ?: return@withContext HubRules.feedOf(hub, HubFeedStatus.SIGNED_OUT)
        val conn = URL(HubRules.feedUrl(hub)).openConnection() as HttpURLConnection
        try {
            conn.instanceFollowRedirects = false
            conn.connectTimeout = timeoutMs; conn.readTimeout = timeoutMs
            conn.useCaches = false
            conn.setRequestProperty("Cookie", cookie)
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            if (code != 200) HubRules.interpretFeed(hub, code, "")
            else HubRules.interpretFeed(hub, 200, conn.inputStream.use { readLimited(it, HubRules.FEED_MAX_BYTES) })
        } catch (e: Exception) {
            HubRules.unreachable(hub, e.message?.take(120) ?: HubRules.MSG_UNREACHABLE)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Ends this device's session on the hub (not just here): reads the CSRF token from the account page and posts the hub's
     * own sign-out form with the hub as Origin. Best effort; callers clear the local session ([HubSession.clear]) either way.
     */
    public suspend fun signOut(base: String): Boolean = withContext(Dispatchers.IO) {
        val hub = HubRules.normalize(base) ?: return@withContext false
        val cookie = session.cookie(hub) ?: return@withContext false
        runCatching {
            val page = (URL(HubRules.accountUrl(hub)).openConnection() as HttpURLConnection).run {
                instanceFollowRedirects = false; connectTimeout = timeoutMs; readTimeout = timeoutMs; useCaches = false
                setRequestProperty("Cookie", cookie)
                try { if (responseCode == 200) inputStream.use { readLimited(it, HubRules.FEED_MAX_BYTES) } else "" } finally { disconnect() }
            }
            val csrf = HubRules.csrfFromPage(page) ?: return@runCatching false
            (URL(HubRules.logoutUrl(hub)).openConnection() as HttpURLConnection).run {
                instanceFollowRedirects = false; connectTimeout = timeoutMs; readTimeout = timeoutMs; useCaches = false
                requestMethod = "POST"; doOutput = true
                setRequestProperty("Cookie", cookie); setRequestProperty("Origin", hub)
                setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                outputStream.use { it.write("csrf=${URLEncoder.encode(csrf, "UTF-8")}".toByteArray()) }
                try { responseCode in 200..399 } finally { disconnect() }
            }
        }.getOrDefault(false)
    }

    public companion object {
        /** The shared client on the WebView session. */
        public val Default: HubClient by lazy { HubClient() }

        /** Reads [input] as UTF-8, refusing anything over [max] bytes. */
        public fun readLimited(input: InputStream, max: Int): String {
            val out = ByteArrayOutputStream()
            val buf = ByteArray(8192)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                if (out.size() + n > max) throw IOException(HubRules.MSG_TOO_LARGE)
                out.write(buf, 0, n)
            }
            return out.toString("UTF-8")
        }
    }
}
