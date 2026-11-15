package ai.amberx.axf.phoneconnect.auth

import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.M3Button
import ai.amberx.axf.ui.components.M3TextField
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Type the console's code (or arrive with it from the scanned QR) and claim it with your own hub session. */
@Composable
fun PairingScreen(scanned: String, onPaired: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var code by remember { mutableStateOf(scanned) }
    var note by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        M3TextField(value = code, onValueChange = { code = it.uppercase().take(8) }, label = "Pairing code")
        M3Button(if (busy) "Pairing…" else "Pair", enabled = !busy && code.length == 8, tone = ButtonTone.PRIMARY, onClick = {
            busy = true
            scope.launch {
                val err = withContext(Dispatchers.IO) { Session.of(ctx).claim(code) }
                busy = false; note = err
                if (err.isEmpty()) onPaired()
            }
        })
        if (note.isNotEmpty()) AxfText(note, style = Axf.type.bodySmall, color = Axf.colors.danger)
    }
}
