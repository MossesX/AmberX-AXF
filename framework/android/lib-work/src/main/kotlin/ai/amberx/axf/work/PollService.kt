package ai.amberx.axf.work

import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import ai.amberx.axf.kernel.work.JobEvent
import ai.amberx.axf.kernel.work.JobState
import ai.amberx.axf.kernel.work.WorkEngine
import ai.amberx.axf.notifications.AxfNotifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * The host for every registered [PollJob]: one foreground service (special use) that keeps the jobs running with the
 * screen off, one [JobRunner] per job on the kernel's state machine. The service decides nothing about timing, back-off,
 * notices or stopping: those are effects from [WorkEngine.reduce]; it only goes foreground, runs bodies, sleeps, shows
 * what the effects say and stops itself when no job is left.
 *
 * Commands (intents with [EXTRA_JOB]): [ACTION_START], [ACTION_CHECK_NOW] (restart that job's loop now), [ACTION_STOP],
 * [ACTION_INTERVAL] (+ [EXTRA_INTERVAL_MS]: the user changed the interval; applies at the next sleep).
 * A null intent is Android restarting the sticky service: every job whose conditions hold comes back. When Android
 * refuses a foreground start from the background (`ForegroundServiceStartNotAllowedException`), the service stops quietly.
 */
public class PollService : Service(), JobRunner.Host {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val runners = LinkedHashMap<String, JobRunner>()
    /** The job whose notification is the service's foreground notification. */
    private var foregroundJob: String? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra(EXTRA_JOB)
        val action = intent?.action
        val targets: List<PollJob> = if (id != null) listOfNotNull(PollJobs.get(id)) else PollJobs.wantedNow()
        if (action == ACTION_STOP) {
            for (job in targets) runners[job.id]?.dispatch(JobEvent.Stop)
            return finishOrStick()
        }
        if (action == ACTION_INTERVAL) {
            val ms: Long? = intent?.takeIf { it.hasExtra(EXTRA_INTERVAL_MS) }?.getLongExtra(EXTRA_INTERVAL_MS, 0L)
            for (job in targets) runners[job.id]?.dispatch(JobEvent.Interval(ms))
            return finishOrStick()
        }
        if (targets.isEmpty()) return finishOrStick()
        val fgJob = targets.firstOrNull { it.foreground != null } ?: runners.keys.mapNotNull { PollJobs.get(it) }.firstOrNull { it.foreground != null }
        if (fgJob != null && !goForeground(fgJob)) {
            // Android refused to host it (a start from the background): tell the state machine, stop quietly.
            for (job in targets) runnerFor(job).dispatch(JobEvent.HostRefused)
            stopSelf()
            return START_NOT_STICKY
        }
        for (job in targets) runnerFor(job).dispatch(JobEvent.Start(checkNow = action == ACTION_CHECK_NOW))
        return finishOrStick()
    }

    private fun runnerFor(job: PollJob): JobRunner = runners.getOrPut(job.id) {
        PollJobs.setRunning(job.id, true)
        JobRunner(job.spec, job.flags, job.body, scope, this, job.intervalMs())
    }

    private fun finishOrStick(): Int {
        if (runners.isEmpty()) { stopSelf(); return START_NOT_STICKY }
        return START_STICKY
    }

    /** `startForeground` with the job's notification; calling it again just refreshes the notification. */
    private fun goForeground(job: PollJob): Boolean {
        val fg = job.foreground ?: return true
        val current = foregroundJob
        if (current != null && current != job.id) return true
        return try {
            if (fg.channels.isNotEmpty()) AxfNotifications.channels(this, fg.channels)
            val state = runners[job.id]?.state?.value ?: WorkEngine.initialState(job.spec, job.intervalMs())
            val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
            ServiceCompat.startForeground(this, fg.notificationId, fg.notification(this, state), type)
            foregroundJob = job.id
            true
        } catch (e: Exception) {
            false
        }
    }

    /* ---------- effects from the state machine ---------- */

    override fun onState(runner: JobRunner, state: JobState) { PollJobs.setState(runner.spec.id, state) }

    override fun onStatus(runner: JobRunner, outcome: String) {
        val job = PollJobs.get(runner.spec.id) ?: return
        val fg = job.foreground ?: return
        if (foregroundJob != job.id) return
        AxfNotifications.postOngoing(this, fg.notificationId, fg.notification(this, runner.state.value))
    }

    override fun onNotice(runner: JobRunner, id: String, outcome: String) { PollJobs.get(runner.spec.id)?.onNotice?.invoke(this, id, outcome) }
    override fun onNoticesCleared(runner: JobRunner) { PollJobs.get(runner.spec.id)?.onNoticesCleared?.invoke(this) }

    override fun onStopped(runner: JobRunner, reason: String) {
        runners.remove(runner.spec.id)
        PollJobs.setRunning(runner.spec.id, false)
        if (runners.isEmpty()) stopSelf()
    }

    override fun onDestroy() {
        for (r in runners.values) { r.cancel(); PollJobs.setRunning(r.spec.id, false) }
        runners.clear()
        foregroundJob = null
        scope.cancel()
        super.onDestroy()
    }

    public companion object {
        public const val ACTION_START: String = "ai.amberx.axf.work.START"
        public const val ACTION_CHECK_NOW: String = "ai.amberx.axf.work.CHECK_NOW"
        public const val ACTION_STOP: String = "ai.amberx.axf.work.STOP"
        public const val ACTION_INTERVAL: String = "ai.amberx.axf.work.INTERVAL"
        public const val EXTRA_JOB: String = "ai.amberx.axf.work.job"
        public const val EXTRA_INTERVAL_MS: String = "ai.amberx.axf.work.intervalMs"
    }
}

/** Starts the jobs that asked for it again after a reboot or an app update, when their conditions hold. */
public class WorkBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        PollJobs.restartAfterBoot(context)
    }
}
