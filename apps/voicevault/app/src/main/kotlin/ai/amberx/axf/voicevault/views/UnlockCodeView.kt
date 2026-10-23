package ai.amberx.axf.voicevault.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSegmented
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.Heard
import ai.amberx.axf.voice.SpokenText
import ai.amberx.axf.voicevault.vault.VaultSession
import kotlinx.coroutines.launch

/** Settings → Voice Vault → Unlock code (vault must be unlocked). */
@Composable
fun UnlockCodeView() {
    val session = rememberService<VaultSession>() ?: run { AxfEmptyState("Vault unavailable", icon = "lock"); return }
    Column(Modifier.imePadding().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("Unlock code", eyebrow = "Voice Vault", description = "The phrase you say to open the vault. Only a salted hash is kept, in the phone's secure storage.")
        UnlockCodeEditor(session, rememberService<AxfVoice>(), setup = false)
    }
}

/**
 * Record (say it twice) or type (twice) an unlock code. Used on first run and from settings.
 * Anyone who hears the phrase can say it, so the card points to the second step in Settings → Unlock.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UnlockCodeEditor(session: VaultSession, voice: AxfVoice?, setup: Boolean) {
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(if (voice != null) "say" else "type") }
    var first by remember { mutableStateOf<String?>(null) }
    var options by remember { mutableStateOf<List<String>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var typed by remember { mutableStateOf("") }
    var typedAgain by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    fun save(code: String) {
        if (saving) return
        saving = true; note = null
        scope.launch {
            val err = session.setUnlockCode(code)
            note = (err ?: "Unlock code saved.") to (err == null)
            if (err == null) { first = null; options = emptyList(); typed = ""; typedAgain = "" }
            saving = false
        }
    }

    /** The always-visible button: saves what's ready, or says what's still missing. */
    fun submit() {
        if (mode == "say" && voice != null) {
            val chosen = first
            when {
                chosen != null -> save(chosen)
                options.isNotEmpty() -> note = "Tap the phrase you said, then save." to false
                else -> note = "Tap Record and say your code first, or switch to Type it." to false
            }
        } else when {
            typed.isBlank() || typedAgain.isBlank() -> note = "Type your code in both fields." to false
            SpokenText.code(typed) != SpokenText.code(typedAgain) -> note = "The two codes don't match." to false
            else -> save(typed)
        }
    }

    fun listen(confirming: Boolean) {
        val v = voice ?: return
        busy = true; note = null
        scope.launch {
            when (val h = v.ask(null, secret = true)) {
                is Heard.Text -> {
                    val alts = h.alternatives.map(SpokenText::code).filter { it.isNotEmpty() }.distinct()
                    if (!confirming) options = alts.take(4)
                    else if (alts.any { it == first }) save(first!!)
                    else note = "That didn't match. Say it exactly the same way, or start over." to false
                }
                Heard.Silence -> note = "Didn't catch that. Try again." to false
                is Heard.Failed -> note = h.message to false
            }
            busy = false
        }
    }

    AxfCard(Modifier.fillMaxWidth(), title = if (setup) "Choose your unlock code" else "Change unlock code", icon = "shield") {
        AxfText("Use two or more words you'll remember. Anyone who hears it can say it, so add a fingerprint or PIN in Settings → Unlock.", muted = true)
        if (voice != null) AxfSegmented(listOf("say" to "Say it", "type" to "Type it"), mode, { mode = it; note = null; first = null; options = emptyList() })
        if (mode == "say" && voice != null) {
            when {
                first == null && options.isEmpty() -> AxfButton(if (busy) "Listening…" else "Record", { listen(false) }, tone = ButtonTone.PRIMARY, icon = "mic", enabled = !busy)
                first == null -> {
                    AxfText("Tap what you said:", muted = true)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                        options.forEach { o -> AxfChip(o, icon = "check", onClick = { first = o }) }
                    }
                    AxfButton("Record again", { options = emptyList(); listen(false) }, tone = ButtonTone.GHOST, icon = "refresh", enabled = !busy)
                }
                else -> {
                    AxfText("Say “$first” again to confirm, or tap ${if (setup) "Save and continue" else "Save code"}.", muted = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                        AxfButton(if (busy) "Listening…" else "Say it again", { listen(true) }, tone = ButtonTone.PRIMARY, icon = "mic", enabled = !busy)
                        AxfButton("Start over", { first = null; options = emptyList() }, tone = ButtonTone.GHOST, icon = "x")
                    }
                }
            }
        } else {
            AxfTextField(typed, { typed = it }, Modifier.fillMaxWidth(), label = "Unlock code", secret = true)
            AxfTextField(typedAgain, { typedAgain = it }, Modifier.fillMaxWidth(), label = "Same code again", secret = true)
        }
        // Errors sit right above the button so they're on screen when it's tapped.
        note?.let { (t, ok) -> AxfText(t, color = if (ok) Axf.colors.success else Axf.colors.danger) }
        AxfButton(
            when { saving -> "Saving…"; setup -> "Save and continue"; else -> "Save code" },
            { submit() }, Modifier.fillMaxWidth(), tone = ButtonTone.PRIMARY,
            icon = if (setup) "chevron-right" else "save", enabled = !busy && !saving,
        )
    }
}
