package ai.amberx.axf.ai

import ai.amberx.axf.hub.HubCredential
import ai.amberx.axf.hub.HubCredentials
import ai.amberx.axf.hub.HubOrigin
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

/** One call to the assistant behind axHub. [path] includes the query; [body] is JSON. */
public data class AiHubRequest(val method: String, val path: String, val body: String? = null, val accept: String = "application/json")

/** [body] is empty for a stream that was read line by line, or for a call made with `headersOnly`. */
public data class AiHubResponse(val code: Int, val body: String = "")

/**
 * How lib-ai reaches the assistant through axHub. The default ([OkHttpAiHubTransport]) uses lib-hub's credentials seam
 * and address rules; tests use a fake. Network failures throw [IOException]; HTTP errors come back as codes.
 */
public interface AiHubTransport {
    /** The assistant's origin (https, host only), for messages. */
    public val origin: String
    /**
     * A request/response call. With [headersOnly] the call returns as soon as the status is known and drops the body
     * (used to send a turn: the reply runs detached on the hub, so leaving its SSE response never stops it).
     */
    public suspend fun call(request: AiHubRequest, headersOnly: Boolean = false): AiHubResponse
    /** A long-lived stream: [onLine] gets every line (no newline) until the hub ends it; cancelling the caller closes it. */
    public suspend fun stream(request: AiHubRequest, onLine: suspend (String) -> Unit): AiHubResponse
}

/**
 * The real transport: OkHttp (the app's shared client when axf-network is installed), redirects never followed (a
 * credential never leaves the assistant's origin; the wall's redirect to the sign-in page reads as "signed out"),
 * JSON replies capped at [AiWire.MAX_JSON_BYTES], the hub credential from lib-hub's [HubCredentials] seam: the hub's
 * session cookie (`axhub_session`, what the wall checks) or a bearer token. Cookie-authenticated writes carry the
 * assistant's own Origin, as the wall's same-origin rule for browser sessions expects. Nothing is stored here.
 */
public class OkHttpAiHubTransport(
    assistant: String,
    private val credentials: HubCredentials,
    client: OkHttpClient? = null,
) : AiHubTransport {
    override val origin: String = HubOrigin.normalize(assistant) ?: throw IllegalArgumentException("lib-ai: the assistant address must be https, host only")
    private val http: OkHttpClient = (client ?: OkHttpClient()).newBuilder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).build()
    private val longPoll: OkHttpClient = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()

    private fun build(r: AiHubRequest): Request {
        val b = Request.Builder().url(origin + r.path).header("Accept", r.accept).header("Cache-Control", "no-store")
        when (val c = credentials.current()) {
            is HubCredential.SessionCookie -> { b.header("Cookie", c.cookie); if (r.method != "GET") b.header("Origin", origin) }
            is HubCredential.Bearer -> b.header("Authorization", "Bearer ${c.token}")
            null -> {}
        }
        val body = if (r.method == "GET") null else (r.body ?: "{}").toRequestBody(JSON)
        return b.method(r.method, body).build()
    }

    private fun Response.readCapped(): String {
        val src = body?.source() ?: return ""
        if (!src.request(AiWire.MAX_JSON_BYTES.toLong() + 1)) return src.buffer.readUtf8()
        throw IOException("Reply too large.")
    }

    override suspend fun call(request: AiHubRequest, headersOnly: Boolean): AiHubResponse = withContext(Dispatchers.IO) {
        http.newCall(build(request)).execute().use { res ->
            if (headersOnly && res.isSuccessful) AiHubResponse(res.code) else AiHubResponse(res.code, res.readCapped())
        }
    }

    override suspend fun stream(request: AiHubRequest, onLine: suspend (String) -> Unit): AiHubResponse = withContext(Dispatchers.IO) {
        val call = longPoll.newCall(build(request))
        val off = currentCoroutineContext()[Job]?.invokeOnCompletion { call.cancel() }
        try {
            call.execute().use { res ->
                if (!res.isSuccessful) return@use AiHubResponse(res.code, res.readCapped())
                val src = res.body?.source() ?: return@use AiHubResponse(res.code)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val line = src.readUtf8Line() ?: break
                    onLine(line)
                }
                AiHubResponse(res.code)
            }
        } finally {
            off?.dispose()
        }
    }

    private companion object { val JSON = "application/json".toMediaType() }
}
