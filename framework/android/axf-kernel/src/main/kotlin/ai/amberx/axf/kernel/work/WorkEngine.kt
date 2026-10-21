package ai.amberx.axf.kernel.work

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The pure decisions of work@1 (same results as framework/core/engines/work.ts, pinned by spec/fixtures/work.json):
 * the open registry of job kinds, spec validation, interval clamping, run conditions, delay rules and the job state
 * machine ([reduce]). Hosts carry out the effects; they decide nothing.
 */
public object WorkEngine {
    private val kinds: LinkedHashMap<String, WorkKindSpec> = linkedMapOf(
        "poll" to WorkKindSpec("poll", "Periodic poll", WorkKindStatus.BUILT, "A body run again and again while conditions hold; delay per outcome; needs a long-running host (Android foreground service)"),
        "once" to WorkKindSpec("once", "One-off", WorkKindStatus.PLACEHOLDER, "Run once, retried by the outcome rules; survives process death through the platform scheduler"),
        "alarm" to WorkKindSpec("alarm", "Alarm", WorkKindStatus.PLACEHOLDER, "Run at a wall-clock time (exact only when the platform allows)"),
        "constrained" to WorkKindSpec("constrained", "Constrained periodic", WorkKindStatus.PLACEHOLDER, "Platform-scheduled periodic work with constraints (network, charging…); 15 min minimum on Android (WorkManager)"),
        "chain" to WorkKindSpec("chain", "Chain", WorkKindStatus.PLACEHOLDER, "Jobs that run after each other"),
    )

    /** Every job kind, built or placeholder. */
    public fun kinds(): List<WorkKindSpec> = kinds.values.toList()
    public fun kind(id: String): WorkKindSpec? = kinds[id]
    /** A port or a module adds a kind (or marks a placeholder built). */
    public fun registerKind(spec: WorkKindSpec) { kinds[spec.id] = spec }

    /* ---------- validation ---------- */

    private fun stringify(e: JsonElement?): String = when {
        e == null -> "undefined"
        e is JsonNull -> "null"
        e is JsonPrimitive && e.isString -> "\"" + e.content.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        e is JsonPrimitive -> e.content
        else -> e.toString()
    }

    private fun checkDelay(raw: JsonElement?, where: String, errors: MutableList<String>): DelayRule? {
        val o = raw as? JsonObject
        if (o == null) { errors += "$where: delay must be an object"; return null }
        when (WorkJson.str(o, "kind")) {
            "interval" -> return DelayRule.Interval
            "fixed" -> {
                val ms = WorkJson.ms(o, "ms")
                if (ms == null || ms < 1) { errors += "$where: fixed delay needs ms ≥ 1"; return null }
                return DelayRule.Fixed(ms)
            }
            "exponential" -> {
                val factorEl = o["factor"]
                val factor: Double? = if (factorEl == null) DelayRule.DEFAULT_FACTOR else WorkJson.double(o, "factor")
                val base = WorkJson.ms(o, "baseMs")
                if (base == null || base < 1) { errors += "$where: exponential delay needs baseMs ≥ 1"; return null }
                val max = WorkJson.ms(o, "maxMs")
                if (max == null || max < base) { errors += "$where: exponential delay needs maxMs ≥ baseMs"; return null }
                if (factor == null || !factor.isFinite() || factor < 1) { errors += "$where: exponential factor must be ≥ 1"; return null }
                return DelayRule.Exponential(base, factor, max)
            }
            else -> { errors += "$where: unknown delay kind ${stringify(o["kind"])}"; return null }
        }
    }

