package ai.amberx.axf.phoneconnect.views

import ai.amberx.axf.hub.HubSignInView
import ai.amberx.axf.hub.cookieCredentials
import ai.amberx.axf.hub.HubCredential
import ai.amberx.axf.phoneconnect.link.LinkRules
import ai.amberx.axf.phoneconnect.link.LinkState
import ai.amberx.axf.phoneconnect.link.PhoneLink
import ai.amberx.axf.phoneconnect.link.PhoneStore
import ai.amberx.axf.phoneconnect.watch.WatchService
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Pairing (phone-connect@1 claim, personOnly): sign in to axHub here once, type the code from Settings → Plugins →
 * Phone Connect, Pair. The device token goes into the encrypted store and is never shown. Axf.* tokens only.
 */
@Composable
fun PairView() {
    val ctx = LocalContext.current
    val store = remember { PhoneStore(ctx) }
    val scope = rememberCoroutineScope()
    val status by LinkState.status.collectAsState()
    var paired by remember { mutableStateOf(store.paired) }
    var origin by remember { mutableStateOf(store.origin) }
    var code by remember { mutableStateOf("") }
    var signIn by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf("") }
    var watch by remember { mutableStateOf(store.watch) }
    var listen by remember { mutableStateOf(store.listen) }
    // notifications (Android 13+) and RECORD_AUDIO (Android files playback capture under it): asked once paired
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { }
    val wanted = remember { listOfNotNull(Manifest.permission.RECORD_AUDIO, if (Build.VERSION.SDK_INT >= 33) Manifest.permission.POST_NOTIFICATIONS else null).toTypedArray() }
    // the app is in front: (re)start the watch if it should run (a background start could be refused by Android)
    LaunchedEffect(paired) {
        if (store.paired) ask.launch(wanted)
        if (store.paired && store.watch) WatchService.start(ctx)
    }

    if (signIn) {
        Column(Modifier.padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfText("Sign in to axHub. Pairing uses your own sign-in once; the phone then keeps its own token.", muted = true)
            AxfButton("Done", { signIn = false }, icon = "check")
            HubSignInView(store.hub, Modifier.fillMaxWidth().height(Axf.space.two * 30)) { signIn = false }
        }
        return
    }

    Column(Modifier.padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(title = "Phone Connect", icon = "smartphone") {
            AxfText(if (paired) "Paired as ${store.deviceId}" else "Not paired", style = Axf.type.titleMedium)
            AxfText(status, muted = true)
        }
        if (!paired) {
            AxfCard(title = "Pair this phone", icon = "link") {
                AxfText("In the console: Settings → Plugins → Phone Connect → New code. Type it here.", muted = true)
                AxfTextField(origin, { origin = it }, label = "Console address", placeholder = LinkRules.DEFAULT_ORIGIN)
                AxfTextField(code, { code = it.uppercase() }, label = "Pairing code", placeholder = "8 letters and digits", monospace = true)
                AxfButton("Sign in to axHub", { signIn = true }, icon = "user", tone = ButtonTone.NEUTRAL)
                AxfButton(if (busy) "Pairing…" else "Pair", {
                    val o = LinkRules.normalizeOrigin(origin)
                    val c = LinkRules.normalizeCode(code)
                    val cookie = (cookieCredentials { store.hub }.current() as? HubCredential.SessionCookie)?.cookie
                    msg = when {
                        o == null -> "The console address is https://… with nothing after the host."
                        c == null -> "A pairing code is 8 letters and digits (no 0, O, 1 or I)."
                        cookie.isNullOrBlank() -> "Sign in to axHub first: only your own sign-in can pair a phone."
                        else -> ""
                    }
                    if (msg.isEmpty() && o != null && c != null && cookie != null) {
                        busy = true
                        store.origin = o
                        scope.launch {
                            val r = withContext(Dispatchers.IO) { PhoneLink(store).claim(c, cookie) }
                            busy = false
                            when (r) {
                                is PhoneLink.Reply.Ok -> { paired = true; code = ""; LinkState.set("Paired"); if (store.watch) WatchService.start(ctx) }
                                is PhoneLink.Reply.Fail -> msg = r.message
                                PhoneLink.Reply.NoContent -> msg = "The console gave no answer."
                            }
                        }
                    }
                }, icon = "link", tone = ButtonTone.PRIMARY, enabled = !busy)
                if (msg.isNotEmpty()) AxfText(msg, color = Axf.colors.warning)
            }
        } else {
            AxfCard(title = "Link", icon = "activity") {
                AxfSwitch(watch, { on -> watch = on; store.watch = on; if (on) WatchService.start(ctx) else WatchService.stop(ctx) },
                    label = "Watch", description = "Keep the link to the console open so pages, notifications and approvals arrive at once.")
                AxfSwitch(listen, { on -> listen = on; store.listen = on },
                    label = "Let the console listen once", description = "The console assistant may ask the phone to hear one phrase. Off: the mic is never opened for it.")
                AxfButton("Unpair this phone", {
                    WatchService.stop(ctx); store.unpair(); paired = false; LinkState.set("Not paired")
                }, icon = "x", tone = ButtonTone.DANGER)
                AxfText("Revoking from the console also ends the link: Settings → Plugins → Phone Connect.", muted = true)
            }
        }
    }
}
