package ai.amberx.axf.kernel.ai

import ai.amberx.axf.kernel.alerts.Diagnostic
import ai.amberx.axf.kernel.assistant.AssistantRules
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.live.LiveDetach
import ai.amberx.axf.kernel.live.LiveEvent
import ai.amberx.axf.kernel.live.LiveReplay
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * AI modes — ai-modes@1 (kernel API level 1; the lib-ai contract, build-queue epic x.lib.ai). Same design as the web
 * reference framework/core/ai-modes.ts; conformance fixture spec/fixtures/ai-modes.json (AiModesConformanceTest).
 * Written without a compiler: CI (:axf-kernel:test) compiles and replays it.
 *
 * A MODE is what an app asks the assistant to do: chat, read a codebase into notes, send a build request to the
 * orchestrator. Modes are an open registry ([AiModeRegistry]; plugins add theirs; the built-ins can't be removed).
 * The UAC policy gates modes for non-admins ([AiModes.allowed]: only what the policy allows, chat alone by default).
 * A trigger (triggers@1) may override the mode it opens ([AiModes.resolve]). Sessions run on assistant@1 +
 * live-session@1 through [AiSessionClient]; the host is axHub, a typed placeholder (`axf.ai.session`) until wired.
 */

public const val AI_MODES_CONTRACT: String = "ai-modes@1"
/** The session host a module registers under; the kernel declares it as a placeholder until axHub is wired. */
public const val AI_SESSION_CAPABILITY: String = "axf.ai.session"
/** Host id the AiSessionClient runs sessions on. */
public const val AI_SESSION_HOST: String = "axhub"

public enum class ModelTier(public val id: String) {
    FAST("fast"), BALANCED("balanced"), DEEP("deep");
    public companion object {
        public val IDS: List<String> = entries.map { it.id }
        public fun parse(s: String?): ModelTier? = entries.firstOrNull { it.id == s }
    }
}

public data class AiMode(
    /** namespaced: `ai.chat`, `ai.read-codebase`, `notes.summarize` */
    val id: String,
    val label: String,
    /** hub permission the caller must hold (`a.b.*` wildcards as in assistant@1); "" = none */
    val requiresPermission: String,
    /** the mode never writes anywhere */
    val readOnly: Boolean,
    /** a person approves before the mode acts */
    val needsApproval: Boolean,
    /** live-session@1 kind the mode opens */
    val sessionKind: String,
    /** model tier the mode prefers when the user didn't choose */
    val tier: ModelTier,
    val description: String? = null,
    /** owning module (`axf.framework` for the built-ins) */
    val module: String,
) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("id", JsonPrimitive(id)); put("label", JsonPrimitive(label)); put("requiresPermission", JsonPrimitive(requiresPermission))
        put("readOnly", JsonPrimitive(readOnly)); put("needsApproval", JsonPrimitive(needsApproval)); put("sessionKind", JsonPrimitive(sessionKind)); put("tier", JsonPrimitive(tier.id))
        if (description != null) put("description", JsonPrimitive(description))
        put("module", JsonPrimitive(module))
    })

    public companion object {
        public fun parse(o: JsonObject): AiMode = AiMode(
            id = AiJson.str(o, "id") ?: "", label = AiJson.str(o, "label") ?: "", requiresPermission = AiJson.str(o, "requiresPermission") ?: "",
            readOnly = AiJson.bool(o, "readOnly") ?: false, needsApproval = AiJson.bool(o, "needsApproval") ?: false, sessionKind = AiJson.str(o, "sessionKind") ?: "",
            tier = ModelTier.parse(AiJson.str(o, "tier")) ?: ModelTier.BALANCED, description = AiJson.str(o, "description"), module = AiJson.str(o, "module") ?: "",
        )
    }
}

public object AiModes {
    public const val BUILTIN_MODULE: String = "axf.framework"
    public const val CHAT: String = "ai.chat"
    public const val READ_CODEBASE: String = "ai.read-codebase"
    public const val BUILD_REQUEST: String = "ai.build-request"
    public const val DEFAULT_MODE: String = CHAT
    /** What a non-admin may use when the policy says nothing. */
    public val DEFAULT_ALLOWED: List<String> = listOf(CHAT)

