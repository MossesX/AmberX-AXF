package ai.amberx.axf.lock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.launch

/** Human text for a failed step. */
public fun LockResult.message(): String? = when (this) {
    LockResult.Passed -> null
    LockResult.Cancelled -> "Cancelled."
    is LockResult.Wrong -> if (triesLeft != null) "Wrong PIN. $triesLeft ${if (triesLeft == 1) "try" else "tries"} left." else "Wrong PIN."
    is LockResult.LockedOut -> "Too many tries. Wait ${remainingMs / 1000 + 1} s."
    is LockResult.Unavailable -> reason
}

/**
 * A PIN card: the app shows it when [AppLock.authenticate]'s `pinEntry` asks. [onSubmit] gets the
 * digits, [onCancel] gives up. [previous] is the last result, shown above the field.
 */
@Composable
public fun PinPrompt(title: String, previous: LockResult?, onSubmit: (String) -> Unit, onCancel: () -> Unit, modifier: Modifier = Modifier) {
    var pin by remember(previous) { mutableStateOf("") }
    AxfCard(modifier.fillMaxWidth(), title = title, icon = "lock") {
        previous?.message()?.let { AxfText(it, color = Axf.colors.danger) }
        AxfTextField(pin, { v -> pin = v.filter(Char::isDigit).take(12) }, Modifier.fillMaxWidth(), label = "PIN", secret = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done))
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Unlock", { onSubmit(pin) }, tone = ButtonTone.PRIMARY, icon = "unlock", enabled = pin.length >= 4)
            AxfButton("Cancel", onCancel, tone = ButtonTone.GHOST, icon = "x")
        }
    }
}

/** Route `lock-pin`: set a PIN, or change it (current PIN first). Shows nothing secret. */
@Composable
public fun PinSetupScreen(modifier: Modifier = Modifier) {
    val lock = rememberService<AppLock>()
    if (lock == null) { AxfEmptyState("App lock unavailable", message = "LockModule is not installed.", icon = "lock"); return }
    val scope = rememberCoroutineScope()
    var has by remember { mutableStateOf<Boolean?>(null) }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var again by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    LaunchedEffect(lock) { has = lock.hasPin() }
    val digits: (String) -> String = { it.filter(Char::isDigit).take(12) }
    val kb = KeyboardOptions(keyboardType = KeyboardType.NumberPassword)
    Column(modifier.padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead(if (has == true) "Change PIN" else "Set a PIN", eyebrow = "App lock", description = "4 to 12 digits. Only a salted hash is kept, in the phone's secure storage.")
        AxfCard {
            if (has == true) AxfTextField(current, { current = digits(it) }, Modifier.fillMaxWidth(), label = "Current PIN", secret = true, keyboardOptions = kb)
            AxfTextField(next, { next = digits(it) }, Modifier.fillMaxWidth(), label = "New PIN", secret = true, keyboardOptions = kb)
            AxfTextField(again, { again = digits(it) }, Modifier.fillMaxWidth(), label = "New PIN again", secret = true, keyboardOptions = kb)
            note?.let { (t, ok) -> AxfText(t, color = if (ok) Axf.colors.success else Axf.colors.danger) }
            AxfButton("Save PIN", {
                if (next != again) { note = "The new PINs don't match." to false; return@AxfButton }
                scope.launch {
                    val err = lock.setPin(next, current.takeIf { has == true })
                    note = (err ?: "PIN saved.") to (err == null)
                    if (err == null) { has = true; current = ""; next = ""; again = "" }
                }
            }, tone = ButtonTone.PRIMARY, icon = "save", enabled = next.length >= 4 && again.isNotEmpty() && has != null)
        }
    }
}

/** Every line [Gated] shows, so each app says it its own way (AXHub: "AXHub is locked", Voice Vault: "Vault is locked"). */
public data class GateWording(
    val title: String = "Locked",
    val message: String = "Unlock to see this.",
    val biometricTitle: String = "Unlock",
    val biometricSubtitle: String? = null,
    val pinTitle: String = "Enter your PIN",
    val noPin: String = "No PIN is set.",
    val noLock: String = "The lock isn't available, so the app stays locked.",
    val noActivity: String = "Can't show the fingerprint sheet here.",
    val resetTitle: String = "Can't unlock?",
    val resetMessage: String = "Reset turns the lock off.",
    val resetButton: String = "Reset",
    val resetConfirm: String = "Yes, reset",
)

