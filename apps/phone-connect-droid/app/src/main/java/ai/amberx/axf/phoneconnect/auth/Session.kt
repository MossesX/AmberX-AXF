package ai.amberx.axf.phoneconnect.auth

import android.content.Context
import android.os.Build
import android.webkit.CookieManager
import org.json.JSONObject
import java.security.SecureRandom

/**
 * The phone's hub session and pairing. The session is the hub's own cookie in the WebView store (the sign-in page
 * leaves it there; it reaches console.amberxai.com through the hub's sign-in wall). Kept fresh by reading
 * /auth/api/session (the hub rolls the cookie); signed out → every loop waits a minute and the setup page says so.
 * Prefs hold only the device id and pairing state, never the cookie.
 */
class Session private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences("phone-connect.session", Context.MODE_PRIVATE)

    val deviceId: String = prefs.getString("deviceId", null) ?: newId().also { prefs.edit().putString("deviceId", it).apply() }

    fun cookie(origin: String = HubRules.HUB): String? = CookieManager.getInstance().getCookie(origin)?.takeIf { it.isNotBlank() }
    fun isSignedIn(): Boolean = prefs.getBoolean("signedIn", false) && cookie() != null
    fun signedIn() { CookieManager.getInstance().flush(); prefs.edit().putBoolean("signedIn", true).apply() }
    fun isPaired(): Boolean = prefs.getString("pairedAt", null) != null
    fun deviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim().take(80)

    /** Reads the hub session; true while it is signed in. Refreshes the cookie the hub rolls. */
    fun refresh(): Boolean {
        val r = runCatching { HubRules.request("GET", HubRules.HUB + HubRules.SESSION_PATH, cookie()) }.getOrNull() ?: return isSignedIn()
        val ok = r.status == 200 && r.body.contains("\"signedIn\":true")
        if (!ok && (r.status == 200 || r.status == 401 || r.status == 403)) prefs.edit().putBoolean("signedIn", false).apply()
        CookieManager.getInstance().flush()
        return ok
    }

    fun csrf(): String? = runCatching { HubRules.request("GET", HubRules.HUB + HubRules.SESSION_PATH, cookie()) }.getOrNull()?.takeIf { it.status == 200 }?.let { HubRules.csrfFromSession(it.body) }

    /** The hello the phone sends with a pairing code or a heartbeat (phone-device@1 fields). */
    fun hello(code: String? = null, state: JSONObject = JSONObject()): JSONObject = JSONObject()
        .put("deviceId", deviceId).put("name", deviceName()).put("app", "phone-connect-droid")
        .put("appVersion", runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "")
        .put("capabilities", org.json.JSONArray(CAPABILITIES)).put("state", state)
        .apply { if (code != null) put("code", code) }

    /**
     * Claims the console's pairing code with Brett's own hub session (the console's pair/claim is personOnly).
     * Answers "" when paired, else the console's message.
     */
    fun claim(code: String): String {
        val clean = code.trim().uppercase()
        if (!Regex("^[A-HJ-NP-Z2-9]{8}$").matches(clean)) return "The code is 8 letters and digits, as the console shows it."
        val r = runCatching { ConsoleClient(this).post("pair/claim", hello(clean)) }.getOrElse { return "Couldn't reach the console: ${it.message}" }
        if (r.status in 200..299) { prefs.edit().putString("pairedAt", System.currentTimeMillis().toString()).apply(); return "" }
        return runCatching { JSONObject(r.body).getJSONObject("error").getString("message") }.getOrDefault("The console answered ${r.status}.")
    }

    /** The console revoked this phone (or it was forgotten): back to the setup page. */
    fun unpaired() { prefs.edit().remove("pairedAt").apply() }

    /** Sign out: the hub cookies go, pairing state goes, the loops stop on their next round. */
    fun signOut(context: Context) {
        CookieManager.getInstance().removeAllCookies(null); CookieManager.getInstance().flush()
        prefs.edit().putBoolean("signedIn", false).remove("pairedAt").apply()
        context.stopService(android.content.Intent(context, ai.amberx.axf.phoneconnect.overlay.OverlayService::class.java))
        context.stopService(android.content.Intent(context, ai.amberx.axf.phoneconnect.monitor.WatchService::class.java))
    }

    companion object {
        val CAPABILITIES = listOf("open-url@1", "notify@1", "approvals@1", "recorder@1")
        private fun newId(): String = "phone-" + ByteArray(8).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        @Volatile private var instance: Session? = null
        fun of(context: Context): Session = instance ?: synchronized(this) { instance ?: Session(context.applicationContext).also { instance = it } }
    }
}
