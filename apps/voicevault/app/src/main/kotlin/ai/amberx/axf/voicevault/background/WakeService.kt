package ai.amberx.axf.voicevault.background

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.speech.SpeechRecognizer
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.Heard
import ai.amberx.axf.voice.ListenOptions
import ai.amberx.axf.voice.SpeechInput
import ai.amberx.axf.voicevault.App
import ai.amberx.axf.voicevault.MainActivity
import ai.amberx.axf.voicevault.vault.Cmd
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * The background listener: a foreground service (type microphone, with its "Listening for …" notification) that,
 * while Voice Vault isn't on screen, listens only for the global trigger and then opens the app at the unlock step.
 *
 * - Pauses whenever the app is on screen (the app's own listener has the mic then).
 * - On-device recognizer only (lib-voice secret mode): nothing it hears leaves the phone; without one it doesn't run.
 * - Only matches the trigger: nothing else it hears is kept, shown or acted on. The vault stays locked.
 * - Started only from the foreground (Android's rule for microphone services); not restarted by the system after a kill.
 */
class WakeService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { WakeListener.stoppedFromNotification(); stopSelf(); return START_NOT_STICKY }
        val session = (application as App).appModule.session
        try {
            val n = listeningNotification(session.wakePhrases())
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTE_LISTENING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
            else startForeground(NOTE_LISTENING, n)
        } catch (e: Exception) {
            WakeListener.set(WakeState.Off("Android didn't allow background listening: ${e.message ?: e.javaClass.simpleName}"))
            stopSelf(); return START_NOT_STICKY
        }
        if (job?.isActive != true) job = scope.launch { run() }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        if (WakeListener.state.value !is WakeState.Off) WakeListener.set(WakeState.Off("Stopped. It starts again next time you open the app."))
        super.onDestroy()
    }

    private suspend fun run() {
        val session = (application as App).appModule.session
        val voice = session.voiceInput ?: run { WakeListener.set(WakeState.Off("Voice isn't available on this phone.")); stopSelf(); return }
        session.inApp.collectLatest { inApp ->
            WakeListener.blocker(this, session.backgroundOn)?.let { WakeListener.set(WakeState.Off(it)); stopSelf(); return@collectLatest }
            if (inApp) { WakeListener.set(WakeState.PausedInApp); return@collectLatest }
            listenLoop(voice, session.wakePhrases()) ?: stopSelf()
        }
    }

    /** Listens until cancelled (the app came on screen). Returns null when it has to stop for good (state says why). */
    private suspend fun listenLoop(voice: AxfVoice, phrases: List<String>): Unit? {
        if (phrases.isEmpty()) { WakeListener.set(WakeState.Off("No global trigger set. Add one in Settings → Global trigger and commands.")); return null }
        updateNotification(phrases)
        var failures = 0
        while (currentCoroutineContext().isActive) {
            WakeListener.set(WakeState.Listening(phrases))
            var hit = false
            val heard: Heard? = coroutineScope {
                lateinit var listen: Deferred<Heard>
                // Partial results let it react mid-sentence instead of waiting for the end of what was said.
                listen = async {
                    voice.input.listen(ListenOptions(language = voice.language, preferOffline = true, secret = true, allowOnlineSecret = false, maxResults = 5,
                        onPartial = { text -> if (!hit && isTrigger(voice, listOf(text))) { hit = true; listen.cancel() } }))
                }
                try { listen.await() } catch (e: CancellationException) { if (hit) null else throw e }
            }
            if (hit || (heard is Heard.Text && isTrigger(voice, heard.alternatives))) { wake(); delay(WAKE_COOLDOWN_MS); continue }
            when (heard) {
                is Heard.Failed -> when (heard.code) {
                    SpeechInput.NO_ON_DEVICE -> { WakeListener.set(WakeState.Off("This phone has no on-device speech recognition, so it won't listen in the background.")); return null }
                    -1, SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> { WakeListener.set(WakeState.Off("Needs the microphone permission. Open the app and tap the mic once.")); return null }
                    else -> { failures++; delay((1_000L shl failures.coerceAtMost(5)).coerceAtMost(30_000L)) }
                }
                else -> failures = 0 // silence or other words: keep listening
            }
        }
        return Unit
    }

    private fun isTrigger(voice: AxfVoice, heard: List<String>): Boolean = voice.commands.match(heard, listOf(Cmd.WAKE), 0.8) != null

    /** Opens Voice Vault: by itself when "Display over other apps" is allowed, else a full-screen alert (an alert to tap when Android limits those). */
    private fun wake() {
        WakeListener.set(WakeState.Heard(System.currentTimeMillis()))
        val open = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
            .putExtra(WakeListener.EXTRA_WAKE, true)
        if (Settings.canDrawOverlays(this) && runCatching { startActivity(open) }.isSuccess) return
        val pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_WAKE, "Trigger heard", NotificationManager.IMPORTANCE_HIGH).apply { description = "Opens Voice Vault when you say your global trigger" })
        nm.notify(NOTE_WAKE, Notification.Builder(this, CH_WAKE)
            .setSmallIcon(android.R.drawable.ic_lock_lock).setContentTitle("Voice Vault").setContentText("Heard you. Tap to unlock.")
            .setCategory(Notification.CATEGORY_CALL).setVisibility(Notification.VISIBILITY_PRIVATE)
            .setAutoCancel(true).setContentIntent(pi).setFullScreenIntent(pi, true).setTimeoutAfter(30_000).build())
    }

    private fun listeningNotification(phrases: List<String>): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_LISTEN, "Listening for your trigger", NotificationManager.IMPORTANCE_LOW).apply { description = "Shown while Voice Vault listens in the background"; setShowBadge(false) })
        val openApp = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 3, Intent(this, WakeService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val words = phrases.take(3).joinToString(" or ") { "“$it”" }.ifEmpty { "your global trigger" }
        return Notification.Builder(this, CH_LISTEN)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Voice Vault is listening")
            .setContentText("Only for $words. Nothing else is kept.").setOngoing(true).setContentIntent(openApp)
            .addAction(Notification.Action.Builder(null, "Stop listening", stop).build()).build()
    }

    private fun updateNotification(phrases: List<String>) {
        getSystemService(NotificationManager::class.java).notify(NOTE_LISTENING, listeningNotification(phrases))
    }

    companion object {
        const val ACTION_STOP = "ai.amberx.axf.voicevault.STOP_LISTENING"
        private const val CH_LISTEN = "voicevault.listening"
        private const val CH_WAKE = "voicevault.wake"
        private const val NOTE_LISTENING = 41
        const val NOTE_WAKE = 42
        private const val WAKE_COOLDOWN_MS = 4_000L
    }
}
