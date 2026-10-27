package ai.amberx.axf.triggers

import ai.amberx.axf.kernel.triggers.MatchEnv
import ai.amberx.axf.kernel.triggers.MatchOutcome
import ai.amberx.axf.kernel.triggers.Observation
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerDecision
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerMatcher
import ai.amberx.axf.kernel.triggers.TriggerOutcome
import ai.amberx.axf.voice.ArmingDecision
import ai.amberx.axf.voice.PhraseMatcher
import ai.amberx.axf.voice.VoiceArming
import ai.amberx.axf.voice.VoiceResult
import ai.amberx.axf.voice.VoiceSensitivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch

/*
 * lib-voice → kernel TriggerMatcher. Each final VoiceResult goes through the sensitivity floor (VoiceSensitivity) and
 * the arming state machine (VoiceArming), becomes a kernel Observation (confidence in percent) and is matched against
 * the current triggers in the current context. A fired TriggerCommand comes out on [VoiceTriggerBridge.commands]; every
 * decision (per-trigger confidence and outcome) goes to a plain log callback, so lib-overlay's log can show it without
 * this module depending on lib-overlay.
 */

/** How the arming phrase gates matching. */
public enum class ArmingGate(public val id: String) {
    /**
     * Kernel semantics (default): every utterance is matched; triggers with `arming = required` fire only while voice
     * is armed (arming phrase said, or always-armed), `arming = always` triggers fire whenever they match.
     */
    PER_TRIGGER("per-trigger"),
    /** lib-voice classic: nothing is matched until the arming phrase (or always-armed) lets an utterance through. */
    ALL("all"),
    ;

    public companion object { public fun of(id: String?): ArmingGate = entries.firstOrNull { it.id == id } ?: PER_TRIGGER }
}

/** Why an utterance never reached the matcher. */
public enum class VoiceDrop(public val id: String) {
    PARTIAL("partial"), BELOW_SENSITIVITY("below-sensitivity"), NOT_ARMED("not-armed"), ARMED_ONLY("armed-only"), EMPTY("empty")
}

/** One line for a trigger log: what was heard, every trigger's decision (confidence + outcome), what fired. */
public data class TriggerLogEntry(
    val atMs: Long,
    val context: String,
    val heard: List<String>,
    /** 0..100, the recognizer's confidence for the utterance */
    val inputConfidence: Double,
    val armed: Boolean,
    /** null when the utterance reached the matcher; else why it was dropped */
    val dropped: VoiceDrop? = null,
    /** per-trigger decisions; only matching triggers unless the bridge logs no-matches too */
    val decisions: List<TriggerDecision> = emptyList(),
    val fired: TriggerCommand? = null,
)

/** Plain callback type for a trigger log (lib-overlay's log, logcat, a test). */
public typealias TriggerLogSink = (TriggerLogEntry) -> Unit

/** Result of [VoiceTriggerDecider.onResult]. */
public data class VoiceStep(val entry: TriggerLogEntry, val outcome: MatchOutcome?) {
    public val fired: TriggerCommand? get() = outcome?.fired
}

/**
 * The pure part of the bridge (no coroutines, no Android): sensitivity → arming → kernel matcher, with `lastFired`
 * (cooldowns) kept between calls. Not thread-safe: call from one collector, like [VoiceArming].
 */
