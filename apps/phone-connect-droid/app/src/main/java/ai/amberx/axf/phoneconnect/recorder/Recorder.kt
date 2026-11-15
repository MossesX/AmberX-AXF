package ai.amberx.axf.phoneconnect.recorder

import ai.amberx.axf.phoneconnect.notify.Channels
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * The Audio Output Recorder (moved in whole from AmberX: OutputRecordService captures what the phone plays through
 * MediaProjection playback capture, the mic only with the opt-in switch; OutputRecordQueue keeps settings and local
 * 30-minute parts named '<session> - <date> - partN'; OutputRecordUploader sends them to axHub groups, retried while
 * offline). This object is what the command channel and the toolbar call, as AxppLink did in AmberX.
 * Start is reached only after Brett's straight approval (console / axHub); Android still asks for capture consent.
 */
object Recorder {
    private const val NOTE_PROMPT = 41

    fun running(@Suppress("UNUSED_PARAMETER") context: Context): Boolean = OutputRecordService.running

    /** recorder.start: the session first, then Android's capture prompt (at once where allowed, else a tap). */
    fun start(context: Context, sessionName: String, group: String, note: String): JSONObject {
        val s = RecorderControl.sessionOf(JSONObject().put("session_name", sessionName).put("group", group).put("note", note))
        OutputRecordQueue.setSession(context, s)
        if (OutputRecordService.running) {
            OutputRecordQueue.sessionStarted(context, System.currentTimeMillis())
            return ok(status(context).put("alreadyRunning", true))
        }
        askStart(context)
        return ok(status(context).put("awaitingConsent", true))
    }

    /** The toolbar's Record button, or a start the console sent: Android's own prompt, every start. */
    @SuppressLint("MissingPermission")
    fun askStart(context: Context) {
        val consent = OutputRecordStartActivity.intent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Settings.canDrawOverlays(context) && runCatching { context.startActivity(consent) }.isSuccess) return
        val tap = PendingIntent.getActivity(context, 3, consent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val mic = OutputRecordQueue.micWanted(context)
        val n = NotificationCompat.Builder(context, Channels.RECORDER).setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Start recording" + if (mic) " (playback + mic)" else "")
            .setContentText(if (mic) "Tap to allow Android's capture prompt (phone audio + your mic)." else "Tap to allow Android's capture prompt (phone audio only, mic off).")
            .setPriority(NotificationCompat.PRIORITY_HIGH).setContentIntent(tap).setAutoCancel(true).setTimeoutAfter(10 * 60_000L).build()
        NotificationManagerCompat.from(context).notify(NOTE_PROMPT, n)
    }

    fun stop(context: Context): JSONObject {
        val was = OutputRecordService.running
        if (was) context.startService(Intent(context, OutputRecordService::class.java).setAction(OutputRecordService.ACTION_STOP).putExtra(OutputRecordService.EXTRA_REASON, "Stopped from the console."))
        else OutputRecordQueue.clearSession(context)
        consentDone(context)
        return ok(status(context).put("running", false).put("wasRunning", was))
    }

    /** recorder.status: on/off, since, session, current part, uploaded parts, the queue, the mic. */
    fun status(context: Context): JSONObject {
        val up = OutputRecordUploader.status(context)
        val rec = OutputRecordService.status()
        val s = OutputRecordQueue.session(context)
        return JSONObject()
            .put("running", OutputRecordService.running)
            .put("since", if (rec.has("startedAt") && !rec.isNull("startedAt")) rec.optString("startedAt") else "")
            .put("currentFile", if (OutputRecordService.running) OutputRecordService.currentName ?: "" else "")
            .put("mic", OutputRecordService.running && OutputRecordService.micOn)
            .put("micDefault", OutputRecordQueue.settings(context).mic)
            .put("queue", up.optInt("waiting", 0))
            .put("upload", up.optString("upload", "idle"))
            .put("session", s?.optString("name") ?: "").put("group", s?.optString("group") ?: "")
            .put("part", s?.optInt("parts") ?: 0).put("uploaded", s?.optInt("uploaded") ?: 0)
    }

    /** The console's "Record my mic too" switch (recorderMic), applied to the recorder's own setting. */
    fun applyMic(context: Context, on: Boolean) = OutputRecordQueue.saveSettings(context, JSONObject().put("mic", on))

    /** Android's prompt was answered or the start was stopped: the tap-to-start notification goes. */
    fun consentDone(context: Context) = NotificationManagerCompat.from(context).cancel(NOTE_PROMPT)

    /** Brett refused Android's capture prompt: the session is dropped; the console sees it on the next status. */
    fun consentRefused(context: Context, @Suppress("UNUSED_PARAMETER") message: String) { consentDone(context); OutputRecordQueue.clearSession(context) }

    private fun ok(data: JSONObject) = JSONObject().put("ok", true).put("data", data)
}

/** What the Monitor's heartbeat reports for recorder@1 (the console's Recorder screen reads it). */
class RecorderState private constructor(private val context: Context) {
    fun report(): JSONObject = runCatching { Recorder.status(context) }.getOrDefault(JSONObject().put("running", false))
    companion object { fun of(context: Context) = RecorderState(context.applicationContext) }
}
