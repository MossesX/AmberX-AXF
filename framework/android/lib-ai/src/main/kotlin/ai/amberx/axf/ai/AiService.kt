package ai.amberx.axf.ai

import ai.amberx.axf.kernel.ai.AiMode
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModeRegistry
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.ai.AiRequestResult
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.AiSessionRequest
import ai.amberx.axf.kernel.ai.ModeResolution
import ai.amberx.axf.kernel.ai.ModelChoice
import ai.amberx.axf.kernel.ai.ModelOption
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.assistant.ChatContext
import ai.amberx.axf.kernel.assistant.LiveReply
import ai.amberx.axf.kernel.assistant.StreamEvent
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.config.ConfigLayer
import ai.amberx.axf.kernel.contract.Principal
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.triggers.TriggerCommand
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.json.JsonPrimitive

// ---------------------------------------------------------------- UAC: where the caller's policy comes from

/** The ai-modes@1 policy of whoever is using the app right now. */
public fun interface AiPolicySource { public fun policy(): AiModePolicy }

public object AiPolicies {
    /** Principal attribute listing extra modes for this user (comma list), set by the account provider from the hub's users page. */
    public const val MODES_ATTRIBUTE: String = "ai.modes"
    /** A UAC permission `ai.mode.<id>` also lets a user use mode `<id>` (plus chat). */
    public const val MODE_PERMISSION_PREFIX: String = "ai.mode."

    /**
     * The local UAC view: the runtime role's resolved permissions ([perms]), admin when they hold `*` or `ai.admin`
     * (or the principal holds the `admin` role); allowed modes from the principal's [MODES_ATTRIBUTE] or `ai.mode.*`
     * permissions, else none listed (= chat only, the contract default).
     */
    public fun local(perms: () -> Set<String>, principal: () -> Principal? = { null }): AiPolicySource = AiPolicySource {
        val p = perms()
        val who = principal()
        val admin = "*" in p || "ai.admin" in p || who?.roles?.contains("admin") == true
        val fromAttr = who?.attributes?.get(MODES_ATTRIBUTE)?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }
        val fromPerms = p.filter { it.startsWith(MODE_PERMISSION_PREFIX) && it.length > MODE_PERMISSION_PREFIX.length && !it.endsWith("*") }.map { it.removePrefix(MODE_PERMISSION_PREFIX) }
        val modes = when {
            fromAttr != null -> (listOf(AiModes.CHAT) + fromAttr).distinct()
            fromPerms.isNotEmpty() -> (listOf(AiModes.CHAT) + fromPerms).distinct()
            else -> null
        }
        AiModePolicy(admin, p.toList(), modes)
    }
}

// ---------------------------------------------------------------- settings (mode, model, read-aloud)

/** lib-ai's settings group: preferred mode, model, read replies aloud. Values live in the kernel Config (USER layer), where lib-settings writes them. */
public class AiSettings(private val config: Config?, private val store: KeyValueStore? = null) {
    public companion object {
        public const val GROUP: String = "ai"
        public const val MODE: String = "axf.ai.mode"
        public const val MODEL: String = "axf.ai.model"
        public const val READ_ALOUD: String = "axf.ai.readAloud"
        /** `model` value meaning "let the mode's tier pick". */
        public const val AUTO: String = ""

        public fun group(modes: List<AiMode>, module: String): SettingsGroup = SettingsGroup(
            GROUP, "AI assistant", "sparkles", module, order = 40, tab = "connections",
            description = "Sessions run on axHub and stay live when you leave; what you may use comes from your hub account.",
            settings = listOf(
                SettingSpec(MODE, "Mode", SettingKind.CHOICE, "What the assistant does when nothing else says (a trigger may pick its own). Modes your account can't use fall back to chat.",
                    JsonPrimitive(AiModes.DEFAULT_MODE), options = modes.map { it.id to it.label }, icon = "sparkles"),
                SettingSpec(MODEL, "Model", SettingKind.TEXT, "Model id, or empty to let the mode choose. Only counts when your account may pick models (assistant.models).",
                    JsonPrimitive(AUTO), icon = "cpu"),
                SettingSpec(READ_ALOUD, "Read replies aloud", SettingKind.TOGGLE, "Speak each finished reply (needs a speech provider, e.g. lib-speech).",
                    JsonPrimitive(false), icon = "volume-2"),
            ),
        )
    }

    private fun raw(key: String): String? = config?.string(key) ?: store?.get(key)
    private fun write(key: String, value: String) { config?.set(key, value, ConfigLayer.USER); store?.put(key, value) }

