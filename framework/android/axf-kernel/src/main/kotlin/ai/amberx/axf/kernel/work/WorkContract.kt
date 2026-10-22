package ai.amberx.axf.kernel.work

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * Work engine — periodic jobs that keep running in the background (work@1, kernel API level 1). Same design as the web
 * reference framework/core/engines/work.ts; conformance fixture spec/fixtures/work.json (WorkConformanceTest).
 *
 * Harvested from the AXHub app's approval watcher: a foreground service that polled the hub's approvals feed every N
 * seconds, backed off to 5 minutes while signed out, showed one "sign in" notice per signed-out spell, stopped when
 * watching was turned off, took STOP / CHECK_NOW commands and restarted after a reboot. Those decisions are data
 * ([JobSpec]) plus a pure reducer ([WorkEngine.reduce]); the host (Android lib-work's foreground service, a web timer…)
 * only runs the body and carries out the [JobEffect]s. Pure Kotlin: no Android imports.
 */

public const val WORK_CONTRACT: String = "work@1"
/** The Android lib-work module registers its poll-job host under this capability. */
public const val WORK_POLL_CAPABILITY: String = "axf.work.poll"

public enum class WorkKindStatus(public val id: String) { BUILT("built"), PLACEHOLDER("placeholder") }

public data class WorkKindSpec(val id: String, val label: String, val status: WorkKindStatus, val note: String? = null) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("id", JsonPrimitive(id)); put("label", JsonPrimitive(label)); put("status", JsonPrimitive(status.id))
        if (note != null) put("note", JsonPrimitive(note))
    })
}

/** Capabilities declared now so later work plugs in without reshuffling. */
public object WorkPlaceholders {
    /** the kernel's WorkScheduler contract (`axf.work`) over the platform scheduler (WorkManager on Android) */
    public const val MANAGER: String = "axf.work.manager"
    public const val ALARM: String = "axf.work.alarm"
    public const val CHAIN: String = "axf.work.chain"
    public val ALL: List<String> = listOf(MANAGER, ALARM, CHAIN)
}

/** Interval bounds, in ms. The host clamps every requested interval into [min, max]. */
public data class IntervalBounds(val defaultMs: Long, val minMs: Long, val maxMs: Long) {
    public fun toJson(): JsonObject = JsonObject(mapOf("defaultMs" to JsonPrimitive(defaultMs), "minMs" to JsonPrimitive(minMs), "maxMs" to JsonPrimitive(maxMs)))
}

public sealed class DelayRule {
    /** wait the job's current interval */
    public object Interval : DelayRule()
    /** wait a fixed time (e.g. 5 minutes while signed out) */
    public data class Fixed(val ms: Long) : DelayRule()
    /** baseMs × factor^(streak − 1), capped at maxMs; the streak counts consecutive runs with the same outcome */
    public data class Exponential(val baseMs: Long, val factor: Double, val maxMs: Long) : DelayRule()

    public fun toJson(): JsonObject = when (this) {
        is Interval -> JsonObject(mapOf("kind" to JsonPrimitive("interval")))
        is Fixed -> JsonObject(mapOf("kind" to JsonPrimitive("fixed"), "ms" to JsonPrimitive(ms)))
        is Exponential -> JsonObject(mapOf("kind" to JsonPrimitive("exponential"), "baseMs" to JsonPrimitive(baseMs), "factor" to WorkJson.number(factor), "maxMs" to JsonPrimitive(maxMs)))
    }

    public companion object {
        public val KINDS: List<String> = listOf("interval", "fixed", "exponential")
        public const val DEFAULT_FACTOR: Double = 2.0
    }
}

/** What happens after a run ends with an outcome. */
public data class OutcomeRule(
    val delay: DelayRule,
    /** show this notice once per spell (not again until a rule with [endsSpell] runs) */
    val notice: String? = null,
    /** this outcome ends the notice spell: notices shown so far may show again later */
    val endsSpell: Boolean? = null,
    /** the job stops after this outcome */
    val stop: Boolean? = null,
) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("delay", delay.toJson())
        if (notice != null) put("notice", JsonPrimitive(notice))
        if (endsSpell != null) put("endsSpell", JsonPrimitive(endsSpell))
        if (stop != null) put("stop", JsonPrimitive(stop))
    })
}

