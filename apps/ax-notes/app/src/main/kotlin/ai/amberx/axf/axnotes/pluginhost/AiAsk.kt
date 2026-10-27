package ai.amberx.axf.axnotes.pluginhost

import ai.amberx.axf.kernel.ai.AiMode
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.engine.ActionContext
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * One question, one answer, through the kernel AI contract (ai-modes@1). Plugins code only against [AiSessionClient];
 * lib-ai (or the axHub host) implements it. Until one is registered the kernel's placeholder answers "not available"
 * and every plugin falls back to its local rules.
 *
 * Flow: resolve mode + model ([AiModes.buildRequest]) → `start` → read the session's `text` events with `stream`
 * until `turn.end` (or `interrupted` / `session.close`) → `close`. Times out after [timeoutMs] (the turn is stopped).
 */
class AiAsk(
    private val client: AiSessionClient,
    private val modes: () -> List<AiMode> = { AiModes.BUILTINS },
    private val policy: AiModePolicy = LOCAL_POLICY,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun available(): Boolean = runCatching { client.available() }.getOrDefault(false)

    suspend fun ask(input: AiRequestInput, timeoutMs: Long = 60_000, pollMs: Long = 500): AxfResult<String> {
        if (!available()) return AxfResult.err(AxfFailure.Unavailable("AI isn't connected (${client.host})."))
        val built = AiModes.buildRequest(modes(), policy, emptyList(), input)
        val request = built.request ?: return AxfResult.err(AxfFailure.Denied(input.requested ?: AiModes.DEFAULT_MODE))
        // A plugin that asked for a mode gets that mode or nothing (no silent fallback to another mode).
        val wanted = input.requested
        if (wanted != null && request.mode != wanted) return AxfResult.err(AxfFailure.Denied(wanted))
        val info = when (val r = client.start(request)) { is AxfResult.Ok -> r.value; is AxfResult.Err -> return r }
        val text = StringBuilder()
        var after = 0L
        val deadline = clock() + timeoutMs
        try {
            while (true) {
                val replay = when (val r = client.stream(info.id, after)) { is AxfResult.Ok -> r.value; is AxfResult.Err -> return r }
                var done = false
                for (e in replay.events) {
                    if (e.seq > after) after = e.seq
                    when (e.kind) {
                        "text" -> text.append(textOf(e.data))
                        "error" -> return AxfResult.err(AxfFailure.Unavailable(textOf(e.data).ifBlank { "The AI session failed." }))
                        LiveKinds.TURN_END, LiveKinds.INTERRUPTED, LiveKinds.CLOSE -> done = true
                    }
                }
                if (done) break
                if (clock() >= deadline) {
                    withContext(NonCancellable) { runCatching { client.stop(info.id) } }
                    return AxfResult.err(AxfFailure.Unavailable("The AI didn't answer in time."))
                }
                if (!replay.more) sleep(pollMs)
            }
        } finally {
            withContext(NonCancellable) { runCatching { client.close(info.id) } }
        }
        return AxfResult.ok(text.toString())
    }

    companion object {
        /**
         * AX Notes is a one-person app: locally it may use chat and read-codebase (read-only). The hub still checks the
         * caller's real permissions (`ai.read`) server-side. A host that knows better registers an [AiModePolicy] service.
         */
        val LOCAL_POLICY: AiModePolicy = AiModePolicy(admin = false, perms = listOf("ai.read"), allowedModes = listOf(AiModes.CHAT, AiModes.READ_CODEBASE))

        fun textOf(data: JsonElement?): String = when (data) {
            is JsonObject -> (data["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: (data["message"] as? JsonPrimitive)?.content ?: ""
            is JsonPrimitive -> if (data.isString) data.content else ""
            else -> ""
        }
    }
}

/**
 * Arguments of an action, whoever fired it: a menu (`id:a:b` → "0" = a, "1" = b), a trigger (triggers@1 command args
 * as `extras["args"]` JsonObject, or a JSON object payload). Later sources win.
 */
object ActionArgs {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    fun of(args: List<String>, ctx: ActionContext?): JsonObject {
        val out = LinkedHashMap<String, JsonElement>()
        args.forEachIndexed { i, a -> out[i.toString()] = JsonPrimitive(a) }
        val payload = ctx?.payload?.trim()
        if (payload != null && payload.startsWith("{")) runCatching { json.parseToJsonElement(payload) as? JsonObject }.getOrNull()?.let { out.putAll(it) }
        (ctx?.extras?.get("args") as? JsonObject)?.let { out.putAll(it) }
        return JsonObject(out)
    }

    fun str(a: JsonObject, vararg keys: String): String? = keys.firstNotNullOfOrNull { k -> (a[k] as? JsonPrimitive)?.content?.trim()?.takeIf { it.isNotEmpty() } }
    fun int(a: JsonObject, vararg keys: String): Int? = str(a, *keys)?.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 && it < 10_000_000 }?.toInt()
}
