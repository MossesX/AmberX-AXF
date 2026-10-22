package ai.amberx.axf.hub

/**
 * How a developer app proves who it is to axHub's data API. The library never stores a credential: the app hands
 * one over each time it is asked (the AXHub phone app reads its hub session cookie from the WebView cookie store it
 * signed in with; the Android console does the same after an in-app sign-in; a machine would use the hub's bearer
 * token kept in the platform SecureStore). `null` = not signed in: the source reports Unauthorized.
 */
public fun interface HubCredentials {
    public fun current(): HubCredential?
}

public sealed interface HubCredential {
    /** `Cookie: …` header value (the hub's `axhub_session` cookie). */
    public data class SessionCookie(val cookie: String) : HubCredential
    /** `Authorization: Bearer …` (the hub's MCP/data token; machines and admin-only tools). */
    public data class Bearer(val token: String) : HubCredential
}

/** The hub's address: https only, a plain host, no path/query/credentials (a typo can never send a session elsewhere). */
public object HubOrigin {
    public const val DEFAULT: String = "https://axhub.amberxai.com"
    public fun normalize(raw: String?): String? {
        val t = raw?.trim()?.trimEnd('/') ?: return null
        val u = runCatching { java.net.URI(t) }.getOrNull() ?: return null
        val local = u.host == "localhost" || u.host == "127.0.0.1" || u.host == "10.0.2.2"
        if (!(u.scheme == "https" || (u.scheme == "http" && local)) || u.host.isNullOrBlank() || u.userInfo != null || !u.rawPath.isNullOrEmpty() || u.rawQuery != null || u.fragment != null) return null
        val port = if (u.port == -1) "" else ":${u.port}"
        return "${u.scheme}://${u.host.lowercase()}$port"
    }
}
