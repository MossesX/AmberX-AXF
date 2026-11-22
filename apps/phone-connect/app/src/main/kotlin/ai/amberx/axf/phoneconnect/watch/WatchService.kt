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
import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

/**
 * The watch: a foreground service that keeps the link open (hello once, then long-poll `next`, ack, run, answer), with
 * the backoff ladder 5 · 15 · 30 · 60 s on failures.
 *
 * A token the console refuses is never retried (LinkRules.verdict, the engine's `linkVerdict`): the loop ends, the
 * token is dropped, and the phone says "Disconnected: tap to re-pair" in a notification and on the pairing screen.
 * Before this the loop kept sending a dead token every minute and sat disconnected without saying so.
 *
 * It also carries Brett's Approve / Deny taps on an approval notification (ACTION_DECIDE) to the console.
 */
class WatchService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var loop: Job? = null
    @Volatile private var looping = false
    private val deciding = AtomicInteger(0)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = this
        Shows.register()
        Recorder.register()
        Voice.register()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Notifier.channels(this)
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, Notifier.ID_LINK, Notifier.linkNotification(this, if (loop?.isActive == true) LinkState.status.value else "Connecting…"), type)
        if (intent?.action == ACTION_DECIDE) decide(intent.getStringExtra(X_COMMAND), intent.getStringExtra(X_APPROVAL), intent.getStringExtra(X_DECISION))
        if (loop?.isActive != true) { looping = true; loop = scope.launch { try { run() } finally { looping = false; stopIfIdle() } } }
        return START_STICKY
    }

    private suspend fun run() {
        val store = PhoneStore(this)
        val link = PhoneLink(store)
        var failures = 0
        var uncoded = 0 // bare 401 / 403 answers in a row (no wire code: a proxy or the wall, not the plugin)
        var greeted = false
        while (scope.isActive && store.paired && store.watch) {
            val reply = if (!greeted) link.hello(Recorder.state(this)) else { flushLater(link); link.next() }
            when (reply) {
                is PhoneLink.Reply.Ok -> { failures = 0; uncoded = 0; status("Connected"); if (!greeted) greeted = true else handle(link, reply.json) }
                PhoneLink.Reply.NoContent -> { failures = 0; uncoded = 0; greeted = true; status("Connected") }
                is PhoneLink.Reply.Fail -> when (reply.verdict(uncoded)) {
                    LinkRules.Verdict.REJECTED -> { rejected(reply, store); return }
                    else -> {
                        if (reply.verdict(uncoded) == LinkRules.Verdict.HELLO) greeted = false // the console restarted: hello again
                        uncoded = if (reply.bareRefusal) uncoded + 1 else 0
                        failures++
                        status("Offline: ${reply.message}")
                        delay(LinkRules.backoffSeconds(failures) * 1000L)
                    }
                }
            }
        }
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

    /** The console refused this phone's key: drop it for good, say so, stop. Pairing again is the only way back. */
    private fun rejected(f: PhoneLink.Reply.Fail, store: PhoneStore) {
        val why = LinkRules.rejectedWhy(if (f.coded) f.code else "")
        store.reject(why)
        LinkState.set(LinkState.DISCONNECTED)
        Notifier.post(this, Notifier.ID_REPAIR, Notifier.repairNotification(this, why))
    }

    /**
     * Brett tapped Approve / Deny / Shelve on an approval's notification or its floating card: his tap goes to the
     * console, the outcome back onto both.
     */
    private fun decide(command: String?, approval: String?, decision: String?) {
        if (!LinkRules.isUuid(command) || !LinkRules.isUuid(approval) || decision !in LinkRules.DECISIONS) return
        val nid = Notifier.idOf(approval!!)
        Notifier.post(this, nid, Notifier.approvalOutcome(this, approval, "Sending your answer…", done = false))
        ApprovalOverlay.outcome(approval, "Sending your answer…", done = false)
        deciding.incrementAndGet()
        scope.launch {
            try {
                val store = PhoneStore(this@WatchService)
                // by.kind = person with a fresh tap id: the console accepts a decision only like this, over the device token (personOnly)
                val text = when (val r = PhoneLink(store).result(command!!, JSONObject().put("decision", decision), tap = UUID.randomUUID().toString())) {
                    is PhoneLink.Reply.Ok -> {
                        val relay = r.json.optJSONObject("relay")
                        if (relay == null) LinkRules.decisionOutcome(decision!!, null)
                        else LinkRules.decisionOutcome(decision!!, relay.optBoolean("ok", false), relay.optString("message"))
                    }
                    is PhoneLink.Reply.Fail -> LinkRules.decisionOutcome(decision!!, null, r.message)
                    PhoneLink.Reply.NoContent -> LinkRules.decisionOutcome(decision!!, null)
                }
                Notifier.post(this@WatchService, nid, Notifier.approvalOutcome(this@WatchService, approval, text, done = true))
                ApprovalOverlay.outcome(approval, text, done = true)
            } finally {
                deciding.decrementAndGet()
                stopIfIdle()
            }
        }
    }

    /** Stops once neither the link loop nor a decision is running (the watch switched off, unpaired, or rejected). */
    private fun stopIfIdle() { if (!looping && deciding.get() == 0) stopSelf() }

    private fun status(text: String) {
        LinkState.set(text)
        Notifier.post(this, Notifier.ID_LINK, Notifier.linkNotification(this, text))
    }

    override fun onDestroy() { if (running === this) running = null; scope.cancel(); super.onDestroy() }

    companion object {
        const val ACTION_DECIDE = "ai.amberx.axf.phoneconnect.DECIDE"
        const val X_COMMAND = "command"
        const val X_APPROVAL = "approval"
        const val X_DECISION = "decision"

        /** The service intent behind an Approve / Deny / Shelve action on an approval notification. */
        fun decideIntent(ctx: Context, commandId: String, approvalId: String, decision: String): Intent =
            Intent(ctx, WatchService::class.java).setAction(ACTION_DECIDE)
                .putExtra(X_COMMAND, commandId).putExtra(X_APPROVAL, approvalId).putExtra(X_DECISION, decision)

        /** The running watch, for a tap on the floating approval card (no service start needed from the background). */
        @Volatile private var running: WatchService? = null

        /** A tap on the floating card's Approve / Deny / Shelve: the same road as the notification's action. */
        fun decide(ctx: Context, commandId: String, approvalId: String, decision: String) {
            val w = running
            if (w != null) w.decide(commandId, approvalId, decision)
            else runCatching { ContextCompat.startForegroundService(ctx, decideIntent(ctx, commandId, approvalId, decision)) }
                .onFailure { ApprovalOverlay.outcome(approvalId, LinkRules.decisionOutcome(decision, null, "The watch is not running."), done = true) }
        }

        fun start(ctx: Context) { ContextCompat.startForegroundService(ctx, Intent(ctx, WatchService::class.java)) }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, WatchService::class.java)) }
    }
}
