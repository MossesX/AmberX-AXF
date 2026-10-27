package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.triggers.Patterns
import ai.amberx.axf.kernel.triggers.Thresholds
import ai.amberx.axf.kernel.triggers.TriggerArming
import ai.amberx.axf.kernel.triggers.TriggerCheck
import ai.amberx.axf.kernel.triggers.TriggerJson
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerSource
import ai.amberx.axf.kernel.triggers.TriggerValidation
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The steps of the add-trigger flow, in order. */
public enum class AddTriggerStep(public val label: String) { KIND("Kind"), PHRASES("Phrases"), ACTION("Action"), DETAILS("Details") }

/** A context a trigger can be limited to (open set; apps register theirs, e.g. `notes.editor`). */
public data class TriggerContext(val id: String, val label: String)

/**
 * What the add-trigger flow builds up (pure; the screen only renders it). [build] validates through the kernel's
 * TriggerValidation, so the flow can never save something the matcher would reject.
 */
public data class TriggerDraft(
    val kind: String = TriggerKinds.VOICE,
    val label: String = "",
    val phrases: List<String> = emptyList(),
    val action: TriggerActionChoice? = null,
    val threshold: Double = Thresholds.DEFAULT,
    val worksIn: List<String> = emptyList(),
    val arming: TriggerArming? = null,
) {
    /** Spoken kinds take phrases with slots; others take signature ids. */
    public val spoken: Boolean get() = TriggerKinds.get(kind)?.spoken == true

    /** Why [phrase] can't be added ("" = fine). */
    public fun phraseError(phrase: String): String {
        val p = phrase.trim()
        if (p.isEmpty()) return "empty"
        if (phrases.any { Patterns.normalize(it) == Patterns.normalize(p) }) return "already added"
        return if (spoken) Patterns.errors(p) else ""
    }

    public fun addPhrase(phrase: String): TriggerDraft = if (phraseError(phrase).isEmpty()) copy(phrases = phrases + phrase.trim()) else this
    public fun removePhrase(phrase: String): TriggerDraft = copy(phrases = phrases.filter { it != phrase })

    /** Can the flow move on from [step]? */
    public fun ready(step: AddTriggerStep): Boolean = when (step) {
        AddTriggerStep.KIND -> TriggerKinds.get(kind) != null
        AddTriggerStep.PHRASES -> phrases.isNotEmpty()
        AddTriggerStep.ACTION -> action != null
        AddTriggerStep.DETAILS -> phrases.isNotEmpty() && action != null
    }

    /** The label when none was typed: "“first phrase” → action". */
    public fun effectiveLabel(): String = label.trim().ifEmpty { listOfNotNull(phrases.firstOrNull(), action?.label).joinToString(" → ") }

    /** The trigger as JSON, ready for TriggerValidation (source custom). */
    public fun toJson(id: String): JsonObject = JsonObject(buildMap {
        put("id", JsonPrimitive(id)); put("kind", JsonPrimitive(kind)); put("source", JsonPrimitive(TriggerSource.CUSTOM.id))
        put("module", JsonPrimitive(TriggerStore.CUSTOM_MODULE)); put("label", JsonPrimitive(effectiveLabel()))
        put("phrases", JsonArray(phrases.map(::JsonPrimitive))); put("action", JsonPrimitive(action?.id ?: ""))
        action?.args?.takeIf { it.isNotEmpty() }?.let { put("args", it) }
        put("threshold", TriggerJson.number(Thresholds.clamp(threshold))); put("worksIn", JsonArray(worksIn.map(::JsonPrimitive)))
        arming?.let { put("arming", JsonPrimitive(it.id)) }
    })

    public fun build(id: String): TriggerCheck = TriggerValidation.validate(toJson(id))
}
