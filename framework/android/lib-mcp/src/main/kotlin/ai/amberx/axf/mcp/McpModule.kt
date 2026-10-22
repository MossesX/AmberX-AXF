package ai.amberx.axf.mcp

import ai.amberx.axf.kernel.asset.AxfJson
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.interop.RemoteService
import ai.amberx.axf.kernel.interop.RemoteServices
import ai.amberx.axf.kernel.interop.WireCodes
import ai.amberx.axf.kernel.interop.WireError
import ai.amberx.axf.kernel.mcp.Mcp
import ai.amberx.axf.kernel.mcp.McpEngine
import ai.amberx.axf.kernel.mcp.McpException
import ai.amberx.axf.kernel.mcp.McpToolEffect
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.network.AxfHttp
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient

/* ---------- server records ---------- */

/** What UI code may see about a server. Never the token: that lives in the secure store under `axf.mcp.token.<id>`. */
public data class McpServerRecord(val id: String, val name: String, val url: String, val description: String = "", val hasToken: Boolean = false, val createdAt: Long = 0, val lastCheck: McpCheck? = null) {
    public fun toJson(): JsonObject = buildJsonObject { put("id", id); put("name", name); put("url", url); put("description", description); put("hasToken", hasToken); put("createdAt", createdAt); lastCheck?.let { put("lastCheck", buildJsonObject { put("at", it.at); put("ok", it.ok); put("tools", it.tools) }) } }
    public companion object {
        public fun fromJson(o: JsonObject): McpServerRecord? {
            fun s(k: String) = (o[k] as? JsonPrimitive)?.content
            val id = s("id") ?: return null
            val lc = (o["lastCheck"] as? JsonObject)?.let { McpCheck((it["at"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 0, (it["ok"] as? JsonPrimitive)?.content == "true", (it["tools"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0) }
            return McpServerRecord(id, s("name") ?: id, s("url") ?: "", s("description") ?: "", s("hasToken") == "true", s("createdAt")?.toLongOrNull() ?: 0, lc)
        }
    }
}
public data class McpCheck(val at: Long, val ok: Boolean, val tools: Int)

/**
 * The server registry: records in the key-value store (`axf.mcp.servers`, mcp-servers@1), tokens only in the
 * platform secure store (Keystore-backed on Android). Mirrors `McpServerRegistry` on the web.
 */
public class McpServerRegistry(private val kv: KeyValueStore?, private val secure: SecureStore?, private val now: () -> Long = System::currentTimeMillis) {
    public val label: String = "this phone's secure storage"
    private var cache: List<McpServerRecord>? = null

    public fun list(): List<McpServerRecord> = cache ?: load().also { cache = it }
    public fun get(id: String): McpServerRecord? = list().firstOrNull { it.id == id }

    private fun load(): List<McpServerRecord> {
        val raw = kv?.get(KEY) ?: return emptyList()
        val o = runCatching { AxfJson.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return emptyList()
        return (o["servers"] as? JsonArray)?.mapNotNull { (it as? JsonObject)?.let(McpServerRecord::fromJson) }?.sortedBy { it.name.lowercase() } ?: emptyList()
    }
    private fun save(list: List<McpServerRecord>) {
        cache = list.sortedBy { it.name.lowercase() }
        kv?.put(KEY, buildJsonObject { put("\$axf", "mcp-servers@1"); put("servers", JsonArray(list.map { it.toJson() })) }.toString())
    }

    /** Validate + save. `token`: null keeps the stored token, "" clears it, anything else stores it (write-only). */
    public suspend fun save(id: String?, name: String, url: String, description: String = "", token: String? = null): AxfResult<McpServerRecord> {
        val problems = McpEngine.validateServerInput(id, name, url, null)
        if (problems.isNotEmpty()) return AxfResult.err(WireError(WireCodes.VALIDATION, problems.joinToString("; ")).toFailure())
        val all = list()
        val sid = id?.takeIf { it.isNotEmpty() } ?: McpEngine.serverIdFor(name, all.map { it.id })
        val old = all.firstOrNull { it.id == sid }
        var hasToken = old?.hasToken ?: false
        if (token != null) {
            if (token.isEmpty()) { secure?.remove(tokenKey(sid)); hasToken = false } else { secure?.put(tokenKey(sid), token); hasToken = true }
        }
        val rec = McpServerRecord(sid, name.trim(), url.trim(), description.trim(), hasToken, old?.createdAt ?: now(), old?.lastCheck)
        save(all.filter { it.id != sid } + rec)
        return AxfResult.ok(rec)
    }

    public suspend fun remove(id: String) { secure?.remove(tokenKey(id)); save(list().filter { it.id != id }) }
    public fun touch(id: String, ok: Boolean, tools: Int) { save(list().map { if (it.id == id) it.copy(lastCheck = McpCheck(now(), ok, tools)) else it }) }

    /** The credential provider for the transport: the stored token as a bearer header, or nothing. */
    public val credentials: McpCredentialProvider = McpCredentialProvider { sid -> (secure?.get(tokenKey(sid)) as? AxfResult.Ok)?.value?.takeIf { it.isNotEmpty() }?.let { "Bearer $it" } }

    public companion object {
        public const val KEY: String = "axf.mcp.servers"
        public fun tokenKey(id: String): String = "axf.mcp.token.$id"
    }
}

/* ---------- call log ---------- */

public data class McpLogRow(val at: Long, val server: String, val op: String, val ok: Boolean, val ms: Long, val detail: String)

/** A bounded in-memory call log (newest first); the devtools and the MCP screen read it. */
public class McpCallLog(private val max: Int = 200) {
    private val rows = ArrayDeque<McpLogRow>()
    public fun add(row: McpLogRow) { synchronized(rows) { rows.addFirst(row.copy(detail = row.detail.take(300))); while (rows.size > max) rows.removeLast() } }
    public fun list(): List<McpLogRow> = synchronized(rows) { rows.toList() }
    public fun clear(): Unit = synchronized(rows) { rows.clear() }
}

/** The outcome of a gated tool call: the wire error keeps its code (`denied`, `confirmation_required`, …). */
public sealed class McpCallOutcome {
    public data class Done(val result: McpCallResult) : McpCallOutcome()
    public data class ConfirmFirst(val error: WireError) : McpCallOutcome()
    public data class Failed(val error: WireError) : McpCallOutcome()
}

/* ---------- the service every module talks to ---------- */

/**
 * `axf.mcp`: the registry, sessions and the call log, plus the outbound gate (INTEROP.md applied to calls the app
 * makes): a tool call checks the local UAC role against the permission its effect needs, and a destructive tool is
 * only run with `confirmed = true` (the UI asked first). Also registered as the kernel's `axf.remote` provider.
 */
public class AxfMcp internal constructor(public val registry: McpServerRegistry, private val http: OkHttpClient, private val runtime: () -> AxfRuntime?, public val timeoutMs: Long = Mcp.DEFAULT_TIMEOUT_MS, public val permissions: ai.amberx.axf.kernel.mcp.McpPermissionSet = Mcp.Permissions.DEFAULT) : RemoteServices {
    public val log: McpCallLog = McpCallLog()
    private val transport: McpTransport = OkHttpMcpTransport(http, registry.credentials)
    private val sessions = HashMap<String, McpClient>()

    public fun open(server: McpServerRecord): McpClient = synchronized(sessions) {
        sessions.getOrPut(server.id) { McpClient(server.id, server.url, transport, timeoutMs, onCall = { op, ok, ms, detail -> log.add(McpLogRow(System.currentTimeMillis(), server.id, op, ok, ms, detail)) }) }
    }
    public suspend fun closeAll() { val all = synchronized(sessions) { sessions.values.toList().also { sessions.clear() } }; all.forEach { runCatching { it.close() } } }

    /** The gate for one tool, against the app's current role. */
    public fun gate(tool: McpTool): ai.amberx.axf.kernel.mcp.McpCallGate = McpEngine.callGate(McpEngine.toolEffect(tool.annotations), runtime()?.permissions() ?: emptySet(), permissions)

    /** Call a tool through the gate. `confirmed` must be true for destructive tools (the UI asked). */
    public suspend fun callTool(server: McpServerRecord, tool: McpTool, arguments: JsonObject, confirmed: Boolean = false): McpCallOutcome {
        val g = gate(tool)
        if (!g.allowed) return McpCallOutcome.Failed(g.error!!)
        if (g.confirm && !confirmed) return McpCallOutcome.ConfirmFirst(WireError(WireCodes.CONFIRMATION_REQUIRED, "${tool.name} is destructive: confirm before calling it", details = mapOf("tool" to tool.name)))
        return try { McpCallOutcome.Done(open(server).callTool(tool.name, arguments)) } catch (e: McpException) { McpCallOutcome.Failed(e.error) }
    }

    /* ---------- RemoteServices (axf.remote): every registered server is a remote service; tools are its actions ---------- */

    override suspend fun list(): AxfResult<List<RemoteService>> = AxfResult.ok(registry.list().map { RemoteService(it.id, it.name, VIA, it.description) })
    override suspend fun describe(service: String): AxfResult<RemoteService> {
        val s = registry.get(service) ?: return AxfResult.err(WireError(WireCodes.NOT_FOUND, "no MCP server $service", details = mapOf("what" to "server", "id" to service)).toFailure())
        return try {
            val tools = open(s).listTools().items.map { t ->
                ai.amberx.axf.kernel.interop.ActionDescriptor(t.name, t.description ?: "", t.inputSchema ?: ai.amberx.axf.kernel.interop.JsonSchemas.EMPTY_OBJECT, exposure = ai.amberx.axf.kernel.interop.Exposure.REMOTE,
                    effect = when (McpEngine.toolEffect(t.annotations)) { McpToolEffect.READ -> ai.amberx.axf.kernel.interop.ActionEffect.READ; McpToolEffect.WRITE -> ai.amberx.axf.kernel.interop.ActionEffect.WRITE; McpToolEffect.DESTRUCTIVE -> ai.amberx.axf.kernel.interop.ActionEffect.DESTRUCTIVE },
                    title = t.title, module = ID)
            }
            AxfResult.ok(RemoteService(s.id, s.name, VIA, s.description, tools))
        } catch (e: McpException) { AxfResult.err(e.error.toFailure()) }
    }
    /** App code calling out: read tools only through this path; write and destructive tools go through [callTool] with the UI's confirmation. */
    override suspend fun call(service: String, tool: String, input: JsonObject, correlationId: String?): AxfResult<JsonElement> {
        val s = registry.get(service) ?: return AxfResult.err(WireError(WireCodes.NOT_FOUND, "no MCP server $service", details = mapOf("what" to "server", "id" to service)).toFailure())
        val t = try { open(s).listTools().items.firstOrNull { it.name == tool } } catch (e: McpException) { return AxfResult.err(e.error.toFailure()) }
            ?: return AxfResult.err(WireError(WireCodes.NOT_FOUND, "no tool $tool on ${s.name}", details = mapOf("what" to "tool", "id" to tool)).toFailure())
        return when (val o = callTool(s, t, input)) {
            is McpCallOutcome.Done -> AxfResult.ok(buildJsonObject { put("isError", o.result.isError); put("content", o.result.content); o.result.structured?.let { put("structured", it) } })
            is McpCallOutcome.ConfirmFirst -> AxfResult.err(ai.amberx.axf.kernel.result.AxfFailure.Denied(permissions.destructive, o.error.message))
            is McpCallOutcome.Failed -> AxfResult.err(o.error.toFailure())
        }
    }

    public companion object { public const val ID: String = McpModule.ID; public const val VIA: String = "mcp" }
}

/**
 * lib-mcp: MCP client for any AXF app. Registers [AxfMcp] (`axf.mcp`, and the kernel's `axf.remote` placeholder is
 * filled), the `mcp` route (MCP servers screen) and `mcp-servers` route (manage servers), the MCP settings group
 * and the `mcp.open` action. Needs axf-network (OkHttp) and the platform's KeyValueStore + SecureStore.
 */
public class McpModule(private val timeoutMs: Long = Mcp.DEFAULT_TIMEOUT_MS, private val permissions: ai.amberx.axf.kernel.mcp.McpPermissionSet = Mcp.Permissions.DEFAULT) : BaseModule(ID, "MCP client") {
    override val dependsOn: List<String> = listOf(ai.amberx.axf.network.NetworkModule.ID)
    override val provides: List<Capability> = listOf(Capability("axf.mcp", "MCP client: server registry, Streamable HTTP sessions, tool calls under the interop gate"), Capability("axf.remote", "Outbound calls to MCP servers (RemoteServices provider)"))
    public lateinit var mcp: AxfMcp
        private set

    override fun register(ctx: ModuleContext) {
        val http = ctx.service(AxfHttp::class)?.client ?: OkHttpClient()
        mcp = AxfMcp(McpServerRegistry(ctx.service(KeyValueStore::class), ctx.service(SecureStore::class)), http, { ctx.service(AxfRuntime::class) }, timeoutMs, permissions)
        ctx.services.register(AxfMcp::class, mcp, "axf.mcp")
        ctx.services.register(RemoteServices::class, mcp, "axf.remote")
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "MCP servers", icon = "cloud", module = id, group = "Connect")))
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE_SERVERS, "Manage MCP servers", icon = "cloud", module = id, requires = permissions.manage)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("mcp.open", ActionMeta("MCP servers", module = id)) { _, _ -> runtime?.navigate(ROUTE) })
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("mcp", "MCP servers", "cloud", id, order = 35, description = "MCP servers this app connects to as a client. Tokens live in ${mcp.registry.label}.", tab = "connections", settings = listOf(
            SettingSpec("axf.mcp.servers.manage", "Manage servers", SettingKind.LINK, "Add, edit or remove MCP servers", target = ROUTE_SERVERS, icon = "cloud", requires = permissions.manage),
            SettingSpec("axf.mcp.open", "Open MCP servers", SettingKind.ACTION, target = "mcp.open", icon = "zap"),
        ))))
    }

    override suspend fun stop(ctx: ModuleContext) { if (::mcp.isInitialized) mcp.closeAll() }

    public companion object {
        public const val ID: String = "ai.amberx.axf.mcp"
        public const val ROUTE: String = "mcp"
        public const val ROUTE_SERVERS: String = "mcp-servers"
    }
}
