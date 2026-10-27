package ai.amberx.axf.speech

import ai.amberx.axf.kernel.speech.SpeakOutcome
import ai.amberx.axf.kernel.speech.SpeechQueueEvent

/** A TextToSpeech UtteranceProgressListener callback, platform-free. */
public sealed class UtteranceCallback {
    public abstract val utteranceId: String
    public data class Start(override val utteranceId: String) : UtteranceCallback()
    public data class Done(override val utteranceId: String) : UtteranceCallback()
    public data class Error(override val utteranceId: String, val code: Int? = null) : UtteranceCallback()
    public data class Stop(override val utteranceId: String, val interrupted: Boolean) : UtteranceCallback()
}

/**
 * Utterance callbacks → speech@1 queue events (pure). onStart = `started`, onDone = `done/done`,
 * onError = `done/failed`, onStop = `done/stopped`.
 */
public object Utterances {
    public fun event(cb: UtteranceCallback): SpeechQueueEvent = when (cb) {
        is UtteranceCallback.Start -> SpeechQueueEvent.Started
        is UtteranceCallback.Done -> SpeechQueueEvent.Done(SpeakOutcome.DONE)
        is UtteranceCallback.Error -> SpeechQueueEvent.Done(SpeakOutcome.FAILED)
        is UtteranceCallback.Stop -> SpeechQueueEvent.Done(SpeakOutcome.STOPPED)
    }

    /** The outcome a callback ends an utterance with, or null for a non-final callback (start). */
    public fun outcome(cb: UtteranceCallback): SpeakOutcome? = (event(cb) as? SpeechQueueEvent.Done)?.outcome
}

/**
 * Waits for utterances by id (pure, thread-safe). The provider registers a waiter per utterance; the first final
 * callback (or [stopAll]) resolves it exactly once.
 */
public class UtteranceTracker(private val prefix: String = "axf-speech") {
    private val waiting = LinkedHashMap<String, (SpeakOutcome) -> Unit>()
    private var counter: Long = 0

    @Synchronized public fun newId(): String { counter += 1; return "$prefix-$counter" }

    @Synchronized public fun await(id: String, onOutcome: (SpeakOutcome) -> Unit) { waiting[id] = onOutcome }

    /** Ends [id] with [outcome]; false when nothing waited for it (already ended). */
    public fun finish(id: String, outcome: SpeakOutcome): Boolean {
        val w = synchronized(this) { waiting.remove(id) } ?: return false
        w(outcome)
        return true
    }

    /** Feeds a callback; returns the queue event it means. */
    public fun on(cb: UtteranceCallback): SpeechQueueEvent {
        Utterances.outcome(cb)?.let { finish(cb.utteranceId, it) }
        return Utterances.event(cb)
    }

    /** Forgets [id] without resolving it (the caller was cancelled). */
    @Synchronized public fun cancel(id: String) { waiting.remove(id) }

    /** Ends every waiting utterance as stopped. */
    public fun stopAll() {
        val all = synchronized(this) { val l = waiting.values.toList(); waiting.clear(); l }
        for (w in all) w(SpeakOutcome.STOPPED)
    }

    @get:Synchronized public val pending: Int get() = waiting.size
}