    /** Validates a raw job spec (JSON from an app, a plugin or a fixture) and returns the normalized spec. */
    public fun validate(raw: JsonElement?): JobSpecCheck {
        val o = raw as? JsonObject ?: return JobSpecCheck(false, listOf("job spec must be an object"))
        val errors = mutableListOf<String>()
        val id = WorkJson.str(o, "id") ?: ""
        if (!JobSpec.ID_PATTERN.matches(id)) errors += "id must match [a-z0-9][a-z0-9._-]*"
        val kind = WorkJson.str(o, "kind") ?: ""
        val k = kinds[kind]
        if (k == null) errors += "unknown job kind ${stringify(JsonPrimitive(kind))}"
        else if (k.status != WorkKindStatus.BUILT) errors += "job kind $kind is a placeholder (not built yet)"
        var interval = IntervalBounds(0, 0, 0)
        val io = o["interval"] as? JsonObject
        if (io == null) errors += "interval bounds are required"
        else {
            val min = WorkJson.ms(io, "minMs"); val max = WorkJson.ms(io, "maxMs"); val def = WorkJson.ms(io, "defaultMs")
            if (min == null || min < 1) errors += "interval.minMs must be ≥ 1"
            if (max == null || (min != null && max < min)) errors += "interval.maxMs must be ≥ minMs"
            if (def == null || (min != null && max != null && (def < min || def > max))) errors += "interval.defaultMs must lie within [minMs, maxMs]"
            if (def != null && min != null && max != null) interval = IntervalBounds(def, min, max)
        }
        val outcomes = LinkedHashMap<String, OutcomeRule>()
        val oo = o["outcomes"] as? JsonObject
        if (oo == null) errors += "outcomes must be an object"
        else for ((name, r) in oo) {
            if (name.isEmpty()) { errors += "outcome names must not be empty"; continue }
            val ro = r as? JsonObject
            if (ro == null) { errors += "outcome $name: rule must be an object"; continue }
            val delay = checkDelay(ro["delay"], "outcome $name", errors) ?: continue
            var notice: String? = null
            if (ro["notice"] != null) {
                val n = WorkJson.str(ro, "notice")
                if (n.isNullOrEmpty()) { errors += "outcome $name: notice must be a non-empty string"; continue }
                notice = n
            }
            var endsSpell: Boolean? = null
            if (ro["endsSpell"] != null) {
                val b = WorkJson.bool(ro, "endsSpell")
                if (b == null) { errors += "outcome $name: endsSpell must be a boolean"; continue }
                endsSpell = b
            }
            var stop: Boolean? = null
            if (ro["stop"] != null) {
                val b = WorkJson.bool(ro, "stop")
                if (b == null) { errors += "outcome $name: stop must be a boolean"; continue }
                stop = b
            }
            outcomes[name] = OutcomeRule(delay, notice, endsSpell, stop)
        }
        val conditions = mutableListOf<RunCondition>()
        val ce = o["conditions"]
        if (ce != null && ce !is JsonArray) errors += "conditions must be an array"
        else for (c in (ce as? JsonArray) ?: JsonArray(emptyList())) {
            val co = c as? JsonObject
            val flag = co?.let { WorkJson.str(it, "flag") }
            if (co == null || flag.isNullOrEmpty()) { errors += "every condition needs a flag name"; continue }
            val kindEl = co["kind"]
            val ck: String? = if (kindEl == null) "flag" else WorkJson.str(co, "kind")
            if (ck == null || ck !in RunCondition.KINDS) errors += "condition $flag: unknown kind ${if (kindEl == null) "\"flag\"" else stringify(kindEl)} (it would never hold)"
            val eqEl = co["equals"]
            val equals: Boolean? = if (eqEl == null) true else WorkJson.bool(co, "equals")
            if (equals == null) { errors += "condition $flag: equals must be a boolean"; continue }
            conditions += RunCondition(flag, ck ?: "flag", equals)
        }
        for (f in listOf("foreground", "restartOnBoot")) {
            val e = o[f]
            if (e != null && WorkJson.bool(o, f) == null) errors += "$f must be a boolean"
        }
        if (errors.isNotEmpty()) return JobSpecCheck(false, errors)
        val label = WorkJson.str(o, "label")?.takeIf { it.isNotEmpty() }
        val module = WorkJson.str(o, "module")?.takeIf { it.isNotEmpty() }
        return JobSpecCheck(true, emptyList(), JobSpec(id, kind, interval, outcomes, conditions, WorkJson.bool(o, "foreground") == true, WorkJson.bool(o, "restartOnBoot") == true, label, module))
    }

    /* ---------- pure decisions ---------- */

    /** A requested interval clamped into the bounds (null or a non-finite number falls back to the default). */
    public fun clampInterval(bounds: IntervalBounds, ms: Long?): Long = (ms ?: bounds.defaultMs).coerceIn(bounds.minMs, bounds.maxMs)
    public fun clampInterval(bounds: IntervalBounds, ms: Double?): Long = clampInterval(bounds, ms?.takeIf { it.isFinite() }?.let { Math.floor(it).toLong() })

    /** The conditions that don't hold right now (flag names). A missing flag counts as false; an unknown kind never holds. */
    public fun unmetConditions(spec: JobSpec, flags: Map<String, Boolean>): List<String> =
        spec.conditions.filter { c -> c.kind != "flag" || (flags[c.flag] == true) != c.equals }.map { it.flag }

    /** Boot / update: start the job again only when it asks for that and its conditions hold. */
    public fun shouldRestart(spec: JobSpec, flags: Map<String, Boolean>): Boolean = spec.restartOnBoot && unmetConditions(spec, flags).isEmpty()

    public fun outcomeRule(spec: JobSpec, outcome: String): OutcomeRule =
        spec.outcomes[outcome] ?: spec.outcomes[JobSpec.FALLBACK_OUTCOME] ?: OutcomeRule(DelayRule.Interval)

    /** The delay a rule yields for the given state (interval and streak). */
    public fun delayFor(rule: DelayRule, intervalMs: Long, streak: Int): Long = when (rule) {
        is DelayRule.Interval -> intervalMs
        is DelayRule.Fixed -> rule.ms
        is DelayRule.Exponential -> {
            val n = maxOf(0, streak - 1)
            var v = rule.baseMs.toDouble()
            var i = 0
            while (i < n && v < rule.maxMs) { v *= rule.factor; i++ }
            minOf(rule.maxMs, Math.floor(v).toLong())
        }
    }

    public fun initialState(spec: JobSpec, intervalMs: Long? = null): JobState =
        JobState(JobPhase.IDLE, clampInterval(spec.interval, intervalMs ?: spec.interval.defaultMs))

    private fun stopped(state: JobState, reason: String): JobStep =
        JobStep(state.copy(phase = JobPhase.STOPPED, sleepMs = null, stopReason = reason), listOf(JobEffect.Stop(reason)))

    /** A job leaving idle/stopped starts a fresh spell (notices may show again, streaks start over); from sleeping it just continues. */
    private fun running(state: JobState): JobStep {
        val fresh = state.phase == JobPhase.IDLE || state.phase == JobPhase.STOPPED
        val next = if (fresh) state.copy(phase = JobPhase.RUNNING, sleepMs = null, stopReason = null, notices = emptyList(), streak = 0, lastOutcome = null)
        else state.copy(phase = JobPhase.RUNNING, sleepMs = null, stopReason = null)
        return JobStep(next, listOf(JobEffect.Run))
    }

    private fun conditionStop(spec: JobSpec, flags: Map<String, Boolean>, state: JobState): JobStep? {
        val unmet = unmetConditions(spec, flags)
        return if (unmet.isEmpty()) null else stopped(state, "${StopReasons.CONDITION}:${unmet[0]}")
    }

    /** One step of the job's state machine. The host carries out the effects in order. */
    public fun reduce(spec: JobSpec, state: JobState, event: JobEvent, flags: Map<String, Boolean> = emptyMap()): JobStep = when (event) {
        is JobEvent.Start -> conditionStop(spec, flags, state) ?: if (state.phase == JobPhase.RUNNING && !event.checkNow) JobStep(state, emptyList()) else running(state)
        is JobEvent.CheckNow -> conditionStop(spec, flags, state) ?: running(state)
        is JobEvent.Stop -> stopped(state, StopReasons.STOPPED)
        is JobEvent.HostRefused -> stopped(state, StopReasons.HOST_REFUSED)
        is JobEvent.Interval -> JobStep(state.copy(intervalMs = clampInterval(spec.interval, event.ms)), emptyList())
        is JobEvent.Flags ->
            if (state.phase != JobPhase.RUNNING && state.phase != JobPhase.SLEEPING) JobStep(state, emptyList())
            else conditionStop(spec, flags, state) ?: JobStep(state, emptyList())
        is JobEvent.Wake ->
            if (state.phase != JobPhase.SLEEPING) JobStep(state, emptyList())
            else conditionStop(spec, flags, state) ?: running(state)
        is JobEvent.Outcome -> {
            if (state.phase != JobPhase.RUNNING) JobStep(state, emptyList())
            else {
                val rule = outcomeRule(spec, event.outcome)
                val streak = if (state.lastOutcome == event.outcome) state.streak + 1 else 1
                val effects = mutableListOf<JobEffect>()
                var notices = state.notices
                if (rule.endsSpell == true && notices.isNotEmpty()) { notices = emptyList(); effects += JobEffect.ClearNotices }
                val notice = rule.notice
                if (notice != null && notice !in notices) { notices = notices + notice; effects += JobEffect.Notice(notice, event.outcome) }
                effects += JobEffect.Status(event.outcome)
                val next = state.copy(lastOutcome = event.outcome, streak = streak, runs = state.runs + 1, notices = notices)
                if (rule.stop == true) {
                    val s = stopped(next, "${StopReasons.OUTCOME}:${event.outcome}")
                    JobStep(s.state, effects + s.effects)
                } else {
                    val ms = delayFor(rule.delay, next.intervalMs, streak)
                    effects += JobEffect.Sleep(ms)
                    JobStep(next.copy(phase = JobPhase.SLEEPING, sleepMs = ms), effects)
                }
            }
        }
    }

    /** Replays events (with the flags in force at each) from the initial state; handy for tests and tools. */
    public fun replay(spec: JobSpec, events: List<Pair<JobEvent, Map<String, Boolean>>>, intervalMs: Long? = null): List<JobStep> {
        var state = initialState(spec, intervalMs)
        val out = mutableListOf<JobStep>()
        for ((event, flags) in events) { val step = reduce(spec, state, event, flags); out += step; state = step.state }
        return out
    }
}
