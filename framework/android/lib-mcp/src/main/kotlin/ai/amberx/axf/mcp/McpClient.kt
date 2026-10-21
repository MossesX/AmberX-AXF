package ai.amberx.axf.mcp

import ai.amberx.axf.kernel.interop.WireCodes
import ai.amberx.axf.kernel.interop.WireError
import ai.amberx.axf.kernel.mcp.Mcp
import ai.amberx.axf.kernel.mcp.McpEngine
import ai.amberx.axf.kernel.mcp.McpException
import ai.amberx.axf.kernel.mcp.McpMessage
import ai.amberx.axf.kernel.mcp.McpResponseKind
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException

/* ---------- transport (the host app implements or configures this) ---------- */

/** Where a server's credentials come from. Only the transport sees it; UI code never does. */
public fun interface McpCredentialProvider { public suspend fun authorization(serverId: String): String? }

public data class McpTransportResponse(val status: Int, val headers: Map<String, String>, val body: suspend () -> String, val lines: suspend ((String) -> Boolean) -> Unit, val statusText: String = "")

/** One HTTP request; `headers` are the protocol headers, the transport adds credentials. */
public interface McpTransport { public suspend fun request(serverId: String, url: String, method: String, headers: Map<String, String>, body: String?, timeoutMs: Long): McpTransportResponse }

/** OkHttp transport: no redirects (a token must never travel to another address), credentials per server. */
public class OkHttpMcpTransport(client: OkHttpClient, private val credentials: McpCredentialProvider) : McpTransport {
    private val client = client.newBuilder().followRedirects(false).followSslRedirects(false).build()
    override suspend fun request(serverId: String, url: String, method: String, headers: Map<String, String>, body: String?, timeoutMs: Long): McpTransportResponse {
        val b = Request.Builder().url(url)
        headers.forEach { (k, v) -> b.header(k, v) }
        credentials.authorization(serverId)?.let { b.header("Authorization", it) }
        when (method) { "POST" -> b.post((body ?: "").toRequestBody("application/json".toMediaType())); "DELETE" -> b.delete(); else -> b.get() }
        val c = client.newBuilder().callTimeout(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS).build()
        val resp = await(c.newCall(b.build()))
        val h = resp.headers.names().associate { it.lowercase() to (resp.header(it) ?: "") }
        return McpTransportResponse(resp.code, h, { withContext(Dispatchers.IO) { resp.use { it.body?.string() ?: "" } } }, { onLine ->
            withContext(Dispatchers.IO) { resp.use { r -> val src = r.body?.source() ?: return@withContext; while (true) { val line = src.readUtf8Line() ?: break; if (onLine(line + "\n")) break } } }
        }, resp.message)
    }
    private suspend fun await(call: Call): Response = kotlinx.coroutines.suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { call.cancel() }
        call.enqueue(object : okhttp3.Callback {
            override fun onFailure(call: Call, e: IOException) { if (cont.isActive) cont.resumeWith(Result.failure(e)) }
            override fun onResponse(call: Call, response: Response) { cont.resumeWith(Result.success(response)) }
        })
    }
}

/* ---------- typed results ---------- */

public data class McpSessionInfo(val protocolVersion: String, val sessionId: String?, val capabilities: JsonObject, val serverInfo: JsonObject?, val instructions: String)
public data class McpTool(val name: String, val title: String?, val description: String?, val inputSchema: JsonObject?, val annotations: JsonObject?, val raw: JsonObject)
public data class McpResource(val uri: String, val name: String?, val title: String?, val description: String?, val mimeType: String?)
public data class McpPrompt(val name: String, val title: String?, val description: String?, val arguments: List<JsonObject>)
public data class McpCallResult(val isError: Boolean, val content: JsonArray, val structured: JsonElement?)
public data class McpListResult<T>(val items: List<T>, val truncated: Boolean)
public data class McpConnected(val session: McpSessionInfo, val tools: List<McpTool>, val resources: List<McpResource>, val resourceTemplates: List<JsonObject>, val prompts: List<McpPrompt>, val resourcesError: String? = null, val promptsError: String? = null)

/**
 * One session with one MCP server over Streamable HTTP — Kotlin mirror of framework/libs/mcp/client.ts.
 * initialize (version negotiation, session id) → lists with pagination → tools/call (JSON or SSE reply) →
 * resources/read, prompts/get. A forgotten session (404) re-initializes once; close() DELETEs the session.
 * Cancellation = coroutine cancellation (the request is aborted and `notifications/cancelled` is sent).
 */
