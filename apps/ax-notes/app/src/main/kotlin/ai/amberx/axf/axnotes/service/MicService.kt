package ai.amberx.axf.axnotes.service

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import ai.amberx.axf.axnotes.MainActivity
import ai.amberx.axf.axnotes.R
import ai.amberx.axf.notifications.AxfNotifications
import ai.amberx.axf.notifications.ChannelImportance
import ai.amberx.axf.notifications.ChannelSpec
import ai.amberx.axf.notifications.LockScreen
import ai.amberx.axf.notifications.OngoingSpec

/**
 * AX Notes' microphone foreground service. lib-voice engines only listen while started, and Android cuts the
 * microphone off for apps in the background unless a `microphone` foreground service is running, so the app runs this
 * while it listens (hands-free listening or a dictation the user started). It holds nothing itself: the engine lives in
 * [ai.amberx.axf.axnotes.capture.VoiceLoop], which starts and stops this service as listening starts and stops.
 *
 * Started only from a user action while the app is in front (Android 12+ refuses foreground-service starts from the
 * background; the start is guarded and the engine keeps working while the app stays open).
 */
class MicService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { onStopRequest?.invoke(); stopSelf(); return START_NOT_STICKY }
        val ok = runCatching {
            AxfNotifications.channels(this, listOf(CHANNEL))
            val open = AxfNotifications.activityIntent(this, MainActivity::class.java, REQUEST_OPEN)
            val n = AxfNotifications.ongoing(this, OngoingSpec(CHANNEL.id, "AX Notes is listening", "Say “hey notes” or “take a note”. Tap to open.", R.drawable.ic_axnotes_notification), open)
            val type = if (Build.VERSION.SDK_INT >= 30) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type)
        }.isSuccess
        running = ok
        if (!ok) stopSelf()
        // Not sticky: after the process dies the engine is gone too; the user starts listening again.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    companion object {
        const val NOTIFICATION_ID: Int = 4711
        private const val REQUEST_OPEN = 4712
        const val ACTION_START: String = "ai.amberx.axf.axnotes.mic.START"
        const val ACTION_STOP: String = "ai.amberx.axf.axnotes.mic.STOP"
        val CHANNEL: ChannelSpec = ChannelSpec("axnotes.mic", "Listening", ChannelImportance.LOW, "Shown while AX Notes listens with the microphone", LockScreen.PUBLIC, vibrate = false, showBadge = false)

        /** True while the service is in the foreground. */
        @Volatile var running: Boolean = false
            private set

        /** What the app does when the service is asked to stop from outside (set by VoiceLoop). */
        @Volatile var onStopRequest: (() -> Unit)? = null

        /** False when Android refused the start (app in the background); listening then lasts while the app is open. */
        fun start(context: Context): Boolean = runCatching {
            ContextCompat.startForegroundService(context, Intent(context, MicService::class.java).setAction(ACTION_START))
        }.isSuccess

        fun stop(context: Context) { runCatching { context.stopService(Intent(context, MicService::class.java)) } }
    }
}
