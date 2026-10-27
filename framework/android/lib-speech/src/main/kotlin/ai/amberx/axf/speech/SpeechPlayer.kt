package ai.amberx.axf.speech

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.speech.RepeatMode
import ai.amberx.axf.kernel.speech.SpeakOptions
import ai.amberx.axf.kernel.speech.SpeakOutcome
import ai.amberx.axf.kernel.speech.SpeechEffect
import ai.amberx.axf.kernel.speech.SpeechItem
import ai.amberx.axf.kernel.speech.SpeechProvider
import ai.amberx.axf.kernel.speech.SpeechQueue
import ai.amberx.axf.kernel.speech.SpeechQueueEvent
import ai.amberx.axf.kernel.speech.SpeechQueueState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Runs the kernel [SpeechQueue] reducer against a [SpeechProvider]. The player decides nothing itself: every
 * control is a [SpeechQueueEvent], and it only carries out the reducer's effects (speak the current item at the
 * queue's rate, stop the provider), then reports `started` / `done` back.
 *
 * - Each speak gets a generation number; a stop or a newer speak makes older completions stale, so a late
 *   "stopped" callback never moves the queue.
 * - A provider stop always finishes before the next speak starts.
 * - When every item in a row fails (no engine), the queue is cleared instead of looping (repeat all).
 * - Audio focus: held while there is something to say (and while paused by a transient loss); see [FocusPolicy].
 *
 * Thread-safe; provider calls run in [scope].
 */
