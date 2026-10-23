package ai.amberx.axf.work

import ai.amberx.axf.kernel.work.JobEffect
import ai.amberx.axf.kernel.work.JobEvent
import ai.amberx.axf.kernel.work.JobPhase
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.JobState
import ai.amberx.axf.kernel.work.WorkEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.coroutines.coroutineContext

/**
 * Drives one job through the kernel's state machine: every event goes to [WorkEngine.reduce], and the effects that come
 * back are carried out here (run the body, sleep, stop, notices, status) and nowhere else. Pure Kotlin (no Android):
 * the foreground service owns one runner per job; tests drive it with a test dispatcher and a fake sleep.
 *
 * Call [dispatch] from one thread (the service uses Dispatchers.Main.immediate).
 */
public class JobRunner(
    public val spec: JobSpec,
    private val flags: () -> Map<String, Boolean>,
    private val body: suspend () -> String,
    private val scope: CoroutineScope,
    private val host: Host,
    intervalMs: Long? = null,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    /** What the host shows or does for the job; the runner decides nothing itself. */
    public interface Host {
        public fun onState(runner: JobRunner, state: JobState) {}
        public fun onStatus(runner: JobRunner, outcome: String) {}
        public fun onNotice(runner: JobRunner, id: String, outcome: String) {}
        public fun onNoticesCleared(runner: JobRunner) {}
        public fun onStopped(runner: JobRunner, reason: String) {}
    }

    private val _state = MutableStateFlow(WorkEngine.initialState(spec, intervalMs))
    public val state: StateFlow<JobState> = _state.asStateFlow()
    private var work: Job? = null

    public val isActive: Boolean get() = _state.value.phase == JobPhase.RUNNING || _state.value.phase == JobPhase.SLEEPING

    public fun dispatch(event: JobEvent) { dispatchFrom(null, event) }

    private fun dispatchFrom(current: Job?, event: JobEvent) {
        val step = WorkEngine.reduce(spec, _state.value, event, runCatching { flags() }.getOrDefault(emptyMap()))
        _state.value = step.state
        host.onState(this, step.state)
        for (e in step.effects) perform(e, current)
    }

    private fun stopWork(except: Job?) {
        val w = work
        if (w != null && w !== except) w.cancel()
        work = null
    }

    private fun perform(effect: JobEffect, current: Job?) {
        when (effect) {
            is JobEffect.Run -> {
                stopWork(current)
                work = scope.launch {
                    val me = coroutineContext[Job]
                    val outcome = try { body() } catch (e: CancellationException) { throw e } catch (e: Throwable) { OUTCOME_ERROR }
                    if (work === me) work = null
                    dispatchFrom(me, JobEvent.Outcome(outcome))
                }
            }
            is JobEffect.Sleep -> {
                stopWork(current)
                work = scope.launch {
                    val me = coroutineContext[Job]
                    sleep(effect.ms)
                    if (work === me) work = null
                    dispatchFrom(me, JobEvent.Wake)
                }
            }
            is JobEffect.Stop -> { stopWork(current); host.onStopped(this, effect.reason) }
            is JobEffect.Notice -> host.onNotice(this, effect.id, effect.outcome)
            is JobEffect.ClearNotices -> host.onNoticesCleared(this)
            is JobEffect.Status -> host.onStatus(this, effect.outcome)
        }
    }

    /** Drops the running body or sleep without going through the state machine (the service is being destroyed). */
    public fun cancel() { stopWork(null) }

    public companion object {
        /** The outcome a body that throws is given; a spec may map it (else the fallback rule applies). */
        public const val OUTCOME_ERROR: String = "error"
    }
}
