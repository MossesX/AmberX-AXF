package ai.amberx.axf.phoneconnect.watch

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import ai.amberx.axf.phoneconnect.link.LinkRules
import ai.amberx.axf.phoneconnect.link.LinkState
import ai.amberx.axf.phoneconnect.link.PhoneLink
import ai.amberx.axf.phoneconnect.link.PhoneStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * The watch: a foreground service that keeps the link open (hello once, then long-poll `next`, ack, run, answer), with
 * the backoff ladder 5 · 15 · 30 · 60 s on failures. `unpaired` / `revoked` end it and clear the token.
 */
class WatchService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        Shows.register()
        Recorder.register()
        Voice.register()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Notifier.channels(this)
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, Notifier.ID_LINK, Notifier.linkNotification(this, "Connecting…"), type)
        if (loop?.isActive != true) loop = scope.launch { run() }
        return START_STICKY
    }

    private suspend fun run() {
        val store = PhoneStore(this)
        val link = PhoneLink(store)
        var failures = 0
        var greeted = false
        while (scope.isActive && store.paired && store.watch) {
            if (!greeted) {
                when (val h = link.hello(Recorder.state(this))) {
                    is PhoneLink.Reply.Ok -> { greeted = true; failures = 0; status("Connected") }
                    is PhoneLink.Reply.Fail -> { if (end(h, store)) return; failures++; status(h.message); delay(LinkRules.backoffSeconds(failures) * 1000L); continue }
                    PhoneLink.Reply.NoContent -> greeted = true
                }
            }
            flushLater(link)
            when (val r = link.next()) {
                is PhoneLink.Reply.Ok -> { failures = 0; status("Connected"); handle(link, r.json) }
                PhoneLink.Reply.NoContent -> { failures = 0; status("Connected") }
                is PhoneLink.Reply.Fail -> {
                    if (end(r, store)) return
                    if (r.status == 404) greeted = false // the console restarted: hello again
                    failures++
                    status("Offline: ${r.message}")
                    delay(LinkRules.backoffSeconds(failures) * 1000L)
                }
            }
        }
        stopSelf()
    }

    /** One AXPP call: ack, run, answer. */
    private fun handle(link: PhoneLink, call: JSONObject) {
        val id = call.optString("id")
        val payload = call.optJSONObject("payload") ?: JSONObject()
        val tool = payload.optString("tool")
        val args = payload.optJSONObject("arguments") ?: JSONObject()
        if (id.isEmpty()) return
        if (!Commands.handles(tool)) { link.error(id, "not_found", "This app can't run $tool: install the current Phone Connect app."); return }
        link.ack(id, if (tool.startsWith("recorder.")) "running" else "shown")
        answer(link, id, runCatching { Commands.run(this, tool, id, args) }.getOrElse { Outcome.Failed("unexpected", "The phone failed to run $tool (${it.javaClass.simpleName}).") })
    }

    private fun answer(link: PhoneLink, id: String, o: Outcome) {
        when (o) {
            is Outcome.Done -> link.result(id, o.payload, o.state, o.tap)
            is Outcome.Failed -> link.error(id, o.code, o.message)
            is Outcome.Pending -> Unit // acked; the result comes through Commands.later
        }
    }

    private fun flushLater(link: PhoneLink) {
        while (Commands.later.isNotEmpty()) {
            val (id, o) = Commands.later.removeAt(0)
            answer(link, id, o)
        }
    }

    private fun end(f: PhoneLink.Reply.Fail, store: PhoneStore): Boolean {
        if (f.code != "unpaired" && f.code != "revoked") return false
        store.unpair()
        status(if (f.code == "revoked") "Revoked in the console: pair again with a new code" else f.message)
        stopSelf()
        return true
    }

    private fun status(text: String) {
        LinkState.set(text)
        Notifier.post(this, Notifier.ID_LINK, Notifier.linkNotification(this, text))
    }

    override fun onDestroy() { scope.cancel(); super.onDestroy() }

    companion object {
        fun start(ctx: Context) { ContextCompat.startForegroundService(ctx, Intent(ctx, WatchService::class.java)) }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, WatchService::class.java)) }
    }
}