public class McpClient(
    public val serverId: String,
    public val url: String,
    private val transport: McpTransport,
    private val timeoutMs: Long = Mcp.DEFAULT_TIMEOUT_MS,
    private val onNotification: ((String, JsonObject) -> Unit)? = null,
    private val onCall: ((op: String, ok: Boolean, ms: Long, detail: String) -> Unit)? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private var nextId = 1
    private val idLock = Mutex()
    public var sessionId: String? = null
        private set
    public var protocolVersion: String? = null
        private set
    public var session: McpSessionInfo? = null
        private set
    public val connected: Boolean get() = session != null

    public suspend fun initialize(): McpSessionInfo {
        session?.let { return it }
        sessionId = null; protocolVersion = null
        val (result, sid) = exchange("initialize", McpEngine.initializeParams(), withSession = false)
        val (ok, err) = McpEngine.negotiate(result)
        if (ok == null) throw McpException(err!!)
        protocolVersion = ok.protocolVersion; sessionId = sid
        return McpSessionInfo(ok.protocolVersion, sid, ok.capabilities, ok.serverInfo, ok.instructions).also { session = it; notify("notifications/initialized") }
    }

    public suspend fun close() {
        val sid = sessionId
        session = null; sessionId = null
        val pv = protocolVersion; protocolVersion = null
        if (sid == null) return
        runCatching { transport.request(serverId, url, "DELETE", McpEngine.headers(sid, pv ?: Mcp.PROTOCOL_VERSION, "DELETE"), null, timeoutMs) }
    }

    public suspend fun listTools(): McpListResult<McpTool> = listAll("tools/list", "tools") { o -> McpTool(s(o, "name") ?: "", s(o, "title"), s(o, "description"), o["inputSchema"] as? JsonObject, o["annotations"] as? JsonObject, o) }
    public suspend fun listResources(): McpListResult<McpResource> = listAll("resources/list", "resources") { o -> McpResource(s(o, "uri") ?: "", s(o, "name"), s(o, "title"), s(o, "description"), s(o, "mimeType")) }
    public suspend fun listResourceTemplates(): McpListResult<JsonObject> = listAll("resources/templates/list", "resourceTemplates") { it }
    public suspend fun listPrompts(): McpListResult<McpPrompt> = listAll("prompts/list", "prompts") { o -> McpPrompt(s(o, "name") ?: "", s(o, "title"), s(o, "description"), (o["arguments"] as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()) }

    public suspend fun callTool(name: String, arguments: JsonObject = JsonObject(emptyMap())): McpCallResult {
        val r = request("tools/call", buildJsonObject { put("name", name); put("arguments", arguments) }, "call $name") as? JsonObject ?: JsonObject(emptyMap())
        return McpCallResult((r["isError"] as? JsonPrimitive)?.content == "true", r["content"] as? JsonArray ?: JsonArray(emptyList()), r["structuredContent"])
    }

    public suspend fun readResource(uri: String): List<JsonObject> = ((request("resources/read", buildJsonObject { put("uri", uri) }, "read $uri") as? JsonObject)?.get("contents") as? JsonArray)?.mapNotNull { it as? JsonObject } ?: emptyList()

    public suspend fun getPrompt(name: String, arguments: Map<String, String> = emptyMap()): JsonObject =
        request("prompts/get", buildJsonObject { put("name", name); put("arguments", JsonObject(arguments.mapValues { JsonPrimitive(it.value) })) }, "prompt $name") as? JsonObject ?: JsonObject(emptyMap())

    public suspend fun ping() { request("ping", null, "ping") }

    /** initialize + every list the server offers. */
    public suspend fun connect(): McpConnected {
        val s = initialize()
        var tools = emptyList<McpTool>(); var resources = emptyList<McpResource>(); var templates = emptyList<JsonObject>(); var prompts = emptyList<McpPrompt>()
        var rErr: String? = null; var pErr: String? = null
        if (McpEngine.offers(s.capabilities, "tools")) tools = listTools().items
        if (McpEngine.offers(s.capabilities, "resources")) {
            try { resources = listResources().items } catch (e: McpException) { rErr = e.message }
            try { templates = listResourceTemplates().items } catch (_: McpException) { }
        }
        if (McpEngine.offers(s.capabilities, "prompts")) try { prompts = listPrompts().items } catch (e: McpException) { pErr = e.message }
        return McpConnected(s, tools, resources, templates, prompts, rErr, pErr)
    }

    /* ---------- plumbing ---------- */

    private fun s(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private suspend fun <T> listAll(method: String, key: String, map: (JsonObject) -> T): McpListResult<T> {
        val pages = ArrayList<Pair<List<T>, String?>>()
        var cursor: String? = null
        val seen = HashSet<String>()
        while (pages.size < 100) {
            val r = request(method, McpEngine.pageParams(cursor), method) as? JsonObject ?: JsonObject(emptyMap())
            val next = s(r, "nextCursor")?.takeIf { it.isNotEmpty() }
            pages.add(((r[key] as? JsonArray)?.mapNotNull { it as? JsonObject }?.map(map) ?: emptyList()) to next)
            if (next == null || next in seen) break
            seen.add(next); cursor = next
        }
        val m = McpEngine.mergePages(pages)
        return McpListResult(m.items, m.truncated || m.loop)
    }

    private suspend fun request(method: String, params: JsonObject?, op: String): JsonElement? {
        initialize()
        return try { exchange(method, params, true, op).first } catch (e: McpException) {
            if (e.error.details["session"] == "expired") { session = null; sessionId = null; initialize(); exchange(method, params, true, op).first } else throw e
        }
    }

    private fun headers() = McpEngine.headers(sessionId, protocolVersion)

    private suspend fun notify(method: String, params: JsonObject? = null) {
        val res = transport.request(serverId, url, "POST", headers(), McpEngine.notification(method, params).toString(), timeoutMs)
        if (McpEngine.classifyResponse(res.status, res.headers["content-type"], sessionId != null) == McpResponseKind.ERROR) throw McpException(McpEngine.errorFromHttp(res.status, res.statusText))
    }

    private suspend fun exchange(method: String, params: JsonObject?, withSession: Boolean, op: String = method): Pair<JsonElement?, String?> {
        val id = idLock.withLock { nextId++ }
        val started = now()
        fun done(ok: Boolean, detail: String = "") { onCall?.invoke(op, ok, (now() - started).coerceAtLeast(0), detail) }
        try {
            val res = withTimeoutOrNull(timeoutMs) {
                try { transport.request(serverId, url, "POST", if (withSession) headers() else McpEngine.headers(), McpEngine.request(id, method, params).toString(), timeoutMs) }
                catch (e: SocketTimeoutException) { throw McpException(McpEngine.errorFromTransport("timeout", "no answer within $timeoutMs ms")) }
                catch (e: IOException) { throw McpException(McpEngine.errorFromTransport("network", e.message ?: e.javaClass.simpleName)) }
            } ?: throw McpException(McpEngine.errorFromTransport("timeout", "no answer within $timeoutMs ms"))
            val hadSession = withSession && sessionId != null
            when (McpEngine.classifyResponse(res.status, res.headers["content-type"], hadSession)) {
                McpResponseKind.EXPIRED -> throw McpException(WireError(WireCodes.NOT_FOUND, "the server forgot this session", details = mapOf("session" to "expired")))
                McpResponseKind.ERROR -> throw McpException(if (res.status in 200..299) WireError(WireCodes.INVALID, "unexpected content type ${res.headers["content-type"] ?: "(none)"} from the server") else McpEngine.errorFromHttp(res.status, res.statusText))
                McpResponseKind.ACCEPTED -> throw McpException(WireError(WireCodes.INVALID, "the server accepted the request but sent no response"))
                McpResponseKind.JSON -> {
                    val hit = pick(McpEngine.parseMessages(res.body()), id) ?: throw McpException(WireError(WireCodes.INVALID, "no response to the request in the server's reply"))
                    if (hit is McpMessage.Error) throw McpException(rpcError(hit))
                    done(true)
                    return (hit as McpMessage.Result).result to (res.headers[Mcp.SESSION_HEADER] ?: sessionId)
                }
                McpResponseKind.SSE -> {
                    val hit = readSse(res, id) ?: throw McpException(WireError(WireCodes.INVALID, "no response to the request in the server's reply"))
                    if (hit is McpMessage.Error) throw McpException(rpcError(hit))
                    done(true)
                    return (hit as McpMessage.Result).result to (res.headers[Mcp.SESSION_HEADER] ?: sessionId)
                }
            }
        } catch (e: McpException) { done(false, e.message ?: ""); throw e }
        catch (e: CancellationException) {
            done(false, "cancelled")
            runCatching { withContext(kotlinx.coroutines.NonCancellable) { withTimeoutOrNull(2000) { notify("notifications/cancelled", buildJsonObject { put("requestId", id); put("reason", "cancelled by the user") }) } } }
            throw e
        }
    }

    private fun rpcError(e: McpMessage.Error): WireError = McpEngine.errorFromRpc((e.error["code"] as JsonPrimitive).content.toLong(), (e.error["message"] as? JsonPrimitive)?.content ?: "")

    private fun matches(m: McpMessage, id: Int): Boolean = when (m) {
        is McpMessage.Result -> m.id.content == id.toString()
        is McpMessage.Error -> m.id.let { it == null || it.content == id.toString() }
        else -> false
    }

    private fun pick(messages: List<McpMessage>, id: Int): McpMessage? {
        for (m in messages) {
            if (m is McpMessage.Notification) onNotification?.invoke(m.method, m.params)
            if (matches(m, id)) return m
        }
        return null
    }

    private suspend fun readSse(res: McpTransportResponse, id: Int): McpMessage? {
        val parser = McpEngine.SseParser()
        var hit: McpMessage? = null
        fun take(events: List<ai.amberx.axf.kernel.mcp.SseEvent>): Boolean {
            for (ev in events) {
                if (ev.event != "message") continue
                for (m in McpEngine.parseMessages(ev.data)) {
                    if (m is McpMessage.Notification) onNotification?.invoke(m.method, m.params)
                    if (matches(m, id)) { hit = m; return true }
                }
            }
            return false
        }
        res.lines { line -> take(parser.feed(line)) }
        if (hit == null) take(parser.end())
        return hit
    }
}
