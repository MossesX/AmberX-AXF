package ai.amberx.axf.phoneconnect.notify

import ai.amberx.axf.phoneconnect.approvals.Approvals
import ai.amberx.axf.phoneconnect.commands.OpenUrlRules
import ai.amberx.axf.phoneconnect.overlay.OverlayStore
import ai.amberx.axf.phoneconnect.overlay.Popup
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationManagerCompat
import java.util.ArrayDeque

/**
 * A phone notification from the console (phone.notify): a popup in the overlay (alert or notification style) and a
 * system notification on its channel. Skipped when its type is switched off. A link only ever opens an amberxai.com
 * https page. The last 20 are kept for the toolbar's Notifications button.
 */
object Notifier {
    private val recent = ArrayDeque<Popup>()

    @SuppressLint("MissingPermission")
    fun show(context: Context, kind: String, title: String, body: String, url: String): Boolean {
        val type = Channels.typeOf(kind)
        if (!Channels.enabled(context, type) || title.isBlank()) return false
        val link = runCatching { OpenUrlRules.allowed(url) }.getOrDefault("")
        val id = "n-${System.currentTimeMillis()}"
        val popup = Popup(id, if (type == Channels.ALERTS) "alert" else "notification", title.take(120), body.take(600), link, if (link.isNotEmpty()) listOf("open", "dismiss") else listOf("dismiss"))
        OverlayStore.of(context).show(popup)
        synchronized(recent) { recent.addFirst(popup); while (recent.size > 20) recent.removeLast() }
        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            val b = Approvals.lockScreenSafe(context, type, popup.title, popup.body)
            if (link.isNotEmpty()) b.setContentIntent(PendingIntent.getActivity(context, id.hashCode(), Intent(Intent.ACTION_VIEW, Uri.parse(link)), PendingIntent.FLAG_IMMUTABLE))
            NotificationManagerCompat.from(context).notify(id.hashCode(), b.build())
        }
        return true
    }

    /** The toolbar's Notifications button: the latest few again as popups. */
    fun showRecent(context: Context) {
        val store = OverlayStore.of(context)
        synchronized(recent) { recent.take(3).forEach(store::show) }
    }
}