    public val BUILTINS: List<AiMode> = listOf(
        AiMode(CHAT, "Chat", "", true, false, "assistant.chat", ModelTier.BALANCED, "Talk with the assistant; nothing is written", BUILTIN_MODULE),
        AiMode(READ_CODEBASE, "Read a codebase", "ai.read", true, false, "assistant.read", ModelTier.FAST, "Read a repository or folder and turn it into notes", BUILTIN_MODULE),
        AiMode(BUILD_REQUEST, "Build request", "ai.build", false, true, "agent.run", ModelTier.DEEP, "Send a build request to the orchestrator; a person approves it first", BUILTIN_MODULE),
    )

    /** Admin passes everything; others need the mode in the policy's allowed list AND its permission. */
    public fun allowed(mode: AiMode, policy: AiModePolicy): Boolean {
        if (policy.admin) return true
        val allowed = policy.allowedModes ?: DEFAULT_ALLOWED
        return mode.id in allowed && (mode.requiresPermission.isEmpty() || AssistantRules.permissionAllows(policy.perms, mode.requiresPermission))
    }

    public fun allowed(modes: List<AiMode>, policy: AiModePolicy): List<AiMode> = modes.filter { allowed(it, policy) }

    /**
     * Picks the mode for a request: a trigger's override first, then what the caller asked for, then the default. A
     * refused or unknown pick falls back to the default when that is allowed, else nothing is allowed.
     */
    public fun resolve(modes: List<AiMode>, policy: AiModePolicy, override: String? = null, requested: String? = null, defaultMode: String? = null): ModeResolution {
        val byId = modes.associateBy { it.id }
        val def = defaultMode?.takeIf { it.isNotEmpty() } ?: DEFAULT_MODE
        fun tryPick(id: String?, reason: ModeReason): ModeResolution? {
            if (id.isNullOrEmpty()) return null
            val m = byId[id]
            if (m != null && allowed(m, policy)) return ModeResolution(m, reason)
            return ModeResolution(null, ModeReason.DENIED, id)
        }
        val first = tryPick(override, ModeReason.OVERRIDE) ?: tryPick(requested, ModeReason.REQUESTED)
        if (first?.mode != null) return first
        val d = byId[def]
        if (d != null && allowed(d, policy)) return if (first != null) ModeResolution(d, ModeReason.FALLBACK, first.denied) else ModeResolution(d, ModeReason.DEFAULT)
        return ModeResolution(null, ModeReason.DENIED, first?.denied ?: def)
    }

    /**
     * Model rules: a user's explicit pick counts only when the policy lets them choose models (`assistant.models`, or
     * admin) and the model exists; otherwise the mode's tier; a missing tier takes the nearest (up first, then down);
     * with no tiers at all the first option; with no options an empty choice.
     */
    public fun chooseModel(mode: AiMode, options: List<ModelOption>, policy: AiModePolicy, userPick: String? = null): ModelChoice {
        if (options.isEmpty()) return ModelChoice("", null, ModelReason.NONE)
        val canChoose = policy.admin || AssistantRules.permissionAllows(policy.perms, "assistant.models")
        if (!userPick.isNullOrEmpty() && canChoose) options.firstOrNull { it.id == userPick }?.let { return ModelChoice(it.id, it.tier, ModelReason.USER) }
        options.firstOrNull { it.tier == mode.tier }?.let { return ModelChoice(it.id, it.tier, ModelReason.MODE) }
        val tiers = ModelTier.entries
        val i = tiers.indexOf(mode.tier)
        val order = tiers.drop(i + 1) + tiers.take(i).reversed()
        for (t in order) options.firstOrNull { it.tier == t }?.let { return ModelChoice(it.id, it.tier, ModelReason.NEAREST) }
        return ModelChoice(options[0].id, options[0].tier, ModelReason.FIRST)
    }

