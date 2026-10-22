package ai.amberx.axf.kernel.mcp

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.asset.AxfJson
import ai.amberx.axf.kernel.engine.UacEngine
import ai.amberx.axf.kernel.interop.WireCodes
import ai.amberx.axf.kernel.interop.WireError
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * MCP client engine — Kotlin mirror of framework/core/engines/mcp.ts, function for function; pure Kotlin, no transport.
 * JSON-RPC framing, SSE parsing, Streamable HTTP rules, pagination, error mapping onto the wire codes, tool effects
 * and the outbound call gate. Pinned by spec/fixtures/mcp-client.json (McpConformanceTest). lib-mcp adds OkHttp,
 * the secure-store registry and the Compose screens on top.
 */

public object Mcp {
    public const val PROTOCOL_VERSION: String = "2025-06-18"
    public val SUPPORTED_VERSIONS: List<String> = listOf("2025-06-18", "2025-03-26", "2024-11-05")
    public const val SESSION_HEADER: String = "mcp-session-id"
    public const val VERSION_HEADER: String = "mcp-protocol-version"
    public const val DEFAULT_TIMEOUT_MS: Long = 30_000
    public val CLIENT_INFO: JsonObject = buildJsonObject { put("name", "amberx-axf"); put("version", AxfVersion.FRAMEWORK); put("title", "AmberX AXF MCP client") }

    /** Permissions the library checks before a call (UAC grammar; apps grant them in their uac-policy). */
    public object Permissions {
        public const val MANAGE: String = "mcp.servers.manage"
        public const val CALL: String = "mcp.call"
        public const val WRITE: String = "mcp.call.write"
        public const val DESTRUCTIVE: String = "mcp.call.destructive"
        public val DEFAULT: McpPermissionSet = McpPermissionSet(MANAGE, CALL, WRITE, DESTRUCTIVE)
    }
}

/** One JSON-RPC message, classified. Shapes match the fixture's `parsed` entries. */
public sealed class McpMessage {
    public data class Request(val id: JsonPrimitive, val method: String, val params: JsonObject) : McpMessage()
    public data class Notification(val method: String, val params: JsonObject) : McpMessage()
    public data class Result(val id: JsonPrimitive, val result: JsonElement) : McpMessage()
    public data class Error(val id: JsonPrimitive?, val error: JsonObject) : McpMessage()
    public data class Invalid(val reason: String) : McpMessage()

    public fun toJson(): JsonObject = when (this) {
        is Request -> buildJsonObject { put("kind", "request"); put("id", id); put("method", method); put("params", params) }
        is Notification -> buildJsonObject { put("kind", "notification"); put("method", method); put("params", params) }
        is Result -> buildJsonObject { put("kind", "result"); put("id", id); put("result", result) }
        is Error -> buildJsonObject { put("kind", "error"); put("id", id ?: JsonNull); put("error", error) }
        is Invalid -> buildJsonObject { put("kind", "invalid"); put("reason", reason) }
    }
}

public data class SseEvent(val event: String, val data: String, val id: String? = null, val retry: Int? = null) {
    public fun toJson(): JsonObject = buildJsonObject { put("event", event); put("data", data); id?.let { put("id", it) }; retry?.let { put("retry", it) } }
}

public enum class McpToolEffect(public val id: String) { READ("read"), WRITE("write"), DESTRUCTIVE("destructive") }
public enum class McpResponseKind(public val id: String) { ACCEPTED("accepted"), JSON("json"), SSE("sse"), EXPIRED("expired"), ERROR("error") }

public data class McpNegotiated(val protocolVersion: String, val capabilities: JsonObject, val serverInfo: JsonObject?, val instructions: String)
/** A host may map the four permissions onto its own policy (the Dev Console maps all four to `dev.tools`). */
public data class McpPermissionSet(val manage: String, val call: String, val write: String, val destructive: String)
public data class McpCallGate(val allowed: Boolean, val requires: String, val confirm: Boolean, val effect: McpToolEffect, val error: WireError? = null)
public data class McpPages<T>(val items: List<T>, val cursors: List<String>, val truncated: Boolean, val loop: Boolean)

