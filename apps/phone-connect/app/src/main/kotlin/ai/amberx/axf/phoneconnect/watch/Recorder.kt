package ai.amberx.axf.phoneconnect.watch

import android.content.Context
import android.content.Intent
import ai.amberx.axf.phoneconnect.recorder.RecordService
import ai.amberx.axf.phoneconnect.recorder.RecordSession
import ai.amberx.axf.phoneconnect.recorder.RecordStartActivity
import org.json.JSONObject

/**
 * recorder.start | stop | status (recorder@1). A start was already confirmed by Brett in the console (confirm policy,
 * approvalId); Android then asks its own capture consent on the phone, so the result comes later (`consent_required`
 * on a no). Never the microphone from a command.
 */
object Recorder {
    fun state(ctx: Context): JSONObject? = JSONObject().put("recorder@1", RecordSession.state())

    fun register() {
        Commands.register("recorder.start") { ctx, id, a ->
            if (RecordSession.running) return@register Outcome.Done(JSONObject().put("running", true).put("session", RecordSession.session), JSONObject().put("recorder@1", RecordSession.state()))
            RecordSession.session = a.optString("session").take(120)
            RecordSession.group = a.optString("group").take(120)
            RecordSession.note = a.optString("note").take(600)
            RecordSession.waiting = id
            ctx.startActivity(Intent(ctx, RecordStartActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            Outcome.Pending("running")
        }
        Commands.register("recorder.stop") { ctx, _, _ ->
            val was = RecordSession.running
            ctx.startService(Intent(ctx, RecordService::class.java).setAction(RecordService.ACTION_STOP))
            Outcome.Done(JSONObject().put("stopped", was), JSONObject().put("recorder@1", RecordSession.state().put("running", false)))
        }
        Commands.register("recorder.status") { _, _, _ ->
            Outcome.Done(RecordSession.state(), JSONObject().put("recorder@1", RecordSession.state()))
        }
    }
}