/** For apps whose unlock happens on one screen (Voice Vault's spoken code): the locked card only links there. */
public data class UnlockElsewhere(val route: String, val label: String, val icon: String = "unlock")

/**
 * Shows [content] only while [gate] is open; otherwise a locked card. With [elsewhere] the card links to the app's
 * unlock screen; otherwise its Unlock button runs Settings → App lock's step right here (waits for settings first,
 * since the mode is a saved setting): nothing more → open, fingerprint/face → BiometricPrompt, PIN → [PinPrompt]
 * (lockout from [AppLock]). Fails closed: no lock service, no activity for the sheet, or no PIN set keeps it locked
 * with a note. [onReset] adds the "Can't unlock?" card (two taps); it must remove whatever the lock protected
 * before turning the lock off (AXHub ends the hub session first). Put it around every view at once with
 * `AppShell(viewGuard = …)`.
 */
@Composable
public fun Gated(
    gate: LockGate,
    wording: GateWording = GateWording(),
    elsewhere: UnlockElsewhere? = null,
    onReset: (suspend () -> Unit)? = null,
    content: @Composable () -> Unit,
) {
    val unlocked by gate.unlocked.collectAsState()
    if (unlocked) { content(); return }
    if (elsewhere != null) {
        val runtime = LocalAxfRuntime.current
        Column(Modifier.padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
            AxfCard(title = wording.title, icon = "lock") {
                AxfText(wording.message, muted = true)
                AxfButton(elsewhere.label, { runtime.navigate(elsewhere.route) }, tone = ButtonTone.PRIMARY, icon = elsewhere.icon)
            }
        }
        return
    }
    val ctx = LocalContext.current
    val lock = rememberService<AppLock>()
    val scope = rememberCoroutineScope()
    var pinFor by remember { mutableStateOf<LockResult?>(null) }
    var asking by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var resetSure by remember { mutableStateOf(false) }

    fun tryUnlock() {
        val l = lock ?: run { note = wording.noLock; return }
        scope.launch {
            // The lock mode is a saved setting: never decide before settings have loaded.
            gate.awaitReady()
            when (l.mode) {
                LockMode.NONE -> gate.unlock()
                LockMode.BIOMETRIC -> {
                    val a = ctx.findFragmentActivity() ?: run { note = wording.noActivity; return@launch }
                    val r = l.biometric(a, wording.biometricTitle, wording.biometricSubtitle)
                    if (r == LockResult.Passed) gate.unlock() else note = r.message()
                }
                LockMode.PIN -> if (l.hasPin()) { asking = true; pinFor = null } else note = wording.noPin
            }
        }
    }

    Column(Modifier.fillMaxSize().padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = wording.title, icon = "lock") {
            AxfText(wording.message, muted = true)
            if (!asking) AxfButton("Unlock", { note = null; tryUnlock() }, tone = ButtonTone.PRIMARY, icon = "unlock")
            note?.let { AxfText(it, color = Axf.colors.warning) }
        }
        if (asking && lock != null) PinPrompt(wording.pinTitle, pinFor, onSubmit = { pin ->
            scope.launch {
                when (val r = lock.checkPin(pin)) {
                    LockResult.Passed -> { asking = false; gate.unlock() }
                    else -> pinFor = r
                }
            }
        }, onCancel = { asking = false })
        if (onReset != null) AxfCard(Modifier.fillMaxWidth(), title = wording.resetTitle, icon = "help") {
            AxfText(wording.resetMessage, muted = true)
            if (!resetSure) AxfButton(wording.resetButton, { resetSure = true }, tone = ButtonTone.GHOST, icon = "logout")
            else AxfButton(wording.resetConfirm, { scope.launch { onReset() } }, tone = ButtonTone.DANGER, icon = "logout")
        }
    }
}
