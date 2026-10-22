package ai.amberx.axf.voice

import ai.amberx.axf.kernel.platform.KeyValueStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * A voice command any module can register. `defaults` are the phrases it ships with; users switch
 * defaults off, record their own or type them (Settings → Voice triggers). `group` keeps related
 * commands together in that screen.
 */
public data class VoiceCommand(
    val id: String,
    val label: String,
    val defaults: List<String>,
    val description: String? = null,
    val group: String = "General",
    val module: String = "app",
    val order: Int = 100,
)

/** What one command currently answers to. */
public data class CommandPhrases(val command: VoiceCommand, val active: List<String>, val custom: List<String>, val offDefaults: List<String>)

/** Result of matching speech to commands. */
public data class CommandMatch(val commandId: String, val phrase: String, val heard: String, val score: Double)

/**
 * Open registry of voice commands plus each command's user phrases, persisted in the kernel
 * key-value store as one JSON document (`axf.voice.triggers`): `{ "<id>": { "custom": [...], "off": [...] } }`.
 * Pure Kotlin, so a future port can mirror it 1:1.
 */
public class VoiceCommands(private val store: KeyValueStore?) {
    private val _commands = MutableStateFlow<List<VoiceCommand>>(emptyList())
    public val commands: StateFlow<List<VoiceCommand>> = _commands.asStateFlow()
    private val custom = LinkedHashMap<String, MutableList<String>>()
    private val off = LinkedHashMap<String, MutableSet<String>>()
    private val _version = MutableStateFlow(0)
    /** Bumps on every phrase change, so screens recompose. */
    public val version: StateFlow<Int> = _version.asStateFlow()

    init { load() }

    /** Register (or replace) a command. Re-registering keeps the user's phrases. */
    public fun register(command: VoiceCommand) {
        _commands.value = (_commands.value.filter { it.id != command.id } + command).sortedWith(compareBy({ it.group }, { it.order }, { it.label }))
    }

    public fun unregister(id: String) { _commands.value = _commands.value.filter { it.id != id } }
    public fun get(id: String): VoiceCommand? = _commands.value.firstOrNull { it.id == id }

    public fun phrases(id: String): CommandPhrases? {
        val c = get(id) ?: return null
        val offSet = off[id].orEmpty()
        val mine = custom[id].orEmpty()
        val active = (c.defaults.filter { PhraseMatcher.normalize(it) !in offSet } + mine).distinctBy { PhraseMatcher.normalize(it) }
        return CommandPhrases(c, active, mine.toList(), c.defaults.filter { PhraseMatcher.normalize(it) in offSet })
    }

    /** Adds a phrase. Returns an error message when it is empty or already used by another command. */
    public fun addPhrase(id: String, phrase: String): String? {
        val p = PhraseMatcher.normalize(phrase)
        if (p.isEmpty()) return "Say or type a phrase first."
        if (p.length > 60) return "Keep phrases under 60 characters."
        val c = get(id) ?: return "Unknown command."
        owner(p)?.takeIf { it != id }?.let { other -> return "\"$p\" already triggers ${get(other)?.label ?: other}." }
        if (c.defaults.any { PhraseMatcher.normalize(it) == p }) { off[id]?.remove(p) } else {
            val list = custom.getOrPut(id) { mutableListOf() }
            if (list.none { PhraseMatcher.normalize(it) == p }) list += p
        }
        save(); return null
    }

    /** Removes a custom phrase, or switches a default phrase off. A command always keeps at least one phrase. */
    public fun removePhrase(id: String, phrase: String): String? {
        val c = get(id) ?: return "Unknown command."
        val p = PhraseMatcher.normalize(phrase)
        val current = phrases(id)?.active.orEmpty()
        if (current.size <= 1 && current.any { PhraseMatcher.normalize(it) == p }) return "${c.label} needs at least one phrase."
        if (c.defaults.any { PhraseMatcher.normalize(it) == p }) off.getOrPut(id) { mutableSetOf() } += p
        else custom[id]?.removeAll { PhraseMatcher.normalize(it) == p }
        save(); return null
    }

    /** Back to the shipped defaults (custom phrases removed). */
    public fun reset(id: String) { custom.remove(id); off.remove(id); save() }
    public fun resetAll() { custom.clear(); off.clear(); save() }

    /** Which command (if any) currently answers to this normalized phrase. */
    public fun owner(normalized: String): String? = _commands.value.firstOrNull { c -> phrases(c.id)?.active?.any { PhraseMatcher.normalize(it) == normalized } == true }?.id

    /**
     * Best command among [among] (all when null) for any recognizer alternative. Ties go to the longer
     * phrase. [threshold] 0.8 tolerates small mishearings without confusing short phrases.
     */
    public fun match(heard: List<String>, among: Collection<String>? = null, threshold: Double = 0.8): CommandMatch? {
        val pairs = _commands.value.filter { among == null || it.id in among }.flatMap { c -> phrases(c.id)?.active.orEmpty().map { c.id to it } }
        val m = PhraseMatcher.best(heard, pairs, threshold, label = { it.second }, score = PhraseMatcher::triggerScore) ?: return null
        return CommandMatch(m.item.first, m.item.second, m.heard, m.score)
    }

    private fun load() {
        val raw = store?.get(KEY) ?: return
        runCatching {
            val o = Json.parseToJsonElement(raw).jsonObject
            for ((id, v) in o) {
                val e = v.jsonObject
                e["custom"]?.jsonArray?.map { it.jsonPrimitive.content }?.let { custom[id] = it.toMutableList() }
                e["off"]?.jsonArray?.map { it.jsonPrimitive.content }?.let { off[id] = it.toMutableSet() }
            }
        }
    }

    private fun save() {
        val ids = (custom.keys + off.keys).toSortedSet()
        val doc = JsonObject(ids.associateWith { id ->
            JsonObject(mapOf("custom" to JsonArray(custom[id].orEmpty().map(::JsonPrimitive)), "off" to JsonArray(off[id].orEmpty().sorted().map(::JsonPrimitive))))
        })
        store?.put(KEY, doc.toString())
        _version.value++
    }

    public companion object { public const val KEY: String = "axf.voice.triggers" }
}
