package ai.amberx.axf.phoneconnect.link

/**
 * phone-connect@1 rules the app keeps (pure Kotlin, no Android imports; mirrors framework/core/phone-connect.mjs HUB,
 * PATTERNS, LINK, the url rule and `linkVerdict`). The full Kotlin twin of the engine is a deferred gap
 * (framework/spec/PORTING.md); LinkRulesTest holds these to the same cases as the engine's fixture.
 */
object LinkRules {
    const val PROTOCOL = "axpp@1"
    const val HEADER = "X-AXPP"
    const val BASE_PATH = "/api/plugins/phone-connect"
    const val DEFAULT_ORIGIN = "https://console.amberxai.com"
    const val DEFAULT_HUB = "https://axhub.amberxai.com"
    const val POLL_WAIT_S = 25
    const val REPLY_MAX_BYTES = 262_144
    val BACKOFF_S = listOf(5, 15, 30, 60)
    const val CHROME = "com.android.chrome"
    /** LINK.rejectedCodes / rejectedStatuses / rejectLimit: what ends the retry loop (a rejected token is never retried). */
    val REJECTED_CODES = setOf("denied", "revoked", "unpaired")
    val REJECTED_STATUSES = setOf(401, 403)
    const val REJECT_LIMIT = 3
    const val RESTARTED = 404
    val DECISIONS = listOf("approve", "deny", "shelve")
    val CAPABILITIES = listOf("open-url@1", "notify@1", "approvals@1", "recorder@1", "voice@1")
    private val CODE = Regex("^[A-HJ-NP-Z2-9]{8}$")
    private val TOKEN = Regex("^tok_[A-Za-z0-9_-]{32}$")
    private val DEVICE = Regex("^[A-Za-z0-9_-]{8,64}$")
    private val UUID = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    /** What Brett types: spaces and dashes dropped, upper case; null unless it is a pairing code. */
    fun normalizeCode(raw: String): String? = raw.uppercase().filter { it.isLetterOrDigit() }.takeIf { CODE.matches(it) }
    fun isToken(t: String?): Boolean = t != null && TOKEN.matches(t)
    fun isDeviceId(id: String?): Boolean = id != null && DEVICE.matches(id)
    fun isUuid(id: String?): Boolean = id != null && UUID.matches(id)

    /** The console origin: https only, no path, no user info; null otherwise. */
    fun normalizeOrigin(raw: String): String? {
        val s = raw.trim().trimEnd('/')
        if (!s.startsWith("https://")) return null
        val host = s.removePrefix("https://")
        if (host.isEmpty() || host.contains('/') || host.contains('@') || host.contains('?') || host.contains('#')) return null
        return s
    }

    /** A page the phone opens: https only, no user info, ≤ 2000 characters (the console already applied the url policy). */
    fun openable(url: String?): Boolean {
        if (url == null || url.length > 2000 || !url.startsWith("https://")) return false
        val rest = url.removePrefix("https://")
        val authority = rest.substringBefore('/').substringBefore('?').substringBefore('#')
        return authority.isNotEmpty() && !authority.contains('@')
    }

    /**
     * browser.open's `where`: anything but "browser" asks for the overlay, so the console app (ConsoleOverlay) gets the
     * page first; "browser" always opens in the phone's browser.
     */
    fun wantsOverlay(where: String?): Boolean = where != "browser"

    /** browser.open's `browser`: "chrome" asks for Chrome (the default browser when Chrome is not installed). */
    fun wantsChrome(browser: String?): Boolean = browser == "chrome"

    /** What the watch does after one `hello` / `next` reply (engine `linkVerdict`). */
    enum class Verdict { OK, HELLO, RETRY, REJECTED }

    /**
     * [status] is the HTTP status (0 = no answer), [code] the wire error code ("" when the answer carried none: a proxy
     * or the sign-in wall answered, not the plugin), [uncoded] the bare 401 / 403 answers in a row before this one.
     * REJECTED = this token is dead: stop the loop, drop it, show "Disconnected: tap to re-pair". Never retried.
     */
    fun verdict(status: Int, code: String, uncoded: Int = 0): Verdict = when {
        status in 200..299 -> Verdict.OK
        code in REJECTED_CODES -> Verdict.REJECTED
        code.isEmpty() && status in REJECTED_STATUSES -> if (uncoded + 1 >= REJECT_LIMIT) Verdict.REJECTED else Verdict.RETRY
        status == RESTARTED -> Verdict.HELLO
        else -> Verdict.RETRY
    }

    /** Why the link ended, in words for the pairing screen and the notification. */
    fun rejectedWhy(code: String): String = when (code) {
        "revoked" -> "This phone was revoked in the console."
        "unpaired" -> "The console no longer has this phone paired."
        else -> "The console no longer accepts this phone's key."
    }

    /** The next wait after [failures] failed calls in a row. */
    fun backoffSeconds(failures: Int): Int = BACKOFF_S[(failures - 1).coerceIn(0, BACKOFF_S.size - 1)]

    /** The approval page on the hub, rebuilt from the id (a link in a reply is never followed as given). */
    /** The approval in the console (its `hub.review` deep link), rebuilt from the id: what a tap on the prompt opens. */
    fun consoleApproval(origin: String, approvalId: String): String? = if (isUuid(approvalId)) "${origin.trimEnd('/')}/?axf-open=hub.review:$approvalId" else null

    /** The console's own pairing page, where the code is shown. */
    fun pairPage(origin: String): String = "${origin.trimEnd('/')}/?axf-open=view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect"

    /**
     * What the prompt says after a tap. [relayed] is the console's answer to the tap: true = the hub took the decision,
     * false = it did not ([message] says why), null = the console never answered or the prompt had already ended.
     */
    fun decisionOutcome(decision: String, relayed: Boolean?, message: String = ""): String = when (relayed) {
        true -> when (decision) { "approve" -> "Approved."; "deny" -> "Denied."; "shelve" -> "Shelved: the countdown is paused."; else -> "Done." }
        false -> message.ifBlank { "Nothing was decided." } + " Tap to open it in the console."
        null -> message.ifBlank { "This prompt is no longer open." } + " Nothing was decided. Tap to open it in the console."
    }

    fun approvalPage(hub: String, approvalId: String): String? = if (isUuid(approvalId)) "${hub.trimEnd('/')}/auth/admin/approvals/$approvalId" else null
}
