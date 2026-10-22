package ai.amberx.axf.work

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.PlaceholderModule
import ai.amberx.axf.kernel.work.WORK_POLL_CAPABILITY
import ai.amberx.axf.kernel.work.WorkPlaceholders

/**
 * lib-work: registers the app's poll jobs with [PollJobs] **when constructed** (inside `Application.onCreate`, before any
 * receiver or sticky restart can need them), fills the platform's `android.work` placeholder (declared by
 * `AndroidPlatformModule`) and registers [PollJobs] as `axf.work.poll`. The kernel's `axf.work` (the WorkManager-style
 * [ai.amberx.axf.kernel.contract.WorkScheduler]) stays a placeholder: see [placeholders].
 *
 *   WorkModule(jobs = listOf(PollJob(spec, flags, body, foreground)))
 */
public class WorkModule(jobs: List<PollJob> = emptyList()) : BaseModule(ID, "Work") {
    init { for (job in jobs) PollJobs.register(job) }

    override val dependsOn: List<String> = listOf("ai.amberx.axf.notifications")
    override val provides: List<Capability> = listOf(
        Capability(WORK_POLL_CAPABILITY, "Poll jobs (work@1) hosted by a foreground service with boot restart"),
        Capability("android.work", "Background work on Android (foreground poll service)"),
    )

    override fun register(ctx: ModuleContext) {
        ctx.services.register(PollJobs::class, PollJobs, WORK_POLL_CAPABILITY)
        ctx.services.register(WorkModule::class, this, "android.work")
    }

    public companion object {
        public const val ID: String = "ai.amberx.axf.work"

        /** What isn't built yet: the WorkManager-backed scheduler behind the kernel's `axf.work` contract, alarms, chains. */
        public fun placeholders(): List<PlaceholderModule> = listOf(
            PlaceholderModule("ai.amberx.axf.work.manager", "Scheduled work", listOf(Capability(WorkPlaceholders.MANAGER, "WorkSpec / WorkScheduler (axf.work) on WorkManager: constrained periodic work, 15 min minimum"))),
            PlaceholderModule("ai.amberx.axf.work.alarm", "Alarms", listOf(Capability(WorkPlaceholders.ALARM, "Wall-clock alarms (AlarmManager), exact only when allowed"))),
            PlaceholderModule("ai.amberx.axf.work.chain", "Job chains", listOf(Capability(WorkPlaceholders.CHAIN, "Jobs that run after each other"))),
        )
    }
}
