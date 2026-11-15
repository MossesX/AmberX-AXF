package ai.amberx.axf.phoneconnect.commands

import java.net.URI
import java.util.Locale

/**
 * Which pages the phone opens (phone.open_url, capability open-url@1), ported from AmberX: https only, host
 * amberxai.com or a subdomain, no user info, the default port, at most 2000 characters. Checked here even though the
 * console and axHub checked it first. Pure, unit tested.
 */
object OpenUrlRules {
    val DOMAINS = listOf("amberxai.com")
    const val CHROME = "com.android.chrome"
    const val MAX_URL = 2000

    /** The URL if the phone may open it, else an IllegalArgumentException with the reason. */
    fun allowed(raw: String?): String {
        val s = raw?.trim().orEmpty()
        require(s.isNotEmpty()) { "url is required." }
        require(s.length <= MAX_URL) { "url is too long." }
        val u = runCatching { URI(s) }.getOrElse { throw IllegalArgumentException("url isn't a valid address.") }
        require(u.scheme.equals("https", ignoreCase = true)) { "Only https pages can be opened." }
        require(u.rawUserInfo == null) { "url can't carry a user name or password." }
        require(u.port == -1 || u.port == 443) { "url can't name a port." }
        val host = u.host?.lowercase(Locale.ROOT).orEmpty()
        require(ownDomain(host)) { "The phone only opens Brett's own sites (${DOMAINS.joinToString()}), not \"$host\"." }
        return u.toString()
    }

    fun ownDomain(host: String): Boolean = host.isNotEmpty() && !host.endsWith(".") && DOMAINS.any { host == it || host.endsWith(".$it") }

    /** chrome (default: Chrome when installed, else the default browser) or default. */
    fun browserOf(raw: String?): String = if (raw == "default") "default" else "chrome"
}