/** A flag the host evaluates (e.g. "watching" from the app's prefs); the job runs only while every condition holds. */
public data class RunCondition(val flag: String, val kind: String = "flag", val equals: Boolean = true) {
    public fun toJson(): JsonObject = JsonObject(mapOf("kind" to JsonPrimitive(kind), "flag" to JsonPrimitive(flag), "equals" to JsonPrimitive(equals)))
    public companion object { public val KINDS: List<String> = listOf("flag") }
}

public data class JobSpec(
    /** `[a-z0-9][a-z0-9._-]*` */
    val id: String,
    val kind: String,
    val interval: IntervalBounds,
    /** one rule per outcome name; `*` is the fallback */
    val outcomes: Map<String, OutcomeRule>,
    val conditions: List<RunCondition> = emptyList(),
    /** needs a user-visible, long-running host (a foreground service with an ongoing notification on Android) */
    val foreground: Boolean = false,
    /** the host starts it again after a reboot or an app update, when its conditions hold */
    val restartOnBoot: Boolean = false,
    val label: String? = null,
    val module: String? = null,
) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("id", JsonPrimitive(id)); put("kind", JsonPrimitive(kind))
        put("interval", interval.toJson())
        put("outcomes", JsonObject(outcomes.mapValues { it.value.toJson() }))
        put("conditions", JsonArray(conditions.map { it.toJson() }))
        put("foreground", JsonPrimitive(foreground)); put("restartOnBoot", JsonPrimitive(restartOnBoot))
        if (label != null) put("label", JsonPrimitive(label))
        if (module != null) put("module", JsonPrimitive(module))
    })

    public companion object {
        public const val FALLBACK_OUTCOME: String = "*"
        public val ID_PATTERN: Regex = Regex("^[a-z0-9][a-z0-9._-]*$")
    }
}

public data class JobSpecCheck(val ok: Boolean, val errors: List<String>, val spec: JobSpec? = null) {
    public fun toJson(): JsonObject = JsonObject(buildMap {
        put("ok", JsonPrimitive(ok)); put("errors", JsonArray(errors.map { JsonPrimitive(it) }))
        if (spec != null) put("spec", spec.toJson())
    })
}

public enum class JobPhase(public val id: String) {
    IDLE("idle"), RUNNING("running"), SLEEPING("sleeping"), STOPPED("stopped");
    public companion object { public fun parse(s: String?): JobPhase = entries.firstOrNull { it.id == s } ?: IDLE }
}

public data class JobState(
    val phase: JobPhase,
    /** the current (clamped) interval */
    val intervalMs: Long,
    val lastOutcome: String? = null,
    /** consecutive runs that ended with [lastOutcome] */
    val streak: Int = 0,
    val runs: Int = 0,
    /** how long the host was told to sleep (null unless sleeping) */
    val sleepMs: Long? = null,
    /** notices shown in the current spell */
    val notices: List<String> = emptyList(),
    val stopReason: String? = null,
) {
    public fun toJson(): JsonObject = JsonObject(mapOf(
        "phase" to JsonPrimitive(phase.id), "intervalMs" to JsonPrimitive(intervalMs),
        "lastOutcome" to (lastOutcome?.let { JsonPrimitive(it) } ?: JsonNull), "streak" to JsonPrimitive(streak), "runs" to JsonPrimitive(runs),
        "sleepMs" to (sleepMs?.let { JsonPrimitive(it) } ?: JsonNull), "notices" to JsonArray(notices.map { JsonPrimitive(it) }),
        "stopReason" to (stopReason?.let { JsonPrimitive(it) } ?: JsonNull),
    ))
}

public sealed class JobEvent {
    /** the host wants the job up; [checkNow] restarts a running job at once */
    public data class Start(val checkNow: Boolean = false) : JobEvent()
    public object Stop : JobEvent()
    public object CheckNow : JobEvent()
    /** the body finished with this outcome */
    public data class Outcome(val outcome: String) : JobEvent()
    /** the sleep is over */
    public object Wake : JobEvent()
    /** the platform refused to host it (Android refuses a foreground start from the background) */
    public object HostRefused : JobEvent()
    /** the user changed the interval */
    public data class Interval(val ms: Long?) : JobEvent()
    /** a condition flag changed; the host passes the current flags with every event */
    public object Flags : JobEvent()

