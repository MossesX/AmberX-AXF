package ai.amberx.axf.axhubandroid.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import ai.amberx.axf.axhubandroid.AppLockGate
import ai.amberx.axf.lock.AppLock
import ai.amberx.axf.lock.LockMode
import ai.amberx.axf.lock.LockResult
import ai.amberx.axf.lock.PinPrompt
import ai.amberx.axf.lock.findFragmentActivity
import ai.amberx.axf.lock.message
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * The app holds a hub admin session, so Settings → Unlock can ask for the fingerprint or a PIN before
 * anything shows. If the chosen step can't run, the only way past is "Sign out and reset", which drops
 * the hub session first, so nothing is exposed.
 */
@Composable
fun Gated(gate: AppLockGate, content: @Composable () -> Unit) {
    val unlocked by gate.unlocked.collectAsState()
    if (unlocked) { content(); return }
    val ctx = LocalContext.current
    val lock = LocalAxfKernel.current?.services?.get<AppLock>()
    val scope = rememberCoroutineScope()
    var pinFor by remember { mutableStateOf<LockResult?>(null) }
    var asking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var resetSure by remember { mutableStateOf(false) }

    fun tryUnlock() {
        val l = lock ?: run { note = "The lock isn't available, so AXHub stays locked. Use Sign out and reset below."; return }
        scope.launch {
            // The lock mode is a saved setting: never decide before settings have loaded.
            (ctx.applicationContext as? AxfApplication)?.ready?.first { it }
            when (l.mode) {
                LockMode.NONE -> gate.unlock()
                LockMode.BIOMETRIC -> {
                    val a = ctx.findFragmentActivity() ?: run { note = "Can't show the fingerprint sheet here."; return@launch }
                    val r = l.biometric(a, "Unlock AXHub", "Your hub admin session is in this app")
                    if (r == LockResult.Passed) gate.unlock() else note = r.message()
                }
                LockMode.PIN -> if (l.hasPin()) { asking = true; pinFor = null } else note = "No PIN is set for AXHub."
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "AXHub is locked", icon = "lock") {
            AxfText("Unlock to see approvals and your hub.", muted = true)
            if (!asking) AxfButton("Unlock", { note = null; tryUnlock() }, tone = ButtonTone.PRIMARY, icon = "unlock")
            note?.let { AxfText(it, color = Axf.colors.warning) }
        }
        if (asking && lock != null) PinPrompt("Enter your AXHub PIN", pinFor, onSubmit = { pin ->
            scope.launch {
                when (val r = lock.checkPin(pin)) {
                    LockResult.Passed -> { asking = false; gate.unlock() }
                    else -> pinFor = r
                }
            }
        }, onCancel = { asking = false })
        AxfCard(Modifier.fillMaxWidth(), title = "Can't unlock?", icon = "help") {
            AxfText("Sign out of the hub on this phone and turn the lock off. You'll sign in to the hub again.", muted = true)
            if (!resetSure) AxfButton("Sign out and reset", { resetSure = true }, tone = ButtonTone.GHOST, icon = "logout")
            else AxfButton("Yes, sign out and reset", { scope.launch { gate.resetAfterSignOut() } }, tone = ButtonTone.DANGER, icon = "logout")
        }
    }
}
