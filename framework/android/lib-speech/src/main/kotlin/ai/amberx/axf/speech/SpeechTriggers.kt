package ai.amberx.axf.speech

import ai.amberx.axf.kernel.speech.SpeechQueueEvent
import ai.amberx.axf.kernel.triggers.Thresholds
import ai.amberx.axf.kernel.triggers.Trigger
import ai.amberx.axf.kernel.triggers.TriggerArming
import ai.amberx.axf.kernel.triggers.TriggerCommand
import ai.amberx.axf.kernel.triggers.TriggerKinds
import ai.amberx.axf.kernel.triggers.TriggerSource

/** One spoken control of the reader: an action id, its label, its default phrases and the queue event it sends. */
public data class SpeechCommand(val action: String, val label: String, val phrases: List<String>, val event: SpeechQueueEvent)

/**
 * The reader's controls as data. lib-speech registers them as actions (ActionBus) and as permanent voice triggers
 * (kernel [ai.amberx.axf.kernel.triggers.TriggerRegistry]); a trigger host that fires one calls
 * [AxfSpeech.handle] (or the action runs through the bus). Pure: no Android.
 */
public object SpeechCommands {
    public const val PAUSE: String = "speech.pause"
    public const val RESUME: String = "speech.resume"
    public const val SKIP: String = "speech.skip"
    public const val FASTER: String = "speech.faster"
    public const val SLOWER: String = "speech.slower"
    /** says the current (or last) item again */
    public const val REPEAT: String = "speech.repeat"
    /** stops reading and clears the queue */
    public const val STOP: String = "speech.stop"

    public val ALL: List<SpeechCommand> = listOf(
        SpeechCommand(PAUSE, "Pause reading", listOf("pause", "pause reading"), SpeechQueueEvent.Pause),
        SpeechCommand(RESUME, "Resume reading", listOf("resume", "continue reading"), SpeechQueueEvent.Resume),
        SpeechCommand(SKIP, "Skip", listOf("skip", "skip this"), SpeechQueueEvent.Skip),
        SpeechCommand(FASTER, "Read faster", listOf("faster", "read faster"), SpeechQueueEvent.Faster),
        SpeechCommand(SLOWER, "Read slower", listOf("slower", "read slower"), SpeechQueueEvent.Slower),
        SpeechCommand(REPEAT, "Repeat", listOf("repeat", "say that again"), SpeechQueueEvent.Again),
        SpeechCommand(STOP, "Stop reading", listOf("stop reading"), SpeechQueueEvent.Clear),
    )

    public val ACTIONS: List<String> = ALL.map { it.action }

    public fun get(action: String): SpeechCommand? = ALL.firstOrNull { it.action == action }

    /** The queue event an action id means, or null when it isn't a speech action. */
    public fun event(action: String): SpeechQueueEvent? = get(action)?.event
}

/** The reader's voice triggers (triggers@1 data), ready for the kernel TriggerRegistry. */
public object SpeechTriggers {
    /**
     * One permanent voice trigger per [SpeechCommands] entry: id = action id, the default phrases, 80 %, no arming.
     * [worksIn] limits them to contexts (empty = anywhere, the default).
     */
    public fun all(module: String = SpeechModule.ID, worksIn: List<String> = emptyList()): List<Trigger> = SpeechCommands.ALL.map { c ->
        Trigger(
            id = c.action, kind = TriggerKinds.VOICE, source = TriggerSource.PERMANENT, module = module, label = c.label, phrases = c.phrases,
            action = c.action, args = null, threshold = Thresholds.DEFAULT, worksIn = worksIn, arming = TriggerArming.ALWAYS,
            enabled = true, cooldownMs = Thresholds.DEFAULT_COOLDOWN_MS, mutedUntil = 0L,
        )
    }

    /** The queue event a fired trigger command means, or null when it isn't one of the reader's. */
    public fun event(cmd: TriggerCommand): SpeechQueueEvent? = SpeechCommands.event(cmd.action)
}
