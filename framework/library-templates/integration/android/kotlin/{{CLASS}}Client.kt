package {{PACKAGE}}

import ai.amberx.axf.network.AxfHttp

/** Talks to the remote service. Keep tokens in the settings SECRET field (secure store), never in code. */
public class {{CLASS}}Client(private val http: AxfHttp?, public var baseUrl: String = "{{P_BASE_URL}}") {
    /** Returns the HTTP status of the base URL, or null when the network module is missing / the call fails. */
    public suspend fun ping(): Int? = http?.get(baseUrl)?.getOrNull()?.code
}
