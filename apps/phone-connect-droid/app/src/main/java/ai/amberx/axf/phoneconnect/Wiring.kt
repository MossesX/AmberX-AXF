package ai.amberx.axf.phoneconnect

import ai.amberx.axf.phoneconnect.approvals.Approvals
import ai.amberx.axf.phoneconnect.commands.CommandRunner
import ai.amberx.axf.phoneconnect.commands.OpenUrlRules
import ai.amberx.axf.phoneconnect.overlay.OverlayService
import ai.amberx.axf.phoneconnect.overlay.OverlayStore
import ai.amberx.axf.phoneconnect.recorder.Recorder
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/** What the overlay's buttons and popups do. Network work runs off the main thread. */
object Wiring {
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun install() {
        OverlayService.actionHandler = { ctx, action -> toolbar(ctx, action) }
        OverlayService.popupHandler = { ctx, popup, action ->
            when {
                popup.kind == "approval" && action in setOf("approve", "deny", "shelve") -> io.launch { Approvals.decide(ctx, popup.id, action) }
                action == "open" && popup.url.isNotBlank() -> runCatching { CommandRunner.open(ctx, OpenUrlRules.allowed(popup.url), "chrome") }
                else -> OverlayStore.of(ctx).dismiss(popup.id)
            }
        }
    }

    fun toolbar(ctx: Context, action: String) {
        when {
            action == "approvals" -> Approvals.showAll(ctx)
            action == "recorder" -> io.launch { if (Recorder.running(ctx)) Recorder.stop(ctx) else Recorder.askStart(ctx) }
            action == "recorder:start" -> Recorder.askStart(ctx)
            action == "recorder:stop" -> io.launch { Recorder.stop(ctx) }
            action == "notifications" -> ai.amberx.axf.phoneconnect.notify.Notifier.showRecent(ctx)
            action == "build-status" -> runCatching { CommandRunner.open(ctx, "https://console.amberxai.com/?view=builds", "chrome") }
            action.startsWith("open:") -> runCatching { CommandRunner.open(ctx, OpenUrlRules.allowed(action.removePrefix("open:")), "chrome") }
        }
    }
}
