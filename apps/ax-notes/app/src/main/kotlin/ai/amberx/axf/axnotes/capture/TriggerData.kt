package ai.amberx.axf.axnotes.capture

import ai.amberx.axf.axnotes.model.TriggerDef
import ai.amberx.axf.axnotes.model.TriggerHit
import ai.amberx.axf.kernel.triggers.Thresholds
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerArming
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerSource
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * AX Notes' trigger data (`axnotes-triggers@1`, assets/axnotes/triggers.json) as kernel triggers@1 records, and back.
 * Pure: unit-tested in TriggerDataTest.
 *
 *  - ids: `axnotes.<id>` in kebab case (`notes.readBack` → `axnotes.notes.read-back`; triggers@1 ids are lower case);
 *  - phrases: the app's `{slot}` becomes the kernel's `<slot>`; an optional end slot `{slot?}` becomes two phrases
 *    (without and with the slot), since triggers@1 has no optional slots;
 *  - every trigger fires the one app action [ACTION] with `{"trigger": "<app id>"}`, voice, no arming, any context,
 *    the voice-command threshold (80 %); the user changes phrases, threshold and context in Settings → Triggers.
 */
object TriggerData {
    /** The action every AX Notes trigger fires (payload: the command args, `trigger` = the app's trigger id). */
    const val ACTION: String = "axnotes.voice"
    const val ID_PREFIX: String = "axnotes."
    const val ARG_TRIGGER: String = "trigger"

    private val camel = Regex("([a-z0-9])([A-Z])")
    private val slot = Regex("\\{([A-Za-z][A-Za-z0-9_]*)(\\??)}")

    fun kernelId(appId: String): String = ID_PREFIX + appId.replace(camel, "$1-$2").lowercase().replace(Regex("[^a-z0-9.-]+"), "-")

    /** One app phrase as kernel phrases. */
    fun phrases(phrase: String): List<String> {
        val p = phrase.trim()
        val m = slot.findAll(p).toList()
        if (m.isEmpty()) return listOf(p)
        val last = m.last()
        val optionalAtEnd = last.groupValues[2] == "?" && p.substring(last.range.last + 1).isBlank()
        val converted = slot.replace(p) { "<${it.groupValues[1].lowercase()}>" }
        if (!optionalAtEnd) return listOf(converted)
        val without = p.substring(0, last.range.first).trim().let { head -> slot.replace(head) { "<${it.groupValues[1].lowercase()}>" } }
        return if (without.isBlank()) listOf(converted) else listOf(without, converted)
    }

    fun toTrigger(d: TriggerDef, module: String): Trigger = Trigger(
        id = kernelId(d.id), kind = TriggerKinds.VOICE, source = TriggerSource.PERMANENT, module = module, label = d.label,
        phrases = d.phrases.flatMap { phrases(it) }.distinct(), action = ACTION,
        args = JsonObject(mapOf(ARG_TRIGGER to JsonPrimitive(d.id))), threshold = Thresholds.VOICE_COMMAND,
        worksIn = emptyList(), arming = TriggerArming.ALWAYS,
    )

    fun toTriggers(defs: List<TriggerDef>, module: String): List<Trigger> = defs.map { toTrigger(it, module) }

    /** A fired command back as the app's hit; null when it isn't one of [defs]. The slot value (if any) is the arg. */
    fun hit(cmd: TriggerCommand, defs: List<TriggerDef>): TriggerHit? {
        val appId = (cmd.args[ARG_TRIGGER] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val def = defs.firstOrNull { it.id == appId } ?: defs.firstOrNull { kernelId(it.id) == cmd.triggerId } ?: return null
        val arg = cmd.args.entries.firstOrNull { it.key != ARG_TRIGGER }?.value?.let { (it as? JsonPrimitive)?.content }.orEmpty()
        return TriggerHit(def, cmd.phrase ?: def.phrases.firstOrNull().orEmpty(), arg.trim())
    }
}
