package ai.amberx.axf.phoneconnect.watch

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import ai.amberx.axf.phoneconnect.link.LinkRules
import org.json.JSONObject

/** What a command handler answers: an ack status first, then a result payload or an error. */
sealed class Outcome {
    data class Done(val payload: JSONObject = JSONObject(), val state: JSONObject? = null, val tap: String? = null) : Outcome()
    data class Failed(val code: String, val message: String) : Outcome()
    /** Shown or running; the result comes later through [Commands.later] (an approval tap, a recorder stop). */
    data class Pending(val status: String) : Outcome()
}

/**
 * The AXPP tools the phone runs (PHONE-CONNECT.md → phone-command@1 "On the wire"). Open registry: a later app build adds
 * a tool here and its capability in LinkRules.CAPABILITIES.
 */
object Commands {
    fun interface Handler { fun run(ctx: Context, id: String, args: JSONObject): Outcome }

    private val handlers = mutableMapOf<String, Handler>()
    fun register(tool: String, h: Handler) { handlers[tool] = h }
    fun handles(tool: String): Boolean = tool in handlers
    fun run(ctx: Context, tool: String, id: String, args: JSONObject): Outcome =
        handlers[tool]?.run(ctx, id, args) ?: Outcome.Failed("not_found", "This app can't run $tool: install the current Phone Connect app.")

    /** Results that arrive after the command was acked (taps, recorder stops): the watch loop sends them. */
    val later: MutableList<Pair<String, Outcome>> = java.util.Collections.synchronizedList(mutableListOf())

    fun foreground(): Boolean = runCatching { ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) }.getOrDefault(false)

    init {
        // browser.open: straight away while the app is in front; otherwise a high-priority notification with a
        // full-screen intent (Android blocks activity starts from the background).
        register("browser.open") { ctx, id, args ->
            val url = args.optString("url")
            if (!LinkRules.openable(url)) return@register Outcome.Failed("denied", "Only https pages open on the phone.")
            if (foreground()) {
                ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                Outcome.Done(JSONObject().put("opened", true).put("how", "direct"))
            } else {
                val pi = Notifier.viewIntent(ctx, url, Notifier.idOf(id))
                val n = NotificationCompat.Builder(ctx, Notifier.CH_OPEN).setSmallIcon(android.R.drawable.ic_menu_view)
                    .setContentTitle("Open on your phone").setContentText(url.take(120)).setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_CALL).setFullScreenIntent(pi, true).setContentIntent(pi).setAutoCancel(true).build()
                if (Notifier.post(ctx, Notifier.idOf(id), n)) Outcome.Done(JSONObject().put("opened", true).put("how", "full-screen-intent"))
                else Outcome.Failed("consent_required", "Notifications are off for Phone Connect, so it can't open pages from the background.")
            }
        }
    }
}