public class SpeechPlayer(
    private val provider: SpeechProvider,
    private val scope: CoroutineScope,
    initialRate: Double = SpeechQueue.RATE_DEFAULT,
    initialRepeat: RepeatMode = RepeatMode.NONE,
    private val focus: SpeechFocus = SpeechFocus.NONE,
    /** options for an item without its own (voice, pitch, language); the rate always comes from the queue */
    private val defaults: () -> SpeakOptions? = { null },
) {
    private val lock = Any()
    private val _state = MutableStateFlow(SpeechQueue.initial(initialRate, initialRepeat))
    public val state: StateFlow<SpeechQueueState> = _state.asStateFlow()
    private val _lastOutcome = MutableStateFlow<SpeakOutcome?>(null)
    /** How the last utterance ended (null before the first). */
    public val lastOutcome: StateFlow<SpeakOutcome?> = _lastOutcome.asStateFlow()

    private var generation: Long = 0
    private var lastStop: Job? = null
    private var nextId: Long = 0
    private var failuresInARow: Int = 0
    private var focusHeld: Boolean = false
    private var pausedByFocus: Boolean = false

    /** The provider this player speaks with. */
    public val providerId: String get() = provider.id

    /** Sends one event through the reducer and carries out its effects. */
    public fun dispatch(event: SpeechQueueEvent) {
        // any control (not a provider report) ends a focus-driven pause: the user is in charge again
        process(event, resetFocusPause = event !is SpeechQueueEvent.Started && event !is SpeechQueueEvent.Done)
    }

    private fun process(event: SpeechQueueEvent, resetFocusPause: Boolean) {
        synchronized(lock) {
            if (resetFocusPause) pausedByFocus = false
            val work = ArrayList<SpeechQueueEvent>()
            work += event
            var i = 0
            while (i < work.size) {
                val step = SpeechQueue.reduce(_state.value, work[i])
                i += 1
                _state.value = step.state
                for (fx in step.effects) when (fx) {
                    is SpeechEffect.Stop -> { generation += 1; stopProvider() }
                    is SpeechEffect.Speak -> { generation += 1; speak(fx, generation); work += SpeechQueueEvent.Started }
                }
            }
            syncFocus()
        }
    }

    /** Queues [text]; `next = true` puts it right after the current item; `opts.interrupt` clears the queue first. Returns the item id. */
    public fun enqueue(text: String, opts: SpeakOptions? = null, next: Boolean = false): String {
        val id = synchronized(lock) { nextId += 1; "s$nextId" }
        if (opts?.interrupt == true) dispatch(SpeechQueueEvent.Clear)
        dispatch(SpeechQueueEvent.Enqueue(SpeechItem(id, text, opts?.copy(interrupt = false)), next))
        return id
    }

    /** Stops whatever is being read and says [text] now. */
    public fun say(text: String, opts: SpeakOptions? = null): String = enqueue(text, (opts ?: SpeakOptions()).copy(interrupt = true))

    public fun pause(): Unit = dispatch(SpeechQueueEvent.Pause)
    public fun resume(): Unit = dispatch(SpeechQueueEvent.Resume)
    public fun skip(): Unit = dispatch(SpeechQueueEvent.Skip)
    public fun back(): Unit = dispatch(SpeechQueueEvent.Back)
    public fun faster(): Unit = dispatch(SpeechQueueEvent.Faster)
    public fun slower(): Unit = dispatch(SpeechQueueEvent.Slower)
    /** Says the current (or last) item again. */
    public fun again(): Unit = dispatch(SpeechQueueEvent.Again)
    public fun setRate(rate: Double): Unit = dispatch(SpeechQueueEvent.Rate(rate))
    public fun setRepeat(mode: RepeatMode): Unit = dispatch(SpeechQueueEvent.Repeat(mode))
    /** Stops reading and clears the queue. */
    public fun stop(): Unit = dispatch(SpeechQueueEvent.Clear)

    /** True while something is being said or waits to be said (not paused). */
    public val active: Boolean get() = _state.value.let { it.speaking || it.current != null }

    /** Audio focus changed (called by the [SpeechFocus] it was acquired with). */
    public fun onFocusChange(change: FocusChange) {
        synchronized(lock) {
            val d = FocusPolicy.decide(change, pausedByFocus, _state.value.paused)
            when (d.action) {
                FocusAction.PAUSE -> { pausedByFocus = d.pausedByFocus; process(SpeechQueueEvent.Pause, resetFocusPause = false) }
                FocusAction.RESUME -> { pausedByFocus = false; process(SpeechQueueEvent.Resume, resetFocusPause = false) }
                FocusAction.NONE -> pausedByFocus = d.pausedByFocus
            }
            syncFocus()
        }
    }

    /* ---------- effects ---------- */

    private fun stopProvider() {
        val before = lastStop
        lastStop = scope.launch {
            before?.join()
            try { provider.stop() } catch (c: CancellationException) { throw c } catch (_: Throwable) {}
        }
    }

    private fun speak(fx: SpeechEffect.Speak, gen: Long) {
        val stopFirst = lastStop
        val base = defaults()
        val own = fx.item.opts
        val opts = SpeakOptions(
            voice = own?.voice ?: base?.voice,
            rate = fx.rate,
            pitch = own?.pitch ?: base?.pitch,
            language = own?.language ?: base?.language,
        )
        scope.launch {
            stopFirst?.join()
            // replaced or stopped while waiting for the stop: don't start a stale utterance
            if (synchronized(lock) { gen != generation }) return@launch
            val result: AxfResult<SpeakOutcome> = try {
                provider.speak(fx.item.text, opts)
            } catch (c: CancellationException) {
                throw c
            } catch (t: Throwable) {
                AxfResult.err(AxfFailure.Unexpected(t.message ?: "speech failed", t))
            }
            finished(gen, result.getOrNull() ?: SpeakOutcome.FAILED)
        }
    }

    private fun finished(gen: Long, outcome: SpeakOutcome) {
        synchronized(lock) {
            if (gen != generation) return // stopped or replaced: the queue already moved on
            _lastOutcome.value = outcome
            if (outcome == SpeakOutcome.FAILED) {
                failuresInARow += 1
                if (failuresInARow >= maxOf(1, _state.value.items.size)) { failuresInARow = 0; dispatch(SpeechQueueEvent.Clear); return }
            } else if (outcome == SpeakOutcome.DONE) {
                failuresInARow = 0
            }
            dispatch(SpeechQueueEvent.Done(outcome))
        }
    }

    private fun syncFocus() {
        val s = _state.value
        val want = s.speaking || s.current != null || pausedByFocus
        if (want && !focusHeld) {
            focusHeld = true
            focus.acquire { change -> onFocusChange(change) }
        } else if (!want && focusHeld) {
            focusHeld = false
            focus.release()
        }
    }
}
