package ai.amberx.axf.kernel.assistant

import ai.amberx.axf.kernel.asset.AxfJson
import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strMap
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.live.LiveReplay
import ai.amberx.axf.kernel.live.LiveSessionInfo
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/*
 * AI assistant — assistant@1 (kernel API level 1). Same design as the web reference framework/core/assistant.ts and the
 * console plugin's Python contract.py; conformance fixtures spec/fixtures/assistant.json (AssistantConformanceTest).
 *
 * The kernel ships the contract every AXF assistant shares: the provider registry (framework/schemas/ai-providers.json,
 * a kernel resource), the canonical message + turn event shapes, the conversation record (ai-conversation@1) and the
 * pure rules every port applies the same way (secret redaction, history window, profile chain, user settings and
 * params, permission wildcards, batch titles, tool summaries, SSE framing, the live-reply fold). The chat engine
 * itself (providers, tools, sessions) is a module; an Android assistant UI talks to it through [AssistantClient].
 */

public const val ASSISTANT_CONTRACT: String = "assistant@1"
public const val CONVERSATION_CONTRACT: String = "ai-conversation@1"
/** Capability the chat engine registers under. */
public const val LLM_CAPABILITY: String = "axf.llm"

/** Compact JSON (no pretty print), so summaries and SSE lines match the web reference byte for byte. */
internal val CompactJson: Json = Json { ignoreUnknownKeys = true; isLenient = true; explicitNulls = false; encodeDefaults = true }

public data class ProviderKind(
    val kind: String,
    val label: String,
    val protocol: String,
    val baseUrl: String,
    val keyEnv: String,
    val auth: String,
    val models: List<String> = emptyList(),
    val keyUrl: String = "",
    val vision: Boolean = false,
    val tools: Boolean = true,
    val local: Boolean = false,
    val note: String? = null,
    val noModelList: Boolean = false,
    val noStreamUsage: Boolean = false,
    val maxTokensField: String? = null,
    val headers: Map<String, String> = emptyMap(),
    val embedModel: String? = null,
) {
    public companion object {
        public fun fromJson(o: JsonObject): ProviderKind = ProviderKind(
            kind = o.str("kind"), label = o.str("label"), protocol = o.str("protocol", "openai"), baseUrl = o.str("baseUrl"), keyEnv = o.str("keyEnv"),
            auth = o.str("auth", "bearer"), models = o.strList("models"), keyUrl = o.str("keyUrl"), vision = o.bool("vision"), tools = o.bool("tools", true),
            local = o.bool("local"), note = o["note"]?.let { (it as? JsonPrimitive)?.content }, noModelList = o.bool("noModelList"), noStreamUsage = o.bool("noStreamUsage"),
            maxTokensField = o["maxTokensField"]?.let { (it as? JsonPrimitive)?.content }, headers = o.strMap("headers"), embedModel = o["embedModel"]?.let { (it as? JsonPrimitive)?.content },
        )
    }
}

/** The framework's provider registry (ai-providers@1); open: an app merges its own kinds on top with [merge]. */
public object ProviderRegistry {
    public val protocols: Map<String, String> by lazy { raw?.strMap("protocols") ?: emptyMap() }
    public val kinds: List<ProviderKind> by lazy { raw?.objList("providers")?.map(ProviderKind::fromJson) ?: emptyList() }
    private val raw: JsonObject? by lazy {
        ProviderRegistry::class.java.getResourceAsStream("/ai-providers.json")?.bufferedReader()?.readText()?.parseJsonObject()
    }
    public fun get(kind: String, kinds: List<ProviderKind> = this.kinds): ProviderKind? = kinds.firstOrNull { it.kind == kind }
    /** Framework kinds plus an app's own; a later kind with the same id replaces the earlier. */
    public fun merge(vararg lists: List<ProviderKind>): List<ProviderKind> {
        val out = LinkedHashMap<String, ProviderKind>()
        for (l in lists) for (k in l) if (k.kind.isNotEmpty()) out[k.kind] = k
        return out.values.toList()
    }
}

// ---------------------------------------------------------------- canonical chat

