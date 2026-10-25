package ai.amberx.axf.voicevault.voice

import ai.amberx.axf.voice.PhraseMatcher
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * What a custom voice action does. [needsVault] = it works on saved passwords, so it waits for the unlock (from the
 * background it opens the app at the unlock step and runs once you're in). [arg] names what the action's argument is.
 */
enum class ActionKind(val id: String, val label: String, val needsVault: Boolean, val arg: String?, val hint: String) {
    OPEN("open", "Open a screen", false, "Screen", "Opens one of Voice Vault's screens."),
    RETRIEVE_SITE("retrieve", "Copy a site's password", true, "Site", "Finds that saved site and asks you to confirm before copying."),
    STORE("store", "Save a password", true, "Site (optional)", "Starts saving a password, for this site when you name one."),
    NOTE("note", "Take a voice note", false, null, "Starts a voice note (your Voice notes setup on axHub)."),
    SAY("say", "Say something back", false, "What to say", "Speaks your words back. Handy as a check that it heard you."),
    LOCK("lock", "Lock the vault", false, null, "Locks the vault right away."),
    MIC_OFF("mic-off", "Turn the microphone off", false, null, "Stops every bit of listening until you turn it back on in the app."),
    RUN("run", "Run an app action", false, "Action", "Runs any action the app has, like opening settings.");

    companion object { fun of(id: String?): ActionKind? = entries.firstOrNull { it.id == id } }
}

/** One voice action you made: the phrases that start it, what it does, and whether it also works in the background. */
data class CustomAction(
    val id: String,
    val label: String,
    val phrases: List<String>,
    val kind: ActionKind,
    val arg: String = "",
    /** Heard by the background listener too (screen off, app closed); off = only while Voice Vault is open and unlocked. */
    val background: Boolean = false,
    val on: Boolean = true,
) {
    /** The lib-voice command id it's registered under. */
    val commandId: String get() = VoiceActionRules.PREFIX + id
}

/** One line of "What it heard": only a trigger that matched (never other speech, codes, passwords or sites you said). */
data class HeardEntry(val at: Long, val what: String, val phrase: String, val where: String)

/**
 * Voice Vault's own voice rules (app code, pure Kotlin): custom voice actions, which triggers are switched off,
 * quiet hours for the background listener and the heard log. All of it lives on this phone (KV store), never on axHub.
 */
object VoiceActionRules {
    const val PREFIX = "custom."
    const val MAX_ACTIONS = 30
    const val MAX_PHRASES = 6
    const val MAX_LABEL = 60
    const val MAX_ARG = 200
    const val MAX_LOG = 40
    /** Confirm and cancel can't be switched off: without them a step could never be left by voice. */
    val ALWAYS_ON: Set<String> = setOf("vault.confirm", "vault.cancel")

    private val json = Json { ignoreUnknownKeys = true }

    /* ---------------- custom actions ---------------- */

    /** The same normal form lib-voice matches and stores phrases in. */
    fun normalizePhrase(p: String): String = PhraseMatcher.normalize(p)

    fun parseActions(raw: String?): List<CustomAction> {
        val arr = runCatching { json.parseToJsonElement(raw ?: return emptyList()).jsonArray }.getOrNull() ?: return emptyList()
        return arr.mapNotNull { action(it) }.distinctBy { it.id }.take(MAX_ACTIONS)
    }

    fun action(e: JsonElement): CustomAction? {
        val o = e as? JsonObject ?: return null
        fun s(k: String) = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
        fun b(k: String, d: Boolean) = (o[k] as? JsonPrimitive)?.booleanOrNull ?: d
        val id = s("id")?.takeIf { ID.matches(it) } ?: return null
        val kind = ActionKind.of(s("kind")) ?: return null
        val phrases = (o["phrases"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.content?.let(::normalizePhrase) }.filter { it.isNotEmpty() }.distinct().take(MAX_PHRASES)
        if (phrases.isEmpty()) return null
        val label = s("label")?.trim()?.take(MAX_LABEL)?.ifEmpty { null } ?: phrases.first()
        return CustomAction(id, label, phrases, kind, s("arg")?.trim()?.take(MAX_ARG).orEmpty(), b("background", false), b("on", true))
    }

    fun encodeAction(a: CustomAction): JsonObject = JsonObject(mapOf(
        "id" to JsonPrimitive(a.id), "label" to JsonPrimitive(a.label), "phrases" to JsonArray(a.phrases.map(::JsonPrimitive)),
        "kind" to JsonPrimitive(a.kind.id), "arg" to JsonPrimitive(a.arg), "background" to JsonPrimitive(a.background), "on" to JsonPrimitive(a.on),
    ))

    fun encodeActions(list: List<CustomAction>): String = JsonArray(list.map(::encodeAction)).toString()

    /** A short id not used yet ("a1", "a2", …). */
    fun newId(existing: List<CustomAction>): String { var n = existing.size + 1; while (existing.any { it.id == "a$n" }) n++; return "a$n" }

    /**
     * Why [a] can't be saved, or null. [owner] answers which command already uses a phrase (lib-voice
     * `VoiceCommands.owner`, by normalized phrase), so a new phrase never steals another trigger's words.
     */
    fun problem(a: CustomAction, others: List<CustomAction>, owner: (String) -> String?, routes: Set<String> = emptySet()): String? {
        if (a.phrases.isEmpty()) return "Add at least one phrase: record it or type it."
        if (a.phrases.size > MAX_PHRASES) return "Up to $MAX_PHRASES phrases."
        if (a.label.isBlank()) return "Give it a name."
        if (others.count { it.id != a.id } >= MAX_ACTIONS) return "Up to $MAX_ACTIONS voice actions."
        for (p in a.phrases) {
            if (p.split(' ').size < 2 && p.length < 5) return "“$p” is too short: a stray word could set it off. Use two words or more."
            owner(p)?.takeIf { it != a.commandId }?.let { return "“$p” already starts ${if (it.startsWith(PREFIX)) "another voice action" else "a built-in command"}." }
            others.firstOrNull { o -> o.id != a.id && o.phrases.contains(p) }?.let { return "“$p” already starts “${it.label}”." }
        }
        when (a.kind) {
            ActionKind.OPEN -> if (a.arg.isBlank()) return "Pick the screen to open." else if (routes.isNotEmpty() && a.arg !in routes) return "That screen doesn't exist."
            ActionKind.RETRIEVE_SITE -> if (a.arg.isBlank()) return "Name the site whose password to copy."
            ActionKind.SAY -> if (a.arg.isBlank()) return "Type what it should say."
            ActionKind.RUN -> if (a.arg.isBlank()) return "Pick the action to run."
            else -> Unit
        }
        if (a.background && a.kind == ActionKind.RUN) return "App actions only run while the app is open. Switch off “In the background”."
        return null
    }

    /** One line saying what an action does, for the list. */
    fun describe(a: CustomAction, routeLabel: (String) -> String = { it }, actionLabel: (String) -> String = { it }): String = when (a.kind) {
        ActionKind.OPEN -> "Opens ${routeLabel(a.arg)}"
        ActionKind.RETRIEVE_SITE -> "Copies the password for ${a.arg} (after you unlock and confirm)"
        ActionKind.STORE -> if (a.arg.isBlank()) "Starts saving a password" else "Starts saving a password for ${a.arg}"
        ActionKind.NOTE -> "Takes a voice note"
        ActionKind.SAY -> "Says “${a.arg}”"
        ActionKind.LOCK -> "Locks the vault"
        ActionKind.MIC_OFF -> "Turns the microphone off"
        ActionKind.RUN -> "Runs ${actionLabel(a.arg)}"
    }

    /* ---------------- trigger switches ---------------- */

    fun parseOff(raw: String?): Set<String> = raw.orEmpty().split(',').map { it.trim() }.filter { it.isNotEmpty() && it !in ALWAYS_ON }.toSortedSet()
    fun encodeOff(off: Set<String>): String = off.filter { it !in ALWAYS_ON }.sorted().joinToString(",")
    fun isOn(commandId: String, off: Set<String>): Boolean = commandId in ALWAYS_ON || commandId !in off

    /* ---------------- quiet hours ---------------- */

    /** "22", "22:30", "7:05" → minutes after midnight, or null. */
    fun minutesOf(text: String?): Int? {
        val m = Regex("^(\\d{1,2})(?::(\\d{2}))?$").find(text?.trim() ?: return null) ?: return null
        val h = m.groupValues[1].toInt(); val mm = m.groupValues[2].ifEmpty { "0" }.toInt()
        return if (h in 0..23 && mm in 0..59) h * 60 + mm else null
    }

    fun clock(minutes: Int): String = "%d:%02d".format((minutes / 60) % 24, minutes % 60)

    /** True inside quiet hours [from]..[to] (minutes after midnight, wrapping past midnight). from == to = never quiet. */
    fun isQuiet(now: Int, from: Int, to: Int): Boolean = when {
        from == to -> false
        from < to -> now in from until to
        else -> now >= from || now < to
    }

    /** Milliseconds until quiet hours end (0 when not quiet). [nowMinutes] + [nowSeconds] = the time of day now. */
    fun msUntilQuietEnds(nowMinutes: Int, nowSeconds: Int, from: Int, to: Int): Long {
        if (!isQuiet(nowMinutes, from, to)) return 0
        val left = (to - nowMinutes + 24 * 60) % (24 * 60)
        return (left * 60L - nowSeconds).coerceAtLeast(1) * 1000L
    }

    /* ---------------- heard log ---------------- */

    fun parseLog(raw: String?): List<HeardEntry> {
        val arr = runCatching { json.parseToJsonElement(raw ?: return emptyList()).jsonArray }.getOrNull() ?: return emptyList()
        return arr.mapNotNull { e ->
            val o = runCatching { e.jsonObject }.getOrNull() ?: return@mapNotNull null
            val at = (o["at"] as? JsonPrimitive)?.longOrNull ?: return@mapNotNull null
            HeardEntry(at, o["what"]?.jsonPrimitive?.content.orEmpty().take(MAX_LABEL), o["phrase"]?.jsonPrimitive?.content.orEmpty().take(MAX_LABEL), o["where"]?.jsonPrimitive?.content.orEmpty().take(20))
        }.sortedByDescending { it.at }.take(MAX_LOG)
    }

    fun encodeLog(list: List<HeardEntry>): String = JsonArray(list.map { JsonObject(mapOf("at" to JsonPrimitive(it.at), "what" to JsonPrimitive(it.what), "phrase" to JsonPrimitive(it.phrase), "where" to JsonPrimitive(it.where))) }).toString()

    fun append(list: List<HeardEntry>, e: HeardEntry): List<HeardEntry> = (listOf(e.copy(what = e.what.take(MAX_LABEL), phrase = e.phrase.take(MAX_LABEL))) + list).take(MAX_LOG)

    private val ID = Regex("^[a-z0-9-]{1,24}$")
}
