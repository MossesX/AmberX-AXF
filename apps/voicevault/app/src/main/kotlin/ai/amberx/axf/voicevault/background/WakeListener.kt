package ai.amberx.axf.voicevault.background

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.speech.SpeechRecognizer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the background listener is doing, for the Voice screen's "How it works" card. */
sealed interface WakeState {
    /** Not running: [why] says what to change (setting off, mic permission, no on-device recognizer, stopped). */
    data class Off(val why: String) : WakeState
    /** Voice Vault is on screen, so its own listener has the microphone. */
    data object PausedInApp : WakeState
    /** Listening in the background for these phrases only. */
    data class Listening(val phrases: List<String>) : WakeState
    /** Heard a voice-notes start trigger: taking a note (beep, the note, where to store it). */
    data object TakingNote : WakeState
    /** Heard the trigger at [at] (epoch ms) and asked Android to open the app. */
    data class Heard(val at: Long) : WakeState
    /** Quiet hours: not listening until [until] (a time of day, e.g. "7:00"). */
    data class Quiet(val until: String) : WakeState
}

/** How a heard trigger reaches you: the app opens by itself, a full-screen alert, or an alert you tap. */
enum class WakeDelivery { POPS_OPEN, FULL_SCREEN, TAP_ALERT, BLOCKED }

/**
 * The background listener's switchboard: starts and stops [WakeService], keeps its state, and answers what the
 * phone allows (popping over other apps, full-screen alerts, notifications). App code only (Voice Vault).
 */
object WakeListener {
    private val _state = MutableStateFlow<WakeState>(WakeState.Off("Starts when you open the app."))
    val state: StateFlow<WakeState> = _state.asStateFlow()
    private val _openVoice = MutableStateFlow(0L)
    /** Bumped when a trigger opened the app; MainActivity goes to the Voice screen. */
    val openVoice: StateFlow<Long> = _openVoice.asStateFlow()
    @Volatile private var stoppedByUser = false

    internal fun set(s: WakeState) { _state.value = s }
    internal fun stoppedFromNotification() { stoppedByUser = true; set(WakeState.Off("Stopped from the notification. It starts again next time you open the app.")) }
    fun wokeApp() { _openVoice.value = System.currentTimeMillis() }

    fun hasMic(c: Context): Boolean = c.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    /** Background listening only uses the phone's on-device recognizer: an always-on mic never streams to the cloud. */
    fun onDevice(c: Context): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && SpeechRecognizer.isOnDeviceRecognitionAvailable(c)
    fun notificationsAllowed(c: Context): Boolean = c.getSystemService(NotificationManager::class.java).areNotificationsEnabled()

    fun delivery(c: Context): WakeDelivery = when {
        Settings.canDrawOverlays(c) -> WakeDelivery.POPS_OPEN
        !notificationsAllowed(c) -> WakeDelivery.BLOCKED
        Build.VERSION.SDK_INT < 34 || c.getSystemService(NotificationManager::class.java).canUseFullScreenIntent() -> WakeDelivery.FULL_SCREEN
        else -> WakeDelivery.TAP_ALERT
    }

    /** The master switch on the Voice screen (Voice Vault doesn't touch the microphone at all while it's off). */
    fun micOff(c: Context): Boolean = runCatching { (c.applicationContext as ai.amberx.axf.voicevault.App).appModule.control.micOff.value }.getOrDefault(false)

    /** The microphone was switched off: stop the background listener and say so. */
    fun micTurnedOff(c: Context) { set(WakeState.Off(MIC_OFF)); stop(c) }

    /** Why it can't run right now, or null when it can. */
    fun blocker(c: Context, settingOn: Boolean): String? = when {
        micOff(c) -> MIC_OFF
        !settingOn -> "Off in Settings → Voice Vault → Listen in the background (and Voice notes → Listen for voice notes)."
        !hasMic(c) -> "Needs the microphone permission. Tap the mic once to allow it."
        !onDevice(c) -> "This phone has no on-device speech recognition, so it won't listen in the background (it never sends an always-on mic to the cloud)."
        else -> null
    }

    /** Called when the app comes on screen: starts the service (Android only allows a microphone service to start from the foreground). */
    fun ensureRunning(c: Context, settingOn: Boolean) {
        stoppedByUser = false
        blocker(c, settingOn)?.let { set(WakeState.Off(it)); stop(c); return }
        try { c.startForegroundService(Intent(c, WakeService::class.java)) }
        catch (e: Exception) { set(WakeState.Off("Android didn't allow it to start: ${e.message ?: e.javaClass.simpleName}")) }
    }

    fun stop(c: Context) { c.stopService(Intent(c, WakeService::class.java)) }

    /** Android's "Display over other apps" page for Voice Vault, so a trigger can open the app by itself. */
    fun openPopupSettings(c: Context) {
        c.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${c.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun openNotificationSettings(c: Context) {
        c.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    fun openFullScreenSettings(c: Context) {
        val i = if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${c.packageName}"))
            else Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, c.packageName)
        c.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    const val EXTRA_WAKE = "ai.amberx.axf.voicevault.WAKE"
    /** A voice action heard in the background that runs in the app (its id). */
    const val EXTRA_RUN = "ai.amberx.axf.voicevault.RUN"
    const val MIC_OFF = "The microphone is off. Turn it back on with the Microphone switch on the Voice screen."
}