/** Thrown by the client; carries the wire error (stable codes). */
public class McpException(public val error: WireError) : RuntimeException(error.message) { public val code: String get() = error.code }

public object McpEngine {
    private fun isId(v: JsonElement?): Boolean = v is JsonPrimitive && v !is JsonNull && (v.isString || v.content.toLongOrNull() != null || v.content.toDoubleOrNull() != null)
    private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
    private fun JsonObject.s(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /* ---------- JSON-RPC framing ---------- */

    public fun request(id: JsonPrimitive, method: String, params: JsonObject? = null): JsonObject = buildJsonObject { put("jsonrpc", "2.0"); put("id", id); put("method", method); params?.let { put("params", it) } }
    public fun request(id: Int, method: String, params: JsonObject? = null): JsonObject = request(JsonPrimitive(id), method, params)
    public fun notification(method: String, params: JsonObject? = null): JsonObject = buildJsonObject { put("jsonrpc", "2.0"); put("method", method); params?.let { put("params", it) } }

    public fun parseMessage(raw: JsonElement?): McpMessage {
        val o = raw.obj() ?: return McpMessage.Invalid("not an object")
        if (o.s("jsonrpc") != "2.0") return McpMessage.Invalid("jsonrpc must be \"2.0\"")
        val params = o["params"].obj() ?: JsonObject(emptyMap())
        val method = o.s("method")
        if (method != null) {
            val id = o["id"]
            if (id != null && id !is JsonNull) return if (isId(id)) McpMessage.Request(id as JsonPrimitive, method, params) else McpMessage.Invalid("id must be a string or number")
            return McpMessage.Notification(method, params)
        }
        if ("error" in o) {
            val e = o["error"].obj()
            val code = (e?.get("code") as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toLongOrNull()
            if (e == null || code == null || e.s("message") == null) return McpMessage.Invalid("error needs a numeric code and a message")
            val id = o["id"]?.takeIf { isId(it) } as? JsonPrimitive
            return McpMessage.Error(id, buildJsonObject { put("code", code); put("message", e.s("message")!!); e["data"]?.let { put("data", it) } })
        }
        if ("result" in o) return if (isId(o["id"])) McpMessage.Result(o["id"] as JsonPrimitive, o["result"]!!) else McpMessage.Invalid("result needs an id")
        return McpMessage.Invalid("neither a request, a notification nor a response")
    }

    public fun parseMessages(text: String): List<McpMessage> {
        val raw = runCatching { AxfJson.parseToJsonElement(text) }.getOrElse { return listOf(McpMessage.Invalid("not valid JSON")) }
        if (raw is JsonArray) return if (raw.isEmpty()) listOf(McpMessage.Invalid("empty batch")) else raw.map { parseMessage(it) }
        return listOf(parseMessage(raw))
    }

    /* ---------- Server-Sent Events ---------- */

    /** Incremental SSE parser (event/data/id/retry, comments, CRLF/CR/LF; a blank line dispatches; end() flushes). */
    public class SseParser {
        private val buf = StringBuilder()
        private var event = ""
        private val data = ArrayList<String>()
        private var id: String? = null
        private var retry: Int? = null

        public fun feed(chunk: String): List<SseEvent> {
            buf.append(chunk)
            val out = ArrayList<SseEvent>()
            while (true) {
                var i = -1; var len = 1
                for (k in buf.indices) { val c = buf[k]; if (c == '\n') { i = k; break }; if (c == '\r') { i = k; len = if (k + 1 < buf.length && buf[k + 1] == '\n') 2 else 1; break } }
                if (i < 0) break
                val line = buf.substring(0, i)
                buf.delete(0, i + len)
                line(line)?.let(out::add)
            }
            return out
        }

        public fun end(): List<SseEvent> {
            val out = ArrayList<SseEvent>()
            if (buf.isNotEmpty()) { val l = buf.toString(); buf.setLength(0); line(l)?.let(out::add) }
            dispatch()?.let(out::add)
            return out
        }

        private fun line(line: String): SseEvent? {
            if (line.isEmpty()) return dispatch()
            if (line.startsWith(":")) return null
            val i = line.indexOf(':')
            val field = if (i < 0) line else line.substring(0, i)
            var value = if (i < 0) "" else line.substring(i + 1)
            if (value.startsWith(" ")) value = value.substring(1)
            when (field) {
                "event" -> event = value
                "data" -> data.add(value)
                "id" -> if ('\u0000' !in value) id = value
                "retry" -> if (value.isNotEmpty() && value.all { it.isDigit() }) retry = value.toIntOrNull()
            }
            return null
        }

        private fun dispatch(): SseEvent? {
            if (data.isEmpty()) { event = ""; return null }
            val ev = SseEvent(event.ifEmpty { "message" }, data.joinToString("\n"), id, retry)
            event = ""; data.clear(); retry = null
            return ev
        }
    }

    public fun parseSse(text: String): List<SseEvent> { val p = SseParser(); return p.feed(text) + p.end() }

    /* ---------- Streamable HTTP rules ---------- */

    public fun headers(sessionId: String? = null, protocolVersion: String? = null, method: String = "POST"): Map<String, String> = buildMap {
        put("accept", if (method == "GET") "text/event-stream" else "application/json, text/event-stream")
        if (method == "POST") put("content-type", "application/json")
        if (!sessionId.isNullOrEmpty()) put(Mcp.SESSION_HEADER, sessionId)
        if (!protocolVersion.isNullOrEmpty()) put(Mcp.VERSION_HEADER, protocolVersion)
    }

    public fun initializeParams(client: JsonObject = Mcp.CLIENT_INFO, protocolVersion: String = Mcp.PROTOCOL_VERSION): JsonObject = buildJsonObject {
        put("protocolVersion", protocolVersion); put("capabilities", JsonObject(emptyMap()))
        put("clientInfo", buildJsonObject { put("name", client.s("name") ?: ""); put("version", client.s("version") ?: ""); client.s("title")?.let { put("title", it) } })
    }

    /** Right: what the session keeps; Left: a wire error (`invalid`) when the version isn't one we speak. */
    public fun negotiate(result: JsonElement?): Pair<McpNegotiated?, WireError?> {
        val o = result.obj() ?: return null to WireError(WireCodes.INVALID, "initialize returned no result object")
        val v = o.s("protocolVersion") ?: ""
        if (v !in Mcp.SUPPORTED_VERSIONS) return null to WireError(WireCodes.INVALID, "server protocol version ${v.ifEmpty { "(none)" }} is not supported (client speaks ${Mcp.SUPPORTED_VERSIONS.joinToString(", ")})")
        val si = o["serverInfo"].obj()
        val info = si?.s("name")?.let { name -> buildJsonObject { put("name", name); put("version", si.s("version") ?: ""); si.s("title")?.let { put("title", it) } } }
        return McpNegotiated(v, o["capabilities"].obj() ?: JsonObject(emptyMap()), info, o.s("instructions") ?: "") to null
    }

    public fun offers(capabilities: JsonObject?, cap: String): Boolean { val v = capabilities?.get(cap) ?: return false; return v !is JsonNull && !(v is JsonPrimitive && !v.isString && v.content == "false") }

    public fun classifyResponse(status: Int, contentType: String?, hadSession: Boolean): McpResponseKind {
        if (status == 202) return McpResponseKind.ACCEPTED
        if (status == 404 && hadSession) return McpResponseKind.EXPIRED
        if (status < 200 || status >= 300) return McpResponseKind.ERROR
        val ct = (contentType ?: "").lowercase()
        return when { ct.startsWith("text/event-stream") -> McpResponseKind.SSE; ct.startsWith("application/json") || ct.isEmpty() -> McpResponseKind.JSON; else -> McpResponseKind.ERROR }
    }

    /* ---------- pagination ---------- */

    public fun pageParams(cursor: String?): JsonObject? = if (cursor.isNullOrEmpty()) null else buildJsonObject { put("cursor", cursor) }

    public fun <T> mergePages(pages: List<Pair<List<T>, String?>>, maxPages: Int = 100): McpPages<T> {
        val items = ArrayList<T>(); val cursors = ArrayList<String>(); val seen = HashSet<String>()
        var truncated = false; var loop = false
        for ((list, next) in pages) {
            items.addAll(list)
            val n = next?.takeIf { it.isNotEmpty() } ?: break
            if (n in seen) { loop = true; break }
            if (cursors.size + 1 >= maxPages) { truncated = true; break }
            seen.add(n); cursors.add(n)
        }
        return McpPages(items, cursors, truncated, loop)
    }

    /* ---------- errors ---------- */

    private fun wire(code: String, message: String, details: Map<String, String> = emptyMap()) = WireError(code, message, retryable = code == WireCodes.UNAVAILABLE, details = details)

    public fun errorFromRpc(code: Long, message: String): WireError {
        val msg = message.ifEmpty { "JSON-RPC error $code" }
        val d = mapOf("rpc" to code.toString())
        return when (code) {
            -32700L, -32600L -> wire(WireCodes.INVALID, msg, d)
            -32601L, -32002L -> wire(WireCodes.NOT_FOUND, msg, d)
            -32602L -> wire(WireCodes.VALIDATION, msg, d)
            -32001L -> wire(WireCodes.TIMEOUT, msg, d)
            -32800L -> wire(WireCodes.CANCELLED, msg, d)
            else -> wire(WireCodes.UNEXPECTED, msg, d)
        }
    }

    public fun errorFromHttp(status: Int, statusText: String = ""): WireError {
        val d = mapOf("http" to status.toString())
        val txt = if (statusText.isNotEmpty()) " $statusText" else ""
        return when {
            status == 401 || status == 403 -> wire(WireCodes.DENIED, "HTTP $status$txt: the server refused the credentials", d)
            status == 404 -> wire(WireCodes.NOT_FOUND, "HTTP 404$txt: no MCP endpoint at that URL", d)
            status == 405 -> wire(WireCodes.NOT_IMPLEMENTED, "HTTP 405$txt: the server does not offer that transport method", d)
            status == 408 || status == 504 -> wire(WireCodes.TIMEOUT, "HTTP $status$txt", d)
            status == 429 || status == 502 || status == 503 -> wire(WireCodes.UNAVAILABLE, "HTTP $status$txt: try again later", d)
            status >= 500 -> wire(WireCodes.UNAVAILABLE, "HTTP $status$txt", d)
            status >= 400 -> wire(WireCodes.INVALID, "HTTP $status$txt", d)
            status >= 300 -> wire(WireCodes.INVALID, "HTTP $status$txt: redirects are not followed (a credential must never travel to another address)", d)
            else -> wire(WireCodes.UNEXPECTED, "HTTP $status$txt", d)
        }
    }

    public fun errorFromTransport(kind: String, message: String): WireError = when (kind) {
        "timeout" -> wire(WireCodes.TIMEOUT, message)
        "cancelled" -> wire(WireCodes.CANCELLED, message)
        "network" -> wire(WireCodes.UNAVAILABLE, message)
        else -> wire(WireCodes.INVALID, message)
    }

    /* ---------- tools: effects and the gate ---------- */

    public fun toolEffect(annotations: JsonObject?, strict: Boolean = false): McpToolEffect {
        fun flag(k: String): Boolean? = (annotations?.get(k) as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toBooleanStrictOrNull()
        return when {
            flag("readOnlyHint") == true -> McpToolEffect.READ
            flag("destructiveHint") == true -> McpToolEffect.DESTRUCTIVE
            flag("destructiveHint") == false -> McpToolEffect.WRITE
            strict -> McpToolEffect.DESTRUCTIVE
            else -> McpToolEffect.WRITE
        }
    }

    /** The outbound gate: the local role must hold the permission the effect needs; destructive tools are always confirmed. */
    public fun callGate(effect: McpToolEffect, granted: Set<String>, perms: McpPermissionSet = Mcp.Permissions.DEFAULT): McpCallGate {
        val requires = when (effect) { McpToolEffect.READ -> perms.call; McpToolEffect.WRITE -> perms.write; McpToolEffect.DESTRUCTIVE -> perms.destructive }
        val allowed = UacEngine.hasPermission(granted, requires)
        return McpCallGate(allowed, requires, effect == McpToolEffect.DESTRUCTIVE, effect, if (allowed) null else wire(WireCodes.DENIED, "Your role can't call ${effect.id} tools (needs $requires)", mapOf("permission" to requires)))
    }

    /* ---------- results, server records ---------- */

    public fun contentText(content: JsonArray?): String = (content ?: JsonArray(emptyList())).mapNotNull { it as? JsonObject }.joinToString("\n\n") { c ->
        val mime = c.s("mimeType")?.let { " ($it)" } ?: ""
        when (c.s("type")) {
            "text" -> c.s("text") ?: ""
            "resource" -> { val r = c["resource"].obj(); val body = r?.s("text") ?: (r?.s("blob")?.let { "(binary resource, ${it.length} base64 chars)" } ?: "(binary resource)"); "${r?.s("uri") ?: ""}\n$body" }
            "resource_link" -> "${c.s("uri") ?: ""}$mime"
            else -> "${c.s("type")}$mime${c.s("uri")?.let { ": $it" } ?: ""}${c.s("data")?.let { " · ${it.length} base64 chars" } ?: ""}"
        }
    }

    public val SERVER_ID: Regex = Regex("^[a-z0-9][a-z0-9-]{0,47}$")
    public val ENV_NAME: Regex = Regex("^[A-Z_][A-Z0-9_]{0,63}$")
    private val URL = Regex("^(https?)://([^/?#\\s]+)", RegexOption.IGNORE_CASE)

    public fun serverIdFor(name: String, taken: Collection<String> = emptyList()): String {
        val base = name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').take(48).ifEmpty { "server" }
        var id = base; var n = 2
        while (id in taken) { id = "$base-${n++}" }
        return id
    }

    public fun validateServerInput(id: String?, name: String?, url: String?, tokenEnv: String?): List<String> = buildList {
        val nm = (name ?: "").trim()
        if (nm.isEmpty()) add("name is required") else if (nm.length > 80) add("name is too long (80 characters)")
        val u = (url ?: "").trim()
        if (u.isEmpty()) add("url is required") else if (u.length > 500) add("url is too long (500 characters)") else if (!URL.containsMatchIn(u)) add("url must be an http(s) URL of a Streamable HTTP MCP endpoint, e.g. https://example.com/mcp")
        if (!id.isNullOrEmpty() && !SERVER_ID.matches(id)) add("id must be lowercase letters, digits and dashes")
        if (!tokenEnv.isNullOrEmpty() && !ENV_NAME.matches(tokenEnv)) add("tokenEnv must be an environment variable name like AXHUB_TOKEN")
    }

    public fun argumentSkeleton(schema: JsonObject?): JsonObject = buildJsonObject {
        val props = schema?.get("properties").obj() ?: return@buildJsonObject
        val required = (schema?.get("required") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content } ?: emptyList()
        for ((k, pe) in props) {
            val p = pe.obj() ?: continue
            if ("default" in p) { put(k, p["default"]!!); continue }
            if (k !in required) continue
            val t = p["type"].let { if (it is JsonArray) (it.firstOrNull() as? JsonPrimitive)?.content else (it as? JsonPrimitive)?.content }
            val enum = p["enum"] as? JsonArray
            put(k, when {
                enum != null && enum.isNotEmpty() -> enum[0]
                t == "number" || t == "integer" -> JsonPrimitive(0)
                t == "boolean" -> JsonPrimitive(false)
                t == "array" -> JsonArray(emptyList())
                t == "object" -> JsonObject(emptyMap())
                else -> JsonPrimitive("")
            })
        }
    }
}
