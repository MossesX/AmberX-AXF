package ai.amberx.axf.patches.watch

import android.content.Context
import android.webkit.CookieManager
import ai.amberx.axf.hub.HubClient
import ai.amberx.axf.hub.HubFeedStatus
import ai.amberx.axf.hub.HubRules
import ai.amberx.axf.hub.HubState
import ai.amberx.axf.kernel.work.DelayRule
import ai.amberx.axf.kernel.work.IntervalBounds
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.OutcomeRule
import ai.amberx.axf.kernel.work.RunCondition
import ai.amberx.axf.work.ForegroundSpec
import ai.amberx.axf.work.PollJob
import ai.amberx.axf.work.PollJobs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Patches' watcher (lib-work poll job): Patches serves the phone's notifications for the Console, Pilot and axHub.
 * One run = the hub's approvals feed (lib-hub, the hub session in the WebView cookie store, the same one every tab uses)
 * + the Dev Console's alerts (`GET <console>/api/alerts`, alert@1, with the console's cookies: the hub's sign-in wall
 * lets a signed-in admin through). Approvals alert once each; console errors and warnings alert once per change; what
 * got decided, resolved or read elsewhere is cleared. Timing (interval, back-off while signed out, one "sign in" notice per
 * spell, boot restart) is data in [spec], run by the framework.
 */
object PatchesWatch {
    const val JOB = "patches.watch"
    const val NOTICE_SIGN_IN = "sign-in"
    const val FLAG_NOTIFY = "notify"
    const val PREFS = "patches_watch"
    const val K_NOTIFY = "patches.notify"
    const val K_CONSOLE = "patches.console"
    private const val K_ALERTS_SEEN = "patches.alerts.seen"
    private const val SIGNED_OUT_MS = 5 * 60_000L
    private const val MAX_BYTES = 512 * 1024
    private val LOUD = setOf("error", "critical", "warning")

    val spec: JobSpec = JobSpec(
        id = JOB,
        kind = "poll",
        label = "Patches notifications",
        module = "ai.amberx.axf.patches",
        interval = IntervalBounds(defaultMs = 30_000, minMs = 15_000, maxMs = 300_000),
        outcomes = mapOf(
            HubFeedStatus.OK.id to OutcomeRule(DelayRule.Interval, endsSpell = true),
            HubFeedStatus.SIGNED_OUT.id to OutcomeRule(DelayRule.Fixed(SIGNED_OUT_MS), notice = NOTICE_SIGN_IN),
            HubFeedStatus.NOT_ADMIN.id to OutcomeRule(DelayRule.Fixed(SIGNED_OUT_MS), notice = NOTICE_SIGN_IN),
            HubFeedStatus.UNREACHABLE.id to OutcomeRule(DelayRule.Interval),
        ),
        conditions = listOf(RunCondition(FLAG_NOTIFY)),
        foreground = true,
        restartOnBoot = true,
    )