    /** Resolves mode + model for an input. `request` is null when the policy allows nothing. */
    public fun buildRequest(modes: List<AiMode>, policy: AiModePolicy, options: List<ModelOption>, input: AiRequestInput): AiRequestResult {
        val resolution = resolve(modes, policy, input.override, input.requested)
        val mode = resolution.mode ?: return AiRequestResult(null, resolution, null)
        val model = chooseModel(mode, options, policy, input.model)
        val title = (input.title?.takeIf { it.isNotEmpty() } ?: input.prompt).replace(Regex("\\s+"), " ").trim().take(60).ifEmpty { mode.label }
        val request = AiSessionRequest(mode.id, mode.sessionKind, input.prompt, model.model, mode.readOnly, mode.needsApproval, title, input.context, input.triggerId)
        return AiRequestResult(request, resolution, model)
    }
}

/** Open registry of modes. Built-ins are always present; a plugin may replace one by id (diagnostic) but never remove it. */
public class AiModeRegistry(private val report: (Diagnostic) -> Unit = {}) {
    private val items = LinkedHashMap<String, AiMode>()

    init { for (m in AiModes.BUILTINS) items[m.id] = m }

    public fun register(mode: AiMode): Diagnostic.ContributionConflict? {
        val conflict = synchronized(this) {
            val was = items[mode.id]
            val c = if (was != null && was.module != mode.module) Diagnostic.ContributionConflict("ai-mode", mode.id, was.module, mode.module) else null
            items[mode.id] = mode
            c
        }
        if (conflict != null) report(conflict)
        return conflict
    }

    /** Removes a plugin's mode; a built-in stays (false). */
    @Synchronized public fun unregister(id: String): Boolean {
        if (AiModes.BUILTINS.any { it.id == id }) return false
        return items.remove(id) != null
    }

    @Synchronized public fun get(id: String): AiMode? = items[id]
    @Synchronized public fun list(): List<AiMode> = items.values.toList()
}

/** What the caller may do: admin passes everything; others need the mode in [allowedModes] AND its permission. */
public data class AiModePolicy(val admin: Boolean, val perms: List<String> = emptyList(), /** omitted = chat only */ val allowedModes: List<String>? = null) {
    public companion object {
        public fun parse(o: JsonObject): AiModePolicy = AiModePolicy(AiJson.bool(o, "admin") ?: false, AiJson.strings(o["perms"]), (o["allowedModes"] as? JsonArray)?.let { AiJson.strings(it) })
    }
}

public enum class ModeReason(public val id: String) { OVERRIDE("override"), REQUESTED("requested"), DEFAULT("default"), FALLBACK("fallback"), DENIED("denied") }

public data class ModeResolution(val mode: AiMode?, val reason: ModeReason, val denied: String? = null) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("mode", mode?.toJson() ?: JsonNull); put("reason", JsonPrimitive(reason.id))
        if (denied != null) put("denied", JsonPrimitive(denied))
    })
}

public data class ModelOption(val id: String, val tier: ModelTier, val label: String? = null) {
    public companion object { public fun parse(o: JsonObject): ModelOption = ModelOption(AiJson.str(o, "id") ?: "", ModelTier.parse(AiJson.str(o, "tier")) ?: ModelTier.BALANCED, AiJson.str(o, "label")) }
}

public enum class ModelReason(public val id: String) { USER("user"), MODE("mode"), NEAREST("nearest"), FIRST("first"), NONE("none") }

public data class ModelChoice(val model: String, val tier: ModelTier?, val reason: ModelReason) {
    public fun toJson(): JsonObject = JsonObject(mapOf("model" to JsonPrimitive(model), "tier" to (tier?.let { JsonPrimitive(it.id) } ?: JsonNull), "reason" to JsonPrimitive(reason.id)))
}

public data class AiRequestInput(
    val prompt: String,
    val context: ChatContext? = null,
    /** the mode the caller wants */
    val requested: String? = null,
    /** the trigger that opened it and its per-trigger mode override */
    val triggerId: String? = null,
    val override: String? = null,
    val model: String? = null,
    val title: String? = null,
)