public data class ChatImage(val mediaType: String, val data: String, val name: String? = null)
public data class ToolCall(val id: String, val name: String, val arguments: JsonObject = JsonObject(emptyMap()))
public data class ToolSpec(val name: String, val description: String, val parameters: JsonObject? = null)

/** The one message shape every protocol maps to (and back). */
public data class WireMessage(
    val role: String,
    val content: String,
    val images: List<ChatImage> = emptyList(),
    val toolCalls: List<ToolCall> = emptyList(),
    val thinkingBlocks: List<JsonObject> = emptyList(),
    val toolCallId: String? = null,
    val isError: Boolean? = null,
)

public data class ToolLogEntry(val id: String, val name: String, val input: String, val ok: Boolean, val preview: String)

public data class MessageMeta(
    val step: Boolean = false,
    val profile: String = "",
    val model: String = "",
    val latencyMs: Long = 0,
    val usageInput: Long = 0,
    val usageOutput: Long = 0,
    val tools: List<ToolLogEntry> = emptyList(),
    val agentId: String = "",
    val agentName: String = "",
    val stopped: Boolean = false,
    val interrupted: Boolean = false,
    val thinking: String = "",
    val batch: String = "",
    val lastRound: String? = null,
)

/** A stored message (ai-conversation@1). `meta.step` marks an intermediate assistant round with tool calls. */
public data class Message(
    val id: String,
    val role: String,
    val content: String,
    val createdAt: Long,
    val images: List<ChatImage> = emptyList(),
    val toolCalls: List<ToolCall> = emptyList(),
    val toolCallId: String? = null,
    val isError: Boolean = false,
    val thinkingBlocks: List<JsonObject> = emptyList(),
    val meta: MessageMeta = MessageMeta(),
) {
    public companion object {
        public fun fromJson(o: JsonObject): Message {
            val meta = o.obj("meta")
            return Message(
                id = o.str("id"), role = o.str("role"), content = o.str("content"), createdAt = (o["createdAt"] as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0L,
                images = o.objList("images").map { ChatImage(it.str("media_type"), it.str("data"), it["name"]?.let { n -> (n as? JsonPrimitive)?.content }) },
                toolCalls = o.objList("toolCalls").map { ToolCall(it.str("id"), it.str("name"), it.obj("arguments") ?: JsonObject(emptyMap())) },
                toolCallId = o["toolCallId"]?.let { (it as? JsonPrimitive)?.content }, isError = o.bool("isError"),
                thinkingBlocks = o.objList("thinkingBlocks"),
                meta = MessageMeta(step = meta?.bool("step") ?: false, lastRound = meta?.get("lastRound")?.let { (it as? JsonPrimitive)?.takeUnless { p -> p is JsonNull }?.content }),
            )
        }
    }
}

/**
 * What the app attaches to a turn: the view it was sent from, its title, selected text, a note — plus [extra], an open
 * bag for host-specific context (Build Pilot's `projectId`, …). Well-known keys live in [ChatContextKeys]; any other
 * key passes through untouched. [ChatContextRules.normalize] is the rule every port applies before storing or using a
 * context (sizes capped, bad shapes dropped) — fixture `chatContext` in spec/fixtures/assistant.json.
 */
public data class ChatContext(
    val view: String? = null,
    val title: String? = null,
    val selection: String? = null,
    val note: String? = null,
    val extra: JsonObject? = null,
) {
    /** A well-known `extra` value as a string (empty when absent or not a string); how a host reads `projectId`. */
    public fun extraString(key: String): String {
        val v = extra?.get(key) as? JsonPrimitive ?: return ""
        return if (v.isString) v.content else ""
    }

    public fun toJson(): JsonObject {
        val m = LinkedHashMap<String, JsonElement>()
        if (view != null) m["view"] = JsonPrimitive(view)
        if (title != null) m["title"] = JsonPrimitive(title)
        if (selection != null) m["selection"] = JsonPrimitive(selection)
        if (note != null) m["note"] = JsonPrimitive(note)
        if (extra != null) m["extra"] = extra
        return JsonObject(m)
    }

    public companion object {
        /** Parses then normalises (never trusts the wire). */
        public fun fromJson(o: JsonElement?): ChatContext? = ChatContextRules.normalize(o)
    }
}

/** Well-known `ChatContext.extra` keys (documented in spec/ASSISTANT.md); hosts may add their own. */
public object ChatContextKeys {
    /** id of the project the chat is about (Build Pilot); 1–64 chars */
    public const val PROJECT_ID: String = "projectId"
    /** id of the app (`axf.manifest.json` name or project manifest name) the chat is about */
    public const val APP_ID: String = "appId"
    /** path of the file the user is looking at, relative to the app */
    public const val PATH: String = "path"
    /** route/page id when `view` is not enough */
    public const val ROUTE: String = "route"
    public val ALL: List<String> = listOf(PROJECT_ID, APP_ID, PATH, ROUTE)
}

/** Size limits for a context (the same on every port, so a context can't be abused as a payload channel). */
public object ChatContextRules {
    public const val VIEW: Int = 200
    public const val TITLE: Int = 300
    public const val SELECTION: Int = 4000
    public const val NOTE: Int = 2000
    /** at most this many keys in `extra` (and items in an array inside it) */
    public const val EXTRA_KEYS: Int = 32
    /** a string value in `extra` is cut to this length */
    public const val EXTRA_STRING: Int = 2000
    /** `extra` serialised as compact JSON may not exceed this many characters */
    public const val EXTRA_JSON: Int = 16_000
    /** nesting depth allowed inside an `extra` value (objects/arrays) */
    public const val EXTRA_DEPTH: Int = 4
    private val EXTRA_KEY: Regex = Regex("^[A-Za-z0-9_.-]{1,64}$")

    /** A string-typed field of the raw context, or null when absent, empty or not a string. */
    private fun field(o: JsonObject, key: String, max: Int): String? {
        val p = o[key] as? JsonPrimitive ?: return null
        if (!p.isString || p.content.isEmpty()) return null
        return p.content.take(max)
    }

    /** Bounded copy of a value inside `extra`; null = dropped (too deep, not a finite number, not JSON-shaped). */
    private fun boundedPrimitive(v: JsonPrimitive): JsonElement? {
        if (v is JsonNull) return v
        if (v.isString) return JsonPrimitive(v.content.take(EXTRA_STRING))
        if (v.booleanOrNull != null) return v
        val d = v.doubleOrNull ?: return null
        return if (d.isFinite()) v else null
    }

    private fun boundedArray(v: JsonArray, depth: Int): JsonElement? {
        if (depth >= EXTRA_DEPTH) return null
        val out = ArrayList<JsonElement>()
        for (x in v.take(EXTRA_KEYS)) {
            val b = bounded(x, depth + 1)
            if (b != null) out.add(b)
        }
        return JsonArray(out)
    }

    private fun boundedObject(v: JsonObject, depth: Int): JsonObject? {
        if (depth >= EXTRA_DEPTH) return null
        val out = LinkedHashMap<String, JsonElement>()
        for ((k, x) in v.entries) {
            if (!EXTRA_KEY.matches(k)) continue
            val b = bounded(x, depth + 1) ?: continue
            out[k] = b
            if (out.size >= EXTRA_KEYS) break
        }
        return JsonObject(out)
    }

    private fun bounded(v: JsonElement, depth: Int): JsonElement? = when (v) {
        is JsonPrimitive -> boundedPrimitive(v)
        is JsonArray -> boundedArray(v, depth)
        is JsonObject -> boundedObject(v, depth)
    }

    /**
     * The context a host stores and uses: known fields cut to their limits, `extra` kept as an open bag with every key
     * it came with (unknown keys preserved, in order) but bounded: key pattern, ≤ 32 keys, strings ≤ 2000, depth ≤ 4,
     * ≤ 16 000 JSON characters in all (an oversized `extra` is dropped whole, never truncated into a different meaning).
     * Null for anything that isn't an object or has nothing left. Same answers as `normalizeChatContext` (web) and
     * `normalize_chat_context` (Python).
     */
    public fun normalize(raw: JsonElement?): ChatContext? {
        val o = raw as? JsonObject ?: return null
        val view = field(o, "view", VIEW)
        val title = field(o, "title", TITLE)
        val selection = field(o, "selection", SELECTION)
        val note = field(o, "note", NOTE)
        var extra: JsonObject? = null
        val rawExtra = o["extra"] as? JsonObject
        if (rawExtra != null) {
            val b = boundedObject(rawExtra, 0)
            if (b != null && b.isNotEmpty() && CompactJson.encodeToString(JsonObject.serializer(), b).length <= EXTRA_JSON) extra = b
        }
        if (view == null && title == null && selection == null && note == null && extra == null) return null
        return ChatContext(view, title, selection, note, extra)
    }
}

public data class ConversationSettings(
    val profileId: String? = null,
    val model: String? = null,
    val temperature: Double? = null,
    val maxTokens: Int? = null,
    val topP: Double? = null,
    val systemPrompt: String? = null,
    val agentId: String? = null,
    val tools: Boolean? = null,
    val thinking: Boolean? = null,
)

/** Setting keys as the wire spells them (same order as the web reference). */
public val CONVERSATION_SETTING_KEYS: List<String> = listOf("profileId", "model", "temperature", "max_tokens", "top_p", "systemPrompt", "agentId", "tools", "thinking")

public data class Conversation(
    val id: String,
    val title: String,
    val createdAt: Long,
    val updatedAt: Long,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val tags: List<String> = emptyList(),
    val settings: ConversationSettings = ConversationSettings(),
    val messages: List<Message> = emptyList(),
    val owner: String? = null,
)

public data class ConversationSummary(
    val id: String, val title: String, val pinned: Boolean, val archived: Boolean, val tags: List<String>, val updatedAt: Long,
    val messages: Int, val agentId: String, val owner: String = "", val preview: String = "",
)

public data class WriteMode(val containers: List<String>, val snapshots: Boolean)
public data class AgentRef(val id: String, val name: String, val icon: String? = null, val description: String? = null, val writeMode: WriteMode? = null)

/** One event of a reply stream: a turn event (start/text/thinking/status/tool/batch/error/done) or a live-session frame. */
public data class StreamEvent(val event: String, val data: JsonElement?, val seq: Long? = null)

public val TURN_EVENT_KINDS: List<String> = listOf("start", "text", "thinking", "status", "tool", "error", "batch", "done")

// ---------------------------------------------------------------- pure rules (fixture-checked on every port)

public object AssistantRules {
    /** Keys and tokens that must never leave the app in a message. */
    public val SECRET: Regex = Regex("\\b(sk-(?:ant-|proj-)?[A-Za-z0-9_\\-]{20,}|xai-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\\-]{30,}|fc-[a-f0-9]{24,})\\b")
    public const val REDACTED: String = "[redacted secret]"
    public const val USER_MAX_TOKENS: Int = 4096
    public const val USER_MAX_TOKENS_WITH_MODELS: Int = 16384
    public const val RECONNECT_ATTEMPTS: Int = 8

    public fun redactSecrets(text: String, on: Boolean = true): String = if (on && text.isNotEmpty()) SECRET.replace(text, REDACTED) else text

    /** The window of stored messages sent to a model (see the web reference for the rules). */
    public fun wireHistory(msgs: List<Message>, limit: Int): List<WireMessage> {
        val keep = ArrayList<Message>()
        var turns = 0
        for (m in msgs.asReversed()) {
            if (m.role == "user") turns++
            keep.add(m)
            if (turns >= limit) break
        }
        keep.reverse()
        while (keep.isNotEmpty() && keep.first().role == "tool") keep.removeAt(0)
        return keep.mapIndexed { i, m ->
            var content = m.content
            val prev = if (i > 0) keep[i - 1] else null
            if (m.role == "assistant" && !m.meta.step && prev != null && prev.role == "tool") content = m.meta.lastRound ?: content
            WireMessage(
                role = m.role, content = content, images = m.images, toolCalls = m.toolCalls, thinkingBlocks = m.thinkingBlocks,
                toolCallId = if (m.role == "tool") (m.toolCallId ?: "") else null, isError = if (m.role == "tool") m.isError else null,
            )
        }
    }

    /** Profiles to try in order: the conversation's, else the agent's, else the default, then the fallbacks (no repeats). */
    public fun profileChain(settingsProfile: String?, agentProfile: String?, defaultProfile: String, fallback: List<String>): List<String> {
        val first = settingsProfile?.takeIf { it.isNotEmpty() } ?: agentProfile?.takeIf { it.isNotEmpty() } ?: defaultProfile
        val out = (listOf(first) + fallback).filter { it.isNotEmpty() }.distinct()
        return out.ifEmpty { listOf("") }
    }

    /** Admins may set every conversation setting; users only what their hub permissions allow. */
    public fun settingsAllowedFor(admin: Boolean, can: (String) -> Boolean): List<String> {
        if (admin) return CONVERSATION_SETTING_KEYS
        val keys = mutableListOf("temperature", "top_p", "systemPrompt", "tools")
        if (can("assistant.agents")) keys += "agentId"
        if (can("assistant.models")) keys += listOf("profileId", "model", "max_tokens", "thinking")
        return keys
    }

    /** Permission check with `a.b.*` wildcards and `*`; admins always pass. */
    public fun permissionAllows(perms: Collection<String>, perm: String, admin: Boolean = false): Boolean {
        if (admin) return true
        val set = perms.toSet()
        if ("*" in set || perm in set) return true
        val parts = perm.split(".")
        for (i in 1 until parts.size) if (parts.subList(0, i).joinToString(".") + ".*" in set) return true
        return false
    }

    /** Non-admin callers: max_tokens clamped and thinking off without assistant.models. Values are JSON so any param passes through. */
    public fun clampUserParams(params: JsonObject, admin: Boolean, canModels: Boolean): JsonObject {
        if (admin) return params
        val out = LinkedHashMap<String, JsonElement>(params)
        val raw = (params["max_tokens"] as? JsonPrimitive)?.doubleOrNull
        val n = if (raw != null && raw > 0 && raw.isFinite()) raw.toLong() else USER_MAX_TOKENS.toLong()
        val cap = if (canModels) USER_MAX_TOKENS_WITH_MODELS else USER_MAX_TOKENS
        out["max_tokens"] = JsonPrimitive(maxOf(256L, minOf(n, cap.toLong())))
        if (!canModels) out["thinking"] = JsonPrimitive(false)
        return JsonObject(out)
    }

    public fun batchTitle(userText: String, n: Int): String {
        val t = userText.replace(Regex("\\s+"), " ").trim()
        val count = "$n change${if (n == 1) "" else "s"}"
        return if (t.isEmpty()) count else "$count: ${t.take(80)}${if (t.length > 80) "…" else ""}"
    }

    private val SUMMARY_KEYS = listOf("path", "command", "pattern", "url", "query", "expression", "dir", "name", "id", "container")

    /** One line describing a tool call's arguments (never the full content). */
    public fun summarizeArgs(args: JsonObject): String {
        for (k in SUMMARY_KEYS) {
            val v = args[k] as? JsonPrimitive ?: continue
            if (v.isString && v.content.isNotEmpty()) return v.content.take(160)
        }
        val s = CompactJson.encodeToString(JsonObject.serializer(), args).take(160)
        return if (s == "{}") "" else s
    }

    public fun titleFromText(text: String, max: Int = 60): String = text.replace(Regex("\\s+"), " ").trim().take(max)

    /** Owner event kinds written to a live session must never pose as lifecycle kinds. */
    public fun ownerKind(kind: String, reserved: Collection<String> = LiveKinds.ALL): String = if (kind in reserved) "owner.$kind" else kind

    /** Reconnect delay after the n-th failed attempt (1-based): 1 s, 2 s, 4 s … capped. */
    public fun reconnectDelayMs(attempt: Int, capMs: Long = 30_000): Long {
        var d = 500L
        repeat(maxOf(1, attempt)) { d *= 2; if (d >= capMs) return capMs }
        return minOf(capMs, d)
    }
}

// ---------------------------------------------------------------- SSE framing

public data class SseFrame(val event: String, val data: String, val id: Long? = null)

public object Sse {
    /** One `event:`/`data:`/`id:` block → frame; null when the block carries no data. */
    public fun parseBlock(block: String): SseFrame? {
        var event = "message"
        val data = ArrayList<String>()
        var id: Long? = null
        for (line in block.split("\n")) {
            when {
                line.startsWith(":") -> {}
                line.startsWith("event:") -> event = line.substring(6).trim()
                line.startsWith("data:") -> data += line.substring(5).removePrefix(" ")
                line.startsWith("id:") -> line.substring(3).trim().toLongOrNull()?.takeIf { it > 0 }?.let { id = it }
            }
        }
        if (data.isEmpty()) return null
        return SseFrame(event, data.joinToString("\n"), id)
    }

    /** Frames out of a text; `rest` is the unfinished tail to keep for the next chunk. */
    public fun parseText(text: String): Pair<List<SseFrame>, String> {
        val frames = ArrayList<SseFrame>()
        var buf = text.replace("\r\n", "\n")
        while (true) {
            val i = buf.indexOf("\n\n")
            if (i < 0) break
            parseBlock(buf.substring(0, i))?.let(frames::add)
            buf = buf.substring(i + 2)
        }
        return frames to buf
    }

    public fun toEvent(f: SseFrame): StreamEvent {
        val data: JsonElement = runCatching { AxfJson.parseToJsonElement(f.data) }.getOrElse { JsonPrimitive(f.data) }
        return StreamEvent(f.event, data, f.id)
    }

    public fun line(event: String, data: JsonElement?, id: Long? = null): String =
        (if (id != null) "id: $id\n" else "") + "event: $event\ndata: ${CompactJson.encodeToString(JsonElement.serializer(), data ?: JsonNull)}\n\n"
}

// ---------------------------------------------------------------- live reply (reattach + replay for any chat UI)

public data class LiveTool(val id: String, val name: String, val input: String? = null, var ok: Boolean? = null, var preview: String? = null, var done: Boolean = false)

/** Rolling state of the reply being watched; a view renders it and nothing else. */
public class LiveReply(status: String = "Connecting…", agent: String = "") {
    public var turnId: String = ""
    public var text: String = ""
    public var status: String = status
    public var thinking: String = ""
    public var error: String = ""
    public var agent: String = agent
    public val tools: MutableList<LiveTool> = ArrayList()
    public var lastSeq: Long = 0
    public var done: Boolean = false

    /** Fold one stream event in (same rules as the web reference `applyStreamEvent`). */
    public fun apply(e: StreamEvent): LiveReply {
        e.seq?.let { lastSeq = maxOf(lastSeq, it) }
        val d = e.data as? JsonObject
        when (e.event) {
            "start" -> { turnId = d?.str("turnId") ?: ""; d?.obj("agent")?.str("name")?.takeIf { it.isNotEmpty() }?.let { agent = it } }
            "text" -> text += d?.str("text") ?: ""
            "thinking" -> thinking += d?.str("text") ?: ""
            "status" -> status = d?.str("text") ?: ""
            "tool" -> if (d != null) {
                if (d.str("phase") == "call") {
                    if (text.isNotEmpty() && !text.endsWith("\n")) text += "\n\n"
                    tools += LiveTool(d.str("id"), d.str("name"), d["input"]?.let { (it as? JsonPrimitive)?.content })
                } else tools.firstOrNull { it.id == d.str("id") }?.let { t ->
                    t.ok = (d["ok"] as? JsonPrimitive)?.booleanOrNull; t.preview = d["preview"]?.let { (it as? JsonPrimitive)?.content }; t.done = true
                }
            }
            "error" -> error = d?.str("message") ?: ""
            "done" -> done = true
            LiveKinds.INTERRUPTED -> { error = "The host restarted while this reply was running."; done = true }
            LiveKinds.TURN_END -> done = true
            "replay" -> if (d?.bool("reset") == true) lastSeq = 0
            else -> {}
        }
        return this
    }
}

// ---------------------------------------------------------------- client (what an app's chat UI talks to)

public data class TurnInput(val content: String? = null, val images: List<ChatImage> = emptyList(), val context: ChatContext? = null, val editMessageId: String? = null, val regenerate: Boolean = false)

public data class ConversationPatch(val title: String? = null, val pinned: Boolean? = null, val archived: Boolean? = null, val tags: List<String>? = null, val settings: JsonObject? = null)

/** Returned by [AssistantClient.send] / [AssistantClient.follow]; detaching never stops the reply. */
public fun interface Watch { public fun detach() }

/**
 * Transport-agnostic assistant client (the console plugin's HTTP + SSE API is the reference; an Android module
 * implements the same methods over HTTP, AXPP or in-process). Replies are live sessions: `send` only watches,
 * `follow` reattaches by seq, and detaching never stops the reply.
 */
public interface AssistantClient {
    public suspend fun status(): AxfResult<JsonObject>
    public suspend fun listConversations(q: String = "", archived: Boolean = false): AxfResult<List<ConversationSummary>>
    public suspend fun createConversation(settings: JsonObject? = null, title: String? = null): AxfResult<Conversation>
    public suspend fun getConversation(id: String): AxfResult<Conversation>
    public suspend fun patchConversation(id: String, patch: ConversationPatch): AxfResult<Conversation>
    public suspend fun deleteConversation(id: String): AxfResult<Unit>
    public suspend fun fork(id: String, messageId: String? = null): AxfResult<Conversation>
    public suspend fun deleteMessage(id: String, messageId: String): AxfResult<Conversation>
    public suspend fun send(id: String, input: TurnInput, onEvent: (StreamEvent) -> Unit): AxfResult<Watch>
    public suspend fun follow(id: String, since: Long, onEvent: (StreamEvent) -> Unit): AxfResult<Watch>
    public suspend fun session(id: String): AxfResult<LiveSessionInfo?>
    public suspend fun events(id: String, since: Long, max: Int = 500): AxfResult<LiveReplay>
    public suspend fun stop(id: String): AxfResult<Boolean>
    public suspend fun closeSession(id: String): AxfResult<Boolean>
}

/** Parse helpers for the wire shapes an [AssistantClient] implementation receives. */
public object AssistantWire {
    public fun conversation(o: JsonObject): Conversation {
        val s = o.obj("settings")
        return Conversation(
            id = o.str("id"), title = o.str("title"), createdAt = (o["createdAt"] as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0L,
            updatedAt = (o["updatedAt"] as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0L, pinned = o.bool("pinned"), archived = o.bool("archived"), tags = o.strList("tags"),
            settings = ConversationSettings(
                profileId = s?.get("profileId")?.let { (it as? JsonPrimitive)?.content }, model = s?.get("model")?.let { (it as? JsonPrimitive)?.content },
                temperature = (s?.get("temperature") as? JsonPrimitive)?.doubleOrNull, maxTokens = (s?.get("max_tokens") as? JsonPrimitive)?.doubleOrNull?.toInt(),
                topP = (s?.get("top_p") as? JsonPrimitive)?.doubleOrNull, systemPrompt = s?.get("systemPrompt")?.let { (it as? JsonPrimitive)?.content },
                agentId = s?.get("agentId")?.let { (it as? JsonPrimitive)?.content }, tools = (s?.get("tools") as? JsonPrimitive)?.booleanOrNull, thinking = (s?.get("thinking") as? JsonPrimitive)?.booleanOrNull,
            ),
            messages = o.objList("messages").map(Message::fromJson), owner = o["owner"]?.let { (it as? JsonPrimitive)?.content },
        )
    }

    public fun summary(o: JsonObject): ConversationSummary = ConversationSummary(
        id = o.str("id"), title = o.str("title"), pinned = o.bool("pinned"), archived = o.bool("archived"), tags = o.strList("tags"),
        updatedAt = (o["updatedAt"] as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0L, messages = (o["messages"] as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 0,
        agentId = o.str("agentId"), owner = o.str("owner"), preview = o.str("preview"),
    )

    public fun parse(text: String): JsonObject? = text.parseJsonObject()
    public fun element(text: String): JsonElement = AxfJson.parseToJsonElement(text)
    public fun JsonElement.asObject(): JsonObject = jsonObject
    public fun JsonElement.asString(): String = jsonPrimitive.content
}