    private fun raw(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun notifyOn(context: Context): Boolean = raw(context).getBoolean(K_NOTIFY, true)
    fun setNotify(context: Context, on: Boolean) = raw(context).edit().putBoolean(K_NOTIFY, on).apply()
    fun setConsole(context: Context, origin: String) = raw(context).edit().putString(K_CONSOLE, origin).apply()
    private fun console(context: Context): String? = HubRules.normalize(raw(context).getString(K_CONSOLE, null) ?: "https://console.amberxai.com")

    @Volatile private var openAlerts = 0

    /** One run: approvals, then console alerts. The outcome is the hub feed's status (the console part never changes timing). */
    suspend fun check(context: Context): String {
        val prefs = patchesPrefs(context)
        val f = HubClient.Default.feed(prefs.base)
        HubState.update(f)
        // AmberX serves every axHub notification on the phone (Brett, Oct 28 2026): while it is installed Patches stays
        // quiet (still tracks what it has seen, so nothing old pops up if AmberX goes away).
        val quiet = amberxInstalled(context)
        if (f.status == HubFeedStatus.OK) {
            val plan = prefs.track(f.pending.map { it.id })
            plan.gone.forEach { PatchesAlerts.clearApproval(context, it) }
            if (!quiet) f.pending.filter { it.id in plan.fresh }.forEach { PatchesAlerts.approval(context, it, prefs.fullScreen) }
        }
        runCatching { consoleAlerts(context, quiet) }
        return f.status.id
    }

    /** AmberX (ai.amberx.droid) is on this phone: every axHub push comes from it (manifest `<queries>` lists it). */
    fun amberxInstalled(context: Context): Boolean = runCatching {
        @Suppress("DEPRECATION") context.packageManager.getPackageInfo(AMBERX_PACKAGE, 0); true
    }.getOrDefault(false)
    const val AMBERX_PACKAGE = "ai.amberx.droid"

    /** The console's open alerts: alert once per key + time, clear the ones resolved or read since. */
    private suspend fun consoleAlerts(context: Context, quiet: Boolean) = withContext(Dispatchers.IO) {
        val origin = console(context) ?: return@withContext
        val cookie = CookieManager.getInstance().getCookie(origin) ?: return@withContext
        val conn = URL("$origin/api/alerts").openConnection() as HttpURLConnection
        val body = try {
            conn.instanceFollowRedirects = false // a sign-in redirect = no session here; never follow it with cookies
            conn.connectTimeout = 10_000; conn.readTimeout = 10_000; conn.useCaches = false
            conn.setRequestProperty("Cookie", cookie)
            conn.setRequestProperty("Accept", "application/json")
            if (conn.responseCode != 200) return@withContext
            conn.inputStream.use { s -> readCapped(s) } ?: return@withContext
        } finally { conn.disconnect() }
        val list = JSONObject(body).optJSONArray("alerts") ?: return@withContext
        val seen = raw(context).getStringSet(K_ALERTS_SEEN, emptySet())!!.toMutableSet()
        val open = mutableSetOf<String>()
        var count = 0
        for (i in 0 until list.length()) {
            val a = list.optJSONObject(i) ?: continue
            val key = a.optString("key").takeIf { it.isNotEmpty() && it.length <= 200 } ?: continue
            if (a.optBoolean("resolved") || a.optBoolean("ack")) { PatchesAlerts.clearConsoleAlert(context, key); continue }
            val severity = a.optString("severity", "info")
            if (severity !in LOUD) continue
            count++
            val stamp = "$key@${a.optLong("lastAt")}"
            open += stamp
            if (stamp in seen || quiet) continue
            PatchesAlerts.consoleAlert(context, key, a.optString("title", "Console alert"), a.optString("body").ifEmpty { null }, severity)
        }
        openAlerts = count
        raw(context).edit().putStringSet(K_ALERTS_SEEN, open).apply()
    }

    /** The whole reply, or null when it is over [MAX_BYTES] (works on every API level the app supports). */
    private fun readCapped(s: java.io.InputStream): String? {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (true) {
            val n = s.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            if (out.size() > MAX_BYTES) return null
        }
        return out.toString("UTF-8")
    }

    private fun note(): Pair<Int, String?> {
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
            flags = { mapOf(FLAG_NOTIFY to notifyOn(app)) },
            body = { check(app) },
            foreground = ForegroundSpec(PatchesAlerts.ID_WATCH, PatchesAlerts.channelSpecs) { ctx, _ -> val (waiting, n) = note(); PatchesAlerts.watching(ctx, waiting, openAlerts, n) },
            intervalMs = { patchesPrefs(app).intervalSec * 1000L },
            onNotice = { ctx, id, outcome -> if (id == NOTICE_SIGN_IN) PatchesAlerts.signedOut(ctx, notAdmin = outcome == HubFeedStatus.NOT_ADMIN.id) },
            onRunning = { HubState.setRunning(it) },
        )
    }

    fun start(context: Context, checkNow: Boolean = false) = PollJobs.start(context, JOB, checkNow)
    fun stop(context: Context) = PollJobs.stop(context, JOB)
}
