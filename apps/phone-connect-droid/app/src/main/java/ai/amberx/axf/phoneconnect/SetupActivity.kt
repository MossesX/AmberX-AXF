package ai.amberx.axf.phoneconnect

import ai.amberx.axf.hub.HubOrigin
import ai.amberx.axf.hub.HubSignInView
import ai.amberx.axf.phoneconnect.auth.PairingScreen
import ai.amberx.axf.phoneconnect.auth.Session
import ai.amberx.axf.phoneconnect.overlay.OverlayService
import ai.amberx.axf.phoneconnect.overlay.OverlayTheme
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.M3Button
import ai.amberx.axf.ui.components.M3ListItem
import ai.amberx.axf.ui.theme.Axf
import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat

/**
 * The only page Phone Connect has, used once: sign in to the hub, pair with the console's code (typed, or the QR
 * scanned with the camera app opens axf-phone://pair?code=…), then grant notifications and "display over other apps".
 * Done starts the overlay and closes the page. Opening the app again shows where things stand and lets you sign out.
 */
class SetupActivity : ComponentActivity() {
    private var tick by mutableIntStateOf(0)
    private val askNotify = registerForActivityResult(ActivityResultContracts.RequestPermission()) { tick++ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val code = intent?.data?.takeIf { it.scheme == "axf-phone" && it.host == "pair" }?.getQueryParameter("code").orEmpty()
        setContent { OverlayTheme(this) { Page(code) } }
    }

    override fun onResume() { super.onResume(); tick++ }

    private fun overlayAllowed() = Settings.canDrawOverlays(this)
    private fun notifyAllowed() = NotificationManagerCompat.from(this).areNotificationsEnabled()

    @Composable
    private fun Page(scannedCode: String) {
        @Suppress("UNUSED_EXPRESSION") tick
        val session = remember { Session.of(this) }
        var signingIn by remember { mutableStateOf(false) }
        if (signingIn) { HubSignInView(HubOrigin.DEFAULT) { signingIn = false; session.signedIn(); tick++ }; return }
        Column(
            Modifier.fillMaxSize().background(Axf.colors.bg).verticalScroll(rememberScrollState()).padding(Axf.space.two),
            verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf),
        ) {
            AxfPageHead("Phone Connect", eyebrow = "Set up once", description = "Sign in, pair with the console, allow two things. After that everything is the floating toolbar.")
            Step(1, "Sign in to axHub", if (session.isSignedIn()) "Signed in" else "Your own hub account. Pairing and approvals use this session only.", session.isSignedIn()) {
                if (session.isSignedIn()) M3Button("Sign out", onClick = { session.signOut(this@SetupActivity); tick++ }, tone = ButtonTone.GHOST)
                else M3Button("Sign in", onClick = { signingIn = true }, tone = ButtonTone.PRIMARY, icon = "user")
            }
            Step(2, "Pair with the console", if (session.isPaired()) "Paired as ${session.deviceName()}" else "Settings → Plugins → Phone Connect → Pair a phone shows a code and a QR.", session.isPaired()) {
                if (session.isSignedIn() && !session.isPaired()) PairingScreen(scannedCode) { tick++ }
            }
            Step(3, "Notifications", if (notifyAllowed()) "Allowed" else "Approvals, alerts and fix updates.", notifyAllowed()) {
                if (!notifyAllowed() && Build.VERSION.SDK_INT >= 33) M3Button("Allow", onClick = { askNotify.launch(Manifest.permission.POST_NOTIFICATIONS) })
            }
            Step(4, "Display over other apps", if (overlayAllowed()) "Allowed" else "The floating toolbar and the popups need it.", overlayAllowed()) {
                if (!overlayAllowed()) M3Button("Open setting", onClick = { startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName"))) })
            }
            val ready = session.isSignedIn() && session.isPaired() && overlayAllowed()
            M3Button(if (ready) "Done" else "Finish the steps above", onClick = {
                OverlayService.start(this@SetupActivity)
                ContextCompat.startForegroundService(this@SetupActivity, Intent(this@SetupActivity, ai.amberx.axf.phoneconnect.monitor.WatchService::class.java))
                finish()
            }, enabled = ready, tone = ButtonTone.PRIMARY, icon = "check")
        }
    }

    @Composable
    private fun Step(n: Int, title: String, text: String, done: Boolean, action: @Composable () -> Unit) {
        Column(verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            M3ListItem(title = "$n. $title", subtitle = text, icon = if (done) "check-circle" else "chevron-right")
            action()
        }
    }

}
