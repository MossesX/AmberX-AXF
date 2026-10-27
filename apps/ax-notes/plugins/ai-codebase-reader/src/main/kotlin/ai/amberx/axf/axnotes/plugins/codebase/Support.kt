package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.kernel.ai.AiMode
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * Plugin-local helpers (pure). A plugin never imports app classes, so the few text / JSON / AI helpers it needs live
 * here; the note-sorter plugin carries its own copy.
 */

/** Small JSON readers. */
internal object J {
    fun str(o: JsonObject?, k: String): String? = (o?.get(k) as? JsonPrimitive)?.takeIf { it.isString }?.content
    fun text(o: JsonObject?, k: String, max: Int): String = (str(o, k) ?: "").trim().take(max)
    fun long(o: JsonObject?, k: String): Long? = (o?.get(k) as? JsonPrimitive)?.takeUnless { it is JsonNull }?.content?.toDoubleOrNull()?.takeIf { it.isFinite() }?.toLong()
    fun int(o: JsonObject?, k: String): Int? = long(o, k)?.takeIf { it in Int.MIN_VALUE..Int.MAX_VALUE }?.toInt()
    fun bool(o: JsonObject?, k: String): Boolean? = (o?.get(k) as? JsonPrimitive)?.takeUnless { it.isString }?.content?.toBooleanStrictOrNull()
    fun strings(e: JsonElement?, max: Int = 1000): List<String> =
        (e as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }?.take(max) ?: emptyList()
    fun objects(e: JsonElement?, max: Int = 2000): List<JsonObject> = (e as? JsonArray)?.mapNotNull { it as? JsonObject }?.take(max) ?: emptyList()
    fun arr(l: List<String>): JsonArray = JsonArray(l.map(::JsonPrimitive))
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    fun parse(s: String?): JsonObject? = s?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
}

/** Pulls the JSON object out of an AI reply (plain JSON, a ```json fence, or JSON inside prose). */
internal object ReplyJson {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    fun extract(text: String): JsonObject? {
        val t = text.take(400_000)
        var from = t.indexOf('{')
        var tries = 0
        while (from >= 0 && tries < 20) {
            val end = closing(t, from)
            if (end > from) runCatching { json.parseToJsonElement(t.substring(from, end + 1)) as? JsonObject }.getOrNull()?.let { return it }
            from = t.indexOf('{', from + 1)
            tries++
        }
        return null
    }

    private fun closing(s: String, start: Int): Int {
        var depth = 0; var inString = false; var escaped = false
        for (i in start until s.length) {
            val c = s[i]
            if (inString) { when { escaped -> escaped = false; c == '\\' -> escaped = true; c == '"' -> inString = false }; continue }
            when (c) { '"' -> inString = true; '{' -> depth++; '}' -> { depth--; if (depth == 0) return i } }
        }
        return -1
    }
}

/** Stable short hash (FNV-1a 64, hex). */
internal object Hashes {
    fun fnv64(s: String): String {
        var h = -0x340d631b7bdddcdbL
        for (b in s.toByteArray(Charsets.UTF_8)) { h = h xor (b.toLong() and 0xff); h *= 0x100000001b3L }
        return java.lang.Long.toUnsignedString(h, 16).padStart(16, '0')
    }
}

/** Text helpers (same rules as the app's model: lower case, "to-do" = "todo", punctuation dropped). */
internal object Txt {
    private val PUNCT = Regex("[^\\p{L}\\p{N}\\s]")
    private val SPACES = Regex("\\s+")

    fun normalize(s: String): String {
        var t = s.lowercase().replace("to-do", "todo")
        t = PUNCT.replace(t, " ")
        return SPACES.replace(t, " ").trim().replace(Regex("\\bto do(s?)\\b"), "todo$1")
    }

    fun tokens(s: String): List<String> = normalize(s).split(' ').filter { it.isNotEmpty() }

    fun titleFrom(text: String, words: Int = 6): String {
        val first = text.trim().split(Regex("(?<=[.!?])\\s+|\\n")).firstOrNull { it.isNotBlank() }?.trim() ?: return "Untitled note"
        val w = first.split(SPACES).filter { it.isNotEmpty() }
        val t = w.take(words).joinToString(" ").trimEnd('.', ',', ';', ':', '!', '?')
        return (if (w.size > words) "$t…" else t).replaceFirstChar { it.uppercase() }.ifBlank { "Untitled note" }
    }

    fun stem(w: String): String = when {
        w.length > 4 && w.endsWith("ies") -> w.dropLast(3) + "y"
        w.length > 3 && w.endsWith("s") && !w.endsWith("ss") -> w.dropLast(1)
        else -> w
    }

    fun ratio(a: String, b: String): Double {
        val m = maxOf(a.length, b.length)
        if (m == 0) return 1.0
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1); cur[0] = i
            for (j in 1..b.length) cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
            prev = cur
        }
        return 1.0 - prev[b.length].toDouble() / m
    }

    /** Category ids are slugs of their names (the app's Categories.slug). */
    fun slug(name: String): String = normalize(name).replace(' ', '-').take(60)
    fun nameOfSlug(id: String): String = if (id.isBlank()) "Uncategorized" else id.replace('-', ' ').replaceFirstChar { it.uppercase() }
}

/**
 * One question, one answer through the kernel AI contract (ai-modes@1): resolve mode + model, `start`, read the
 * session's `text` events with `stream` until `turn.end`, `close`. Times out after [timeoutMs] (the turn is stopped).
 */
internal class AiAsk(
    private val client: AiSessionClient,
    private val modes: List<AiMode>,
    private val policy: AiModePolicy,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    suspend fun available(): Boolean = runCatching { client.available() }.getOrDefault(false)

    suspend fun ask(input: AiRequestInput, timeoutMs: Long = 60_000, pollMs: Long = 500): AxfResult<String> {
        if (!available()) return AxfResult.err(AxfFailure.Unavailable("AI isn't connected (${client.host})."))
        val request = AiModes.buildRequest(modes, policy, emptyList(), input).request ?: return AxfResult.err(AxfFailure.Denied(input.requested ?: AiModes.DEFAULT_MODE))
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
        fun textOf(data: JsonElement?): String = when (data) {
            is JsonObject -> (data["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ""
            is JsonPrimitive -> if (data.isString) data.content else ""
            else -> ""
        }
    }
}

/** Arguments of an action: positional (`id:a:b`), a JSON payload, or a trigger's `extras["args"]`. Later sources win. */
internal object ActionArgs {
    fun of(args: List<String>, payload: String?, extras: Map<String, Any?>): JsonObject {
        val out = LinkedHashMap<String, JsonElement>()
        args.forEachIndexed { i, a -> out[i.toString()] = JsonPrimitive(a) }
        J.parse(payload?.trim()?.takeIf { it.startsWith("{") })?.let { out.putAll(it) }
        (extras["args"] as? JsonObject)?.let { out.putAll(it) }
        return JsonObject(out)
    }

    fun str(a: JsonObject, vararg keys: String): String? = keys.firstNotNullOfOrNull { k -> (a[k] as? JsonPrimitive)?.content?.trim()?.takeIf { it.isNotEmpty() } }
    fun int(a: JsonObject, vararg keys: String): Int? = str(a, *keys)?.toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 && it < 10_000_000 }?.toInt()
}
