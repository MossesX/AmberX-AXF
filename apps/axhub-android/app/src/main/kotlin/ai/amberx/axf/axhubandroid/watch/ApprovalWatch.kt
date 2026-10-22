package ai.amberx.axf.axhubandroid.watch

import android.content.Context
import ai.amberx.axf.hub.HubClient
import ai.amberx.axf.hub.HubFeedStatus
import ai.amberx.axf.hub.HubState
import ai.amberx.axf.kernel.work.DelayRule
import ai.amberx.axf.kernel.work.IntervalBounds
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.OutcomeRule
import ai.amberx.axf.kernel.work.RunCondition
import ai.amberx.axf.work.ForegroundSpec
import ai.amberx.axf.work.PollJob
import ai.amberx.axf.work.PollJobs

/**
 * AXHub's approval watcher as a framework work job (lib-work): the body checks the hub's approvals feed once and alerts
 * once per new approval; everything about *when* (the user's interval, 5-minute back-off while signed out or not an
 * admin, one "sign in" notice per signed-out spell, stop when watching is off, restart after a reboot or update) is
 * data in [spec], decided by the kernel's work engine and carried out by the framework's foreground service.
 *
 * Outcomes are the hub feed statuses. The body only calls lib-hub + lib-notifications.
 */
object ApprovalWatch {
    const val JOB = "axhub.approvals"
    const val NOTICE_SIGN_IN = "sign-in"
    const val FLAG_WATCHING = "watching"
    private const val SIGNED_OUT_MS = 5 * 60_000L

    /** The same job the framework fixture replays (spec/fixtures/work.json → specs.approvals). */
    val spec: JobSpec = JobSpec(
        id = JOB,
        kind = "poll",
        label = "Watch axHub approvals",
        module = "ai.amberx.axf.axhubandroid",
        interval = IntervalBounds(defaultMs = 30_000, minMs = 15_000, maxMs = 300_000),
        outcomes = mapOf(
            HubFeedStatus.OK.id to OutcomeRule(DelayRule.Interval, endsSpell = true),
            HubFeedStatus.SIGNED_OUT.id to OutcomeRule(DelayRule.Fixed(SIGNED_OUT_MS), notice = NOTICE_SIGN_IN),
            HubFeedStatus.NOT_ADMIN.id to OutcomeRule(DelayRule.Fixed(SIGNED_OUT_MS), notice = NOTICE_SIGN_IN),
            HubFeedStatus.UNREACHABLE.id to OutcomeRule(DelayRule.Interval),
        ),
        conditions = listOf(RunCondition(FLAG_WATCHING)),
        foreground = true,
        restartOnBoot = true,
    )

    /** One check: feed → HubState → seen ids → clear gone alerts, alert fresh ones. Returns the feed status as the outcome. */
    suspend fun check(context: Context): String {
        val prefs = hubPrefs(context)
        val f = HubClient.Default.feed(prefs.base)
        HubState.update(f)
        // Patches serves the phone's notifications for the hub, the Console and Pilot (Brett, Oct 21 2026): while it is
        // installed AXHub stays quiet (still tracks what it has seen, so nothing old pops up if Patches goes away).
        val quiet = patchesInstalled(context)
        if (f.status == HubFeedStatus.OK) {
            val plan = prefs.track(f.pending.map { it.id })
            if (quiet) { plan.gone.forEach { Alerts.clearApproval(context, it) }; return f.status.id }
            plan.gone.forEach { Alerts.clearApproval(context, it) } // decided elsewhere or expired
            f.pending.filter { it.id in plan.fresh }.forEach { Alerts.approval(context, it, prefs.fullScreen) }
        }
        return f.status.id
    }

    /** Patches (ai.amberx.axf.patches) is on this phone: it serves the notifications instead (manifest `<queries>` lists it). */
    fun patchesInstalled(context: Context): Boolean = runCatching {
        @Suppress("DEPRECATION") context.packageManager.getPackageInfo(PATCHES_PACKAGE, 0); true
    }.getOrDefault(false)
    const val PATCHES_PACKAGE = "ai.amberx.axf.patches"

    /** What the ongoing notification says, from the last feed (rebuilt by the service after every run). */
    private fun watchingNote(): Pair<Int, String?> {
        val f = HubState.feed.value ?: return 0 to null
        return when (f.status) {
            HubFeedStatus.OK -> f.count to null
            HubFeedStatus.SIGNED_OUT -> 0 to "Signed out of the hub"
            HubFeedStatus.NOT_ADMIN -> 0 to "This account isn't a hub admin"
            HubFeedStatus.UNREACHABLE -> 0 to "Can't reach the hub right now"
        }
    }

    fun job(context: Context): PollJob {
        val app = context.applicationContext
        return PollJob(
            spec = spec,
            flags = { mapOf(FLAG_WATCHING to hubPrefs(app).watching) },
            body = { check(app) },
            foreground = ForegroundSpec(Alerts.ID_WATCH, Alerts.channelSpecs) { ctx, _ -> val (waiting, note) = watchingNote(); Alerts.watching(ctx, waiting, note) },
            intervalMs = { hubPrefs(app).intervalSec * 1000L },
            onNotice = { ctx, id, outcome -> if (id == NOTICE_SIGN_IN) Alerts.signedOut(ctx, notAdmin = outcome == HubFeedStatus.NOT_ADMIN.id) },
            onRunning = { HubState.setRunning(it) },
        )
    }

    fun start(context: Context, checkNow: Boolean = false) = PollJobs.start(context, JOB, checkNow)
    fun stop(context: Context) = PollJobs.stop(context, JOB)
    fun setInterval(context: Context, sec: Int) = PollJobs.setInterval(context, JOB, sec * 1000L)
}