    public companion object {
        public val TYPES: List<String> = listOf("start", "stop", "check-now", "outcome", "wake", "host-refused", "interval", "flags")
        /** The fixture / wire form `{type, …}`. */
        public fun parse(o: JsonObject): JobEvent? = when (WorkJson.str(o, "type")) {
            "start" -> Start(WorkJson.bool(o, "checkNow") == true)
            "stop" -> Stop
            "check-now" -> CheckNow
            "outcome" -> Outcome(WorkJson.str(o, "outcome") ?: "")
            "wake" -> Wake
            "host-refused" -> HostRefused
            "interval" -> Interval(WorkJson.long(o, "ms"))
            "flags" -> Flags
            else -> null
        }
    }
}

public sealed class JobEffect {
    /** run the body now (cancelling a run or a sleep in progress) */
    public object Run : JobEffect()
    public data class Sleep(val ms: Long) : JobEffect()
    public data class Stop(val reason: String) : JobEffect()
    /** show a one-time notice; [outcome] says which outcome raised it */
    public data class Notice(val id: String, val outcome: String) : JobEffect()
    public object ClearNotices : JobEffect()
    /** refresh what the host shows about the job (its ongoing notification) */
    public data class Status(val outcome: String) : JobEffect()

    public fun toJson(): JsonObject = when (this) {
        is Run -> JsonObject(mapOf("effect" to JsonPrimitive("run")))
        is Sleep -> JsonObject(mapOf("effect" to JsonPrimitive("sleep"), "ms" to JsonPrimitive(ms)))
        is Stop -> JsonObject(mapOf("effect" to JsonPrimitive("stop"), "reason" to JsonPrimitive(reason)))
        is Notice -> JsonObject(mapOf("effect" to JsonPrimitive("notice"), "id" to JsonPrimitive(id), "outcome" to JsonPrimitive(outcome)))
        is ClearNotices -> JsonObject(mapOf("effect" to JsonPrimitive("clear-notices")))
        is Status -> JsonObject(mapOf("effect" to JsonPrimitive("status"), "outcome" to JsonPrimitive(outcome)))
    }

    public companion object { public val NAMES: List<String> = listOf("run", "sleep", "stop", "notice", "clear-notices", "status") }
}

public object StopReasons {
    public const val STOPPED: String = "stopped"
    public const val HOST_REFUSED: String = "host-refused"
    public const val OUTCOME: String = "outcome"
    public const val CONDITION: String = "condition"
    public fun toJson(): JsonObject = JsonObject(mapOf("stopped" to JsonPrimitive(STOPPED), "hostRefused" to JsonPrimitive(HOST_REFUSED), "outcome" to JsonPrimitive(OUTCOME), "condition" to JsonPrimitive(CONDITION)))
}

public data class JobStep(val state: JobState, val effects: List<JobEffect>) {
    public fun toJson(): JsonObject = JsonObject(mapOf("state" to state.toJson(), "effects" to JsonArray(effects.map { it.toJson() })))
}

/** Small tolerant JSON readers used by the contract (the kernel's asset helpers are richer; these keep this package self-contained). */
public object WorkJson {
    public fun str(o: JsonObject, k: String): String? = (o[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    public fun bool(o: JsonObject, k: String): Boolean? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull
    public fun double(o: JsonObject, k: String): Double? = (o[k] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull
    /** A whole non-negative number as the web engine's `isMs` sees it; null for anything else. */
    public fun ms(o: JsonObject, k: String): Long? { val d = double(o, k) ?: return null; return if (d >= 0 && d == Math.floor(d) && d.isFinite()) d.toLong() else null }
    public fun long(o: JsonObject, k: String): Long? = double(o, k)?.takeIf { it.isFinite() }?.let { Math.floor(it).toLong() }
    /** Numbers print like JavaScript's: whole values without a fraction. */
    public fun number(d: Double): JsonPrimitive = if (d == Math.floor(d) && d.isFinite() && Math.abs(d) < 1e15) JsonPrimitive(d.toLong()) else JsonPrimitive(d)
    public fun flags(o: JsonObject?): Map<String, Boolean> = o?.entries?.mapNotNull { (k, v) -> ((v as? JsonPrimitive)?.takeUnless { it.isString }?.booleanOrNull)?.let { k to it } }?.toMap() ?: emptyMap()
    public fun isNull(e: JsonElement?): Boolean = e == null || e is JsonNull
}