public class VoiceTriggerDecider(
    public val arming: VoiceArming,
    public var gate: ArmingGate = ArmingGate.PER_TRIGGER,
    /** include NO_MATCH decisions in log entries (noisy; off by default) */
    public var logNoMatch: Boolean = false,
) {
    private var lastFired: Map<String, Long> = emptyMap()

    /** Forget cooldowns (e.g. after the trigger list changed a lot). */
    public fun resetCooldowns() { lastFired = emptyMap() }

    public fun onResult(result: VoiceResult, nowMs: Long, triggers: List<Trigger>, context: String, sensitivity: Float, kindsOff: List<String> = emptyList()): VoiceStep {
        val pct = (result.confidence.toDouble() * 100.0).coerceIn(0.0, 100.0)
        fun drop(why: VoiceDrop, heard: List<String> = listOf(result.text), armed: Boolean = arming.isArmed(nowMs)) =
            VoiceStep(TriggerLogEntry(nowMs, context, heard, pct, armed, why), null)
        if (!result.final) return drop(VoiceDrop.PARTIAL)
        if (result.text.isBlank()) return drop(VoiceDrop.EMPTY)
        if (!VoiceSensitivity.passes(result, sensitivity)) return drop(VoiceDrop.BELOW_SENSITIVITY)
        val heard: List<String>
        val armed: Boolean
        when (val d = arming.onHeard(result.text, nowMs)) {
            is ArmingDecision.Armed -> return drop(VoiceDrop.ARMED_ONLY, armed = true)
            is ArmingDecision.Ignored -> {
                if (gate == ArmingGate.ALL) return drop(VoiceDrop.NOT_ARMED, armed = false)
                heard = alternatives(result.text, result.alternatives)
                armed = false
            }
            is ArmingDecision.Pass -> { heard = alternatives(d.text, result.alternatives); armed = true }
        }
        if (heard.isEmpty()) return drop(VoiceDrop.EMPTY)
        val obs = Observation(TriggerKinds.VOICE, nowMs, heard = heard, confidence = pct)
        val env = MatchEnv(context, armed = if (armed) listOf(TriggerKinds.VOICE) else emptyList(), kindsOff = kindsOff, lastFired = lastFired)
        val out = TriggerMatcher.match(triggers, obs, env)
        lastFired = out.lastFired
        val logged = if (logNoMatch) out.decisions else out.decisions.filter { it.outcome != TriggerOutcome.NO_MATCH }
        return VoiceStep(TriggerLogEntry(nowMs, context, heard, pct, armed, null, logged, out.fired), out)
    }

    /** What was heard, best first: the passed text, then the recognizer's other alternatives (normalized, no repeats). */
    private fun alternatives(first: String, all: List<String>): List<String> =
        (listOf(first) + all.drop(1)).map(PhraseMatcher::normalize).filter { it.isNotEmpty() }.distinct()
}

/**
 * Runs a [VoiceTriggerDecider] over a VoiceResult flow (lib-voice's `VoiceEngine.results`). The trigger list, context,
 * sensitivity and switched-off kinds are read fresh for every utterance, so store edits and context changes apply at once.
 *
 * ```kotlin
 * val bridge = VoiceTriggerBridge(engine.results, VoiceArming(voice.armingConfig()), store::triggers, { currentContext }, { voice.sensitivity }, log = overlayLog::add)
 * bridge.start(scope); scope.launch { bridge.commands.collect { triggers.run(it) } }
 * engine.start(voice.engineOptions())
 * ```
 */
public class VoiceTriggerBridge(
    private val results: Flow<VoiceResult>,
    arming: VoiceArming,
    private val triggers: () -> List<Trigger>,
    private val context: () -> String,
    private val sensitivity: () -> Float = { VoiceSensitivity.DEFAULT },
    private val kindsOff: () -> List<String> = { emptyList() },
    private val log: TriggerLogSink? = null,
    gate: ArmingGate = ArmingGate.PER_TRIGGER,
    private val clock: () -> Long = { System.currentTimeMillis() },
    /** Run once by [close] (e.g. unsubscribing a [UnionTriggerSource] from the registry). */
    private val onClose: () -> Unit = {},
) {
    public val decider: VoiceTriggerDecider = VoiceTriggerDecider(arming, gate)
    private val _commands = MutableSharedFlow<TriggerCommand>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    /** Fired commands, one per utterance at most. Hot: collect before starting the engine. */
    public val commands: SharedFlow<TriggerCommand> get() = _commands
    private var job: Job? = null

    /** Feeds one result by hand (tests, or a host that collects the engine itself). Returns what happened. */
    public fun process(result: VoiceResult): VoiceStep {
        val step = decider.onResult(result, clock(), triggers(), context(), sensitivity(), kindsOff())
        if (step.entry.dropped != VoiceDrop.PARTIAL) log?.invoke(step.entry)
        step.fired?.let { _commands.tryEmit(it) }
        return step
    }

    /** Starts collecting [results] in [scope]; a second call restarts. */
    public fun start(scope: CoroutineScope): Job {
        stop()
        val j = scope.launch { results.collect { process(it) } }
        job = j
        return j
    }

    public fun stop() { job?.cancel(); job = null }

    private var closed = false

    /** Stops and releases what the bridge was given to watch (the registry subscription of [AxfTriggers.voiceBridge]). */
    public fun close() {
        stop()
        if (closed) return
        closed = true
        onClose()
    }

    public val running: Boolean get() = job?.isActive == true
}