/** What goes to the [AiSessionClient] once the mode and model are settled. */
public data class AiSessionRequest(
    val mode: String,
    val sessionKind: String,
    val prompt: String,
    val model: String,
    val readOnly: Boolean,
    /** true: the host waits for a person before the session acts (live-session `wait`) */
    val needsApproval: Boolean,
    val title: String,
    val context: ChatContext? = null,
    val triggerId: String? = null,
) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("mode", JsonPrimitive(mode)); put("sessionKind", JsonPrimitive(sessionKind)); put("prompt", JsonPrimitive(prompt)); put("model", JsonPrimitive(model))
        put("readOnly", JsonPrimitive(readOnly)); put("needsApproval", JsonPrimitive(needsApproval)); put("title", JsonPrimitive(title))
        if (context != null) put("context", context.toJson())
        if (triggerId != null) put("triggerId", JsonPrimitive(triggerId))
    })
}

public data class AiRequestResult(val request: AiSessionRequest?, val resolution: ModeResolution, val model: ModelChoice?) {
    public fun toJson(): JsonObject = JsonObject(mapOf("request" to (request?.toJson() ?: JsonNull), "resolution" to resolution.toJson(), "model" to (model?.toJson() ?: JsonNull)))
}

/**
 * Runs mode sessions on a live-session host. `start` opens the session and sends the first turn; `attach` replays
 * after `after` then streams until detached (detaching never stops anything); `send` adds a turn; `close` is the only
 * way a session ends. An Android module implements it over an AssistantClient + a SessionHost; axHub is the host.
 */
public interface AiSessionClient {
    public val host: String
    public suspend fun available(): Boolean
    public suspend fun start(request: AiSessionRequest): AxfResult<LiveSessionInfo>
    public suspend fun attach(id: String, after: Long, onEvent: (LiveEvent) -> Unit, onReplay: (LiveReplay) -> Unit = {}): AxfResult<LiveDetach>
    public suspend fun send(id: String, prompt: String, context: ChatContext? = null): AxfResult<Unit>
    /** replays events after [after] (a stream without staying attached) */
    public suspend fun stream(id: String, after: Long, max: Int = 500): AxfResult<LiveReplay>
    /** stops the running turn; the session stays open */
    public suspend fun stop(id: String): AxfResult<Unit>
    public suspend fun close(id: String): AxfResult<Unit>
    public suspend fun list(): AxfResult<List<LiveSessionInfo>>
}

/** The kernel default until the axHub host is wired. Never pretends to work. */
public object PlaceholderAiSessionClient : AiSessionClient {
    private val missing get() = AxfResult.err(AxfFailure.NotImplemented(AI_SESSION_CAPABILITY))
    override val host: String = AI_SESSION_HOST
    override suspend fun available(): Boolean = false
    override suspend fun start(request: AiSessionRequest): AxfResult<LiveSessionInfo> = missing
    override suspend fun attach(id: String, after: Long, onEvent: (LiveEvent) -> Unit, onReplay: (LiveReplay) -> Unit): AxfResult<LiveDetach> = missing
    override suspend fun send(id: String, prompt: String, context: ChatContext?): AxfResult<Unit> = missing
    override suspend fun stream(id: String, after: Long, max: Int): AxfResult<LiveReplay> = missing
    override suspend fun stop(id: String): AxfResult<Unit> = missing
    override suspend fun close(id: String): AxfResult<Unit> = missing
    override suspend fun list(): AxfResult<List<LiveSessionInfo>> = AxfResult.ok(emptyList())
}

/** JSON helpers shared by the ai-modes contract and its conformance test. */
public object AiJson {
    public fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    public fun bool(o: JsonObject, k: String): Boolean? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toBooleanStrictOrNull()
    public fun strings(e: kotlinx.serialization.json.JsonElement?): List<String> = (e as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content } ?: emptyList()
}