    public var mode: String
        get() = raw(MODE)?.takeIf { it.isNotBlank() } ?: AiModes.DEFAULT_MODE
        set(v) = write(MODE, v)
    public var model: String
        get() = raw(MODEL)?.trim() ?: AUTO
        set(v) = write(MODEL, v.trim())
    public var readAloud: Boolean
        get() = raw(READ_ALOUD)?.toBooleanStrictOrNull() ?: false
        set(v) = write(READ_ALOUD, v.toString())
}

// ---------------------------------------------------------------- resume: the last seq seen per session

/** Remembers the last seq this device saw per session, so reopening the app replays only what it missed. */
public class AiCursors(private val store: KeyValueStore?) {
    private val mem = HashMap<String, Long>()
    private fun key(id: String) = "axf.ai.cursor.$id"
    @Synchronized public fun get(id: String): Long = mem[id] ?: store?.get(key(id))?.toLongOrNull() ?: 0
    @Synchronized public fun put(id: String, seq: Long) { if (seq <= (mem[id] ?: -1)) return; mem[id] = seq; store?.put(key(id), seq.toString()) }
    @Synchronized public fun reset(id: String) { mem.remove(id); store?.remove(key(id)) }
}

// ---------------------------------------------------------------- the facade

/** A started session and how its mode/model were settled. */
public data class AiStarted(val session: LiveSessionInfo, val result: AiRequestResult)

/**
 * A reply as it streams. [reply] is the kernel's rolling [LiveReply] (the same object, updated in place, for tools and
 * thinking); [text], [status], [error], [done] are snapshots taken for this update. [finished] is true on exactly the
 * update where the reply completed (what read-aloud listens for).
 */
public data class AiReplyUpdate(
    val sessionId: String,
    val reply: LiveReply,
    val item: AiStreamItem,
    val text: String = reply.text,
    val status: String = reply.status,
    val error: String = reply.error,
    val done: Boolean = reply.done,
    val finished: Boolean = false,
)

/**
 * What an app talks to for AI: the mode registry (ai-modes@1), mode resolution per trigger override, UAC gating, the
 * model choice setting and the session client (axHub). Every session is live on the hub; the app only follows it.
 *
 * Policy: when the hub account is known ([refreshAccount]) its answer counts (the hub enforces it); otherwise the
 * local UAC view ([AiPolicies.local]). Nothing here can grant more than the hub allows.
 */
