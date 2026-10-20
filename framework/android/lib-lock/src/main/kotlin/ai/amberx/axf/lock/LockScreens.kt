package ai.amberx.axf.lock

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import ai.amberx.axf.ui.LocalAxfKernel
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
    val kernel = LocalAxfKernel.current
    val lock = remember(kernel) { kernel?.services?.get<AppLock>() }
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
