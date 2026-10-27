package ai.amberx.axf.work

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.PollWorker
import ai.amberx.axf.kernel.work.WORK_POLL_CAPABILITY
import ai.amberx.axf.kernel.work.WorkPlaceholders

/**
 * lib-work: registers the app's poll jobs with [PollJobs] **when constructed** (inside `Application.onCreate`, before any
 * receiver or sticky restart can need them), fills the platform's `android.work` placeholder (declared by
 * `AndroidPlatformModule`) and registers [PollJobs] as `axf.work.poll`. The kernel's `axf.work` (the WorkManager-style
 * [ai.amberx.axf.kernel.contract.WorkScheduler]) stays a placeholder: see [placeholders].
 *
 *   WorkModule(jobs = listOf(PollJob(spec, flags, body, foreground)))
 *
 * Runtime jobs (0.1.1): every `axf.workers` contribution that is a kernel [PollWorker] (or a [PollJob]) is registered with
 * [PollJobs] — those present at [register] and every later one (a plugin registered after the app's modules); a withdrawn
 * contribution (its module stopped) is unregistered. A `foreground` PollWorker needs a notification: [workerForeground]
 * builds its [ForegroundSpec]; without one, such workers are skipped and listed in [skippedWorkers]. Other value types
 * on `axf.workers` are left alone.
 */
public class WorkModule(
    jobs: List<PollJob> = emptyList(),
    /** The ongoing notification for `foreground` workers contributed on `axf.workers`; null = skip those. */
    private val workerForeground: ((JobSpec) -> ForegroundSpec?)? = null,
) : BaseModule(ID, "Work") {
    init { for (job in jobs) PollJobs.register(job) }

    override val version: String = VERSION
    private val skipped = LinkedHashMap<String, String>()
    private val workers = WorkerSync<Any>(::workerId, ::host, PollJobs::unregister)

    /** `axf.workers` contributions that couldn't be hosted: worker id → why. */
    @Synchronized public fun skippedWorkers(): Map<String, String> = LinkedHashMap(skipped)

    /** Ids of the jobs registered from `axf.workers` (not the constructor's). */
    public fun contributedJobs(): List<String> = workers.ids()

    private fun workerId(v: Any): String = when (v) { is PollJob -> v.id; is PollWorker -> v.id; else -> "" }

    /** Registers one contribution with [PollJobs]; throws (→ [skippedWorkers]) when it can't be hosted. */
    private fun host(v: Any) {
        val id = workerId(v)
        check(PollJobs.get(id) == null || id in workers.ids()) { "job id $id is already registered by the app" }
        val job = when (v) {
            is PollJob -> v
            is PollWorker -> {
                val fg = if (v.spec.foreground) workerForeground?.invoke(v.spec) else null
                check(!v.spec.foreground || fg != null) { "foreground worker without a notification (WorkModule(workerForeground = …))" }
                PollJob(v.spec, v.flags, v.body, fg, v.intervalMs)
            }
            else -> return
        }
        PollJobs.register(job)
    }

    private fun syncWorkers(ctx: ModuleContext) {
        val failed = LinkedHashMap<String, String>()
        workers.sync(ctx.extensions.get(ExtensionPoints.WORKERS).filter { it is PollJob || it is PollWorker }) { v, e -> failed[workerId(v)] = e.message ?: e.toString() }
        synchronized(this) { skipped.clear(); skipped.putAll(failed) }
    }

    override val dependsOn: List<String> = listOf("ai.amberx.axf.notifications")
    override val provides: List<Capability> = listOf(
        Capability(WORK_POLL_CAPABILITY, "Poll jobs (work@1) hosted by a foreground service with boot restart"),
        Capability("android.work", "Background work on Android (foreground poll service)"),
    )

    override fun register(ctx: ModuleContext) {
        ctx.services.register(PollJobs::class, PollJobs, WORK_POLL_CAPABILITY)
        ctx.services.register(WorkModule::class, this, "android.work")
        syncWorkers(ctx)
        ctx.extensions.onChange(ExtensionPoints.WORKERS) { syncWorkers(ctx) }
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.work"
        /** lib-work semver. 0.1.0: poll jobs in a foreground service. 0.1.1: hosts `axf.workers` PollWorker contributions, also late ones. */
        public const val VERSION: String = "0.1.1"

        /** What isn't built yet: the WorkManager-backed scheduler behind the kernel's `axf.work` contract, alarms, chains. */
        public fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.work.manager", "Scheduled work", listOf(Capability(WorkPlaceholders.MANAGER, "WorkSpec / WorkScheduler (axf.work) on WorkManager: constrained periodic work, 15 min minimum"))),
            PlaceholderModule("ai.amberx.axf.work.alarm", "Alarms", listOf(Capability(WorkPlaceholders.ALARM, "Wall-clock alarms (AlarmManager), exact only when allowed"))),
            PlaceholderModule("ai.amberx.axf.work.chain", "Job chains", listOf(Capability(WorkPlaceholders.CHAIN, "Jobs that run after each other"))),
        )
    }
}