public class AiService(
    public val modes: AiModeRegistry,
    private val client: () -> AiSessionClient,
    private val local: AiPolicySource,
    public val settings: AiSettings,
    public val cursors: AiCursors = AiCursors(null),
    /** model options the app knows (id + tier); empty = the hub's default model */
    private val models: () -> List<ModelOption> = { emptyList() },
) {
    @Volatile private var account: AiHubAccount? = null

    public val sessions: AiSessionClient get() = client()
    public val installed: Boolean get() = client() !== PlaceholderAiSessionClient

    /** Reads the signed-in hub account (GET /me) so gating follows the hub; keeps the last answer when unreachable. */
    public suspend fun refreshAccount(): AxfResult<AiHubAccount> {
        val c = client() as? HubAiSessionClient ?: return AxfResult.err(AxfFailure.NotImplemented("axf.ai.session"))
        return c.account().onOk { account = it }.onErr { if (it is AxfFailure.Denied) account = null }
    }

    public fun account(): AiHubAccount? = account
    public fun forgetAccount() { account = null }

    public fun policy(): AiModePolicy = account?.policy() ?: local.policy()

    /** Modes this user may use, in registry order. */
    public fun availableModes(): List<AiMode> = AiModes.allowed(modes.list(), policy())
    public fun canUse(modeId: String): Boolean = modes.get(modeId)?.let { AiModes.allowed(it, policy()) } ?: false

    /** Which mode a request runs in: the trigger's [override], then [requested] (default: the Mode setting), then chat. */
    public fun resolve(override: String? = null, requested: String? = settings.mode): ModeResolution = AiModes.resolve(modes.list(), policy(), override, requested)

    public fun chooseModel(mode: AiMode): ModelChoice = AiModes.chooseModel(mode, models(), policy(), settings.model.ifEmpty { null })

    /** Mode + model settled for [input]; the Mode and Model settings fill what the input leaves out. */
    public fun prepare(input: AiRequestInput): AiRequestResult {
        val filled = input.copy(requested = input.requested ?: settings.mode, model = input.model ?: settings.model.ifEmpty { null })
        val r = AiModes.buildRequest(modes.list(), policy(), models(), filled)
        // No model options known here: pass the user's pick through only when they may choose models; the hub clamps it again.
        val req = r.request
        val pick = filled.model
        if (req != null && req.model.isEmpty() && !pick.isNullOrEmpty()) {
            val p = policy()
            if (p.admin || ai.amberx.axf.kernel.assistant.AssistantRules.permissionAllows(p.perms, "assistant.models")) return r.copy(request = req.copy(model = pick))
        }
        return r
    }

    /** An input from a fired trigger (triggers@1): `args.mode` is the per-trigger override, the prompt is `args.prompt`/`text`. */
    public fun inputFrom(command: TriggerCommand, context: ChatContext? = null): AiRequestInput {
        fun arg(k: String) = (command.args[k] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() }
        return AiRequestInput(prompt = arg("prompt") ?: arg("text") ?: command.heard ?: "", context = context, triggerId = command.triggerId,
            override = arg("mode"), model = arg("model"), title = arg("title"))
    }

    /** Starts a session in the settled mode on axHub. Denied when the policy allows no mode. */
    public suspend fun start(input: AiRequestInput): AxfResult<AiStarted> {
        if (input.prompt.isBlank()) return AxfResult.err(AxfFailure.Invalid("Say something first.", "prompt"))
        val r = prepare(input)
        val req = r.request ?: return AxfResult.err(AxfFailure.Denied(r.resolution.denied?.let { modes.get(it)?.requiresPermission?.ifEmpty { null } } ?: "ai.modes",
            "Your account can't use ${r.resolution.denied ?: "the assistant"} here."))
        return client().start(req).map { AiStarted(it, r) }
    }

    /** Another turn in a session; [input]'s mode is re-settled (a trigger may switch it per turn). */
    public suspend fun send(id: String, input: AiRequestInput): AxfResult<AiRequestResult> {
        val r = prepare(input)
        val req: AiSessionRequest = r.request ?: return AxfResult.err(AxfFailure.Denied("ai.modes", "Your account can't use ${r.resolution.denied ?: "the assistant"} here."))
        val c = client()
        val sent = if (c is HubAiSessionClient) c.send(id, req) else c.send(id, req.prompt, req.context)
        return sent.map { r }
    }

    public suspend fun list(): AxfResult<List<LiveSessionInfo>> = client().list()
    public suspend fun stop(id: String): AxfResult<Unit> = client().stop(id)
    /** Ends the session on the hub (the only way one ends). */
    public suspend fun close(id: String): AxfResult<Unit> = client().close(id).onOk { cursors.reset(id) }

    /**
     * Follows a session from where this device left off ([after] defaults to the saved cursor) and folds the turn
     * events into a rolling reply. A reload signal (`gap`/`reset`) starts a fresh reply. The cursor is saved as events
     * arrive, so the next [replies] (after an app restart) resumes. Cancelling only detaches.
     */
    public fun replies(id: String, after: Long? = null): Flow<AiReplyUpdate> = flow {
        val c = client() as? HubAiSessionClient
        if (c == null) { emit(AiReplyUpdate(id, LiveReply("AI sessions aren't available here.").apply { error = "\"axf.ai.session\" is declared but not built yet."; done = true }, AiStreamItem.Failed(AxfFailure.NotImplemented("axf.ai.session")))); return@flow }
        var reply = LiveReply()
        c.events(id, after ?: cursors.get(id)).collect { item ->
            val wasDone = reply.done
            when (item) {
                is AiStreamItem.Replay -> if (item.replay.reset || item.replay.gap) { reply = LiveReply(); if (item.replay.reset) cursors.reset(id) }
                is AiStreamItem.Event -> {
                    val e = item.event
                    if (e.kind == "start" || (e.kind == LiveKinds.TURN_START && reply.done)) reply = LiveReply()
                    reply.apply(StreamEvent(e.kind, e.data, e.seq))
                    cursors.put(id, e.seq)
                }
                is AiStreamItem.Failed -> { reply.error = item.failure.message; reply.status = "" }
                is AiStreamItem.Reconnecting -> reply.status = "Reconnecting…"
                is AiStreamItem.Ended -> { reply.status = "Session closed"; reply.done = true }
                is AiStreamItem.Idle -> {}
            }
            emit(AiReplyUpdate(id, reply, item, finished = item is AiStreamItem.Event && !wasDone && reply.done && !(item.event.kind == "start" || item.event.kind == LiveKinds.TURN_START)))
        }
    }

    /** True when a finished reply should be spoken (the Read aloud setting); speaking itself is speech@1's job. */
    public fun shouldReadAloud(update: AiReplyUpdate): Boolean = settings.readAloud && update.finished && update.error.isEmpty() && update.text.isNotBlank()
}
