package ai.amberx.axf.work

import android.app.Notification
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.JobState
import ai.amberx.axf.kernel.work.WorkEngine
import ai.amberx.axf.notifications.ChannelSpec
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The user-visible side of a foreground job: the ongoing notification [PollService] shows while the job runs (built
 * again after every result from the job's current state, so the app can show counts or a note), and the channels it
 * needs (created before the service goes foreground, so a boot restart finds them).
 */
public class ForegroundSpec(
    public val notificationId: Int,
    public val channels: List<ChannelSpec> = emptyList(),
    public val notification: (Context, JobState) -> Notification,
)

/**
 * A job an app registers with [WorkModule] / [PollJobs]: the kernel [spec] (what to do on each outcome, interval bounds,
 * conditions), [flags] the conditions read (from the app's own prefs, so a boot receiver can read them without the
 * kernel), the [body] that does one run and returns an outcome name, and hooks for what the state machine decides
 * (one-time notices, the end of a notice spell, running state). The body only calls libraries; the loop is here.
 */
public class PollJob(
    public val spec: JobSpec,
    public val flags: () -> Map<String, Boolean>,
    public val body: suspend () -> String,
    public val foreground: ForegroundSpec? = null,
    /** the user's interval choice, read when the service starts (clamped into the spec's bounds) */
    public val intervalMs: () -> Long? = { null },
    public val onNotice: (Context, id: String, outcome: String) -> Unit = { _, _, _ -> },
    public val onNoticesCleared: (Context) -> Unit = {},
    public val onRunning: (Boolean) -> Unit = {},
) {
    public val id: String get() = spec.id
    init {
        require(foreground == null || spec.foreground) { "job ${spec.id}: a ForegroundSpec needs spec.foreground = true" }
        require(!spec.foreground || foreground != null) { "job ${spec.id}: spec.foreground = true needs a ForegroundSpec" }
    }
}

/**
 * Process-wide registry of poll jobs and their running state; the service, the boot receiver and the app's screens all
 * read it. Jobs are registered when [WorkModule] is constructed (inside `Application.onCreate`), so they exist before any
 * receiver or sticky restart needs them.
 */
public object PollJobs {
    private val jobs = LinkedHashMap<String, PollJob>()
    private val running = HashMap<String, MutableStateFlow<Boolean>>()
    private val states = HashMap<String, MutableStateFlow<JobState?>>()

    /** Registers (or replaces) a job; its spec must validate (fails loudly at startup, never at 3 am). */
    public fun register(job: PollJob) {
        val check = WorkEngine.validate(job.spec.toJson())
        require(check.ok) { "job ${job.spec.id}: ${check.errors.joinToString("; ")}" }
        jobs[job.id] = job
    }
    public fun unregister(id: String) { jobs.remove(id) }
    public fun get(id: String): PollJob? = jobs[id]
    public fun all(): List<PollJob> = jobs.values.toList()

    /** Jobs whose conditions hold right now (a sticky restart runs these). */
    public fun wantedNow(): List<PollJob> = all().filter { WorkEngine.unmetConditions(it.spec, safeFlags(it)).isEmpty() }
    /** Jobs that asked to come back after a reboot or update and whose conditions hold. */
    public fun wantedAfterBoot(): List<PollJob> = all().filter { WorkEngine.shouldRestart(it.spec, safeFlags(it)) }

    public fun running(id: String): StateFlow<Boolean> = runningFlow(id).asStateFlow()
    public fun state(id: String): StateFlow<JobState?> = stateFlow(id).asStateFlow()
    public fun isRunning(id: String): Boolean = runningFlow(id).value

    internal fun setRunning(id: String, on: Boolean) {
        val f = runningFlow(id)
        if (f.value == on) return
        f.value = on
        jobs[id]?.onRunning?.invoke(on)
    }
    internal fun setState(id: String, state: JobState?) { stateFlow(id).value = state }
    private fun runningFlow(id: String) = running.getOrPut(id) { MutableStateFlow(false) }
    private fun stateFlow(id: String) = states.getOrPut(id) { MutableStateFlow<JobState?>(null) }
    internal fun safeFlags(job: PollJob): Map<String, Boolean> = runCatching { job.flags() }.getOrDefault(emptyMap())

    /** Starts the job (or restarts a running one at once with [checkNow]); a refused foreground start stops quietly. */
    public fun start(context: Context, id: String, checkNow: Boolean = false) {
        val job = jobs[id] ?: return
        val i = command(context, id, if (checkNow) PollService.ACTION_CHECK_NOW else PollService.ACTION_START)
        runCatching { if (job.foreground != null) ContextCompat.startForegroundService(context, i) else context.startService(i) }
    }
    public fun checkNow(context: Context, id: String): Unit = start(context, id, checkNow = true)

    /** Stops the job. With one registered job the whole service stops (no start needed); otherwise the service is told. */
    public fun stop(context: Context, id: String) {
        val job = jobs[id] ?: return
        if (jobs.size <= 1) { runCatching { context.stopService(Intent(context, PollService::class.java)) }; setRunning(id, false); return }
        val i = command(context, id, PollService.ACTION_STOP)
        runCatching { if (job.foreground != null) ContextCompat.startForegroundService(context, i) else context.startService(i) }
    }

    /** The user changed the interval: a running job takes it at its next sleep (a stopped one reads [PollJob.intervalMs] when it starts). */
    public fun setInterval(context: Context, id: String, ms: Long?) {
        val job = jobs[id] ?: return
        if (!isRunning(id)) return
        val i = command(context, id, PollService.ACTION_INTERVAL)
        if (ms != null) i.putExtra(PollService.EXTRA_INTERVAL_MS, ms)
        runCatching { if (job.foreground != null) ContextCompat.startForegroundService(context, i) else context.startService(i) }
    }

    /** After BOOT_COMPLETED / MY_PACKAGE_REPLACED: every job that asked for it and whose conditions hold. */
    public fun restartAfterBoot(context: Context) { for (job in wantedAfterBoot()) start(context, job.id) }

    private fun command(context: Context, id: String, action: String): Intent =
        Intent(context, PollService::class.java).setAction(action).putExtra(PollService.EXTRA_JOB, id)
}
