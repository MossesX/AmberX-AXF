package ai.amberx.axf.voicevault

import android.Manifest
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import ai.amberx.axf.voicevault.background.WakeListener
import ai.amberx.axf.voicevault.background.WakeService
import androidx.compose.runtime.Composable
import ai.amberx.axf.lock.GateWording
import ai.amberx.axf.lock.Gated
import ai.amberx.axf.lock.UnlockElsewhere
import ai.amberx.axf.platform.AxfActivity
import ai.amberx.axf.ui.shell.AppShell
import ai.amberx.axf.voice.VoiceTriggersScreen
import ai.amberx.axf.voicevault.views.HomeView
import ai.amberx.axf.voicevault.views.UnlockCodeView
import ai.amberx.axf.voicevault.views.VaultListView

/**
 * The single activity. Screens are kept out of screenshots and the recents preview (`android.secureWindow` in
 * axf.manifest.json, applied by AxfActivity), the vault session hears about foreground/background for auto-lock,
 * and every screen but Voice (the app's and the libraries': settings, PIN, voice triggers) needs the vault unlocked.
 */
class MainActivity : AxfActivity() {
    private val session get() = (application as App).appModule.session
    private val locked = GateWording(title = "Vault is locked", message = "Unlock with your voice code on the Voice screen to see this.")
    private val toVoice = UnlockElsewhere("home", "Go to Voice", "mic")

    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session.attach(this)
        handleWake(intent)
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleWake(intent) }

    override fun onStart() { super.onStart(); session.onForeground() }

    /** Starts the background listener while on screen (Android only lets a microphone service start from the foreground). */
    override fun onResume() {
        super.onResume()
        if (session.backgroundOn && Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            val prefs = getSharedPreferences("voicevault.ui", MODE_PRIVATE)
            if (!prefs.getBoolean("askedNotifications", false)) { prefs.edit().putBoolean("askedNotifications", true).apply(); askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS) }
        }
        WakeListener.ensureRunning(this, session.backgroundOn)
    }

    /** Opened by the global trigger: wake the screen, ask Android to unlock the phone (never shown over the lock screen), go to Voice. */
    private fun handleWake(i: Intent?) {
        if (i?.getBooleanExtra(WakeListener.EXTRA_WAKE, false) != true) return
        i.removeExtra(WakeListener.EXTRA_WAKE)
        getSystemService(NotificationManager::class.java).cancel(WakeService.NOTE_WAKE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) setTurnScreenOn(true)
        getSystemService(KeyguardManager::class.java)?.requestDismissKeyguard(this, null)
        kernel.runtime.navigate("home")
        WakeListener.wokeApp()
    }
    override fun onStop() { session.onBackground(); super.onStop() }
    override fun onDestroy() { session.detach(this); super.onDestroy() }

    @Composable
    override fun Content() {
        // settings (lib-settings) and lock-pin (lib-lock) come from the libraries; viewGuard locks them like the rest.
        AppShell(
            views = mapOf(
                "home" to { HomeView() },
                "vault" to { VaultListView() },
                "voice-triggers" to { VoiceTriggersScreen() },
                "unlock-code" to { UnlockCodeView() },
            ),
            viewGuard = { id, content -> if (id == "home") content() else Gated(session.gate, locked, elsewhere = toVoice) { content() } },
        )
    }
}
