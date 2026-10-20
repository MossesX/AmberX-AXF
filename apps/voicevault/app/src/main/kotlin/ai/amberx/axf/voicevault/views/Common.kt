package ai.amberx.axf.voicevault.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voicevault.vault.Note
import ai.amberx.axf.voicevault.vault.Stage
import ai.amberx.axf.voicevault.vault.Tone
import ai.amberx.axf.voicevault.vault.VaultSession

@Composable
fun rememberSession(): VaultSession? {
    val kernel = LocalAxfKernel.current
    return remember(kernel) { kernel?.services?.get<VaultSession>() }
}

@Composable
fun rememberVoice(): AxfVoice? {
    val kernel = LocalAxfKernel.current
    return remember(kernel) { kernel?.services?.get<AxfVoice>() }
}

/** True for stages where the vault is open. */
fun Stage.isUnlocked(): Boolean = this !is Stage.Setup && this !is Stage.Locked && this !is Stage.Verifying && this !is Stage.PinEntry && this !is Stage.Broken

/** Shows [content] only while the vault is unlocked; otherwise a short "locked" card. */
@Composable
fun UnlockedOnly(content: @Composable () -> Unit) {
    val session = rememberSession() ?: run { AxfEmptyState("Vault unavailable", icon = "lock"); return }
    val stage by session.stage.collectAsState()
    if (stage.isUnlocked()) { content(); return }
    val runtime = LocalAxfRuntime.current
    Column(Modifier.padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(title = "Vault is locked", icon = "lock") {
            AxfText("Unlock with your voice code on the Voice screen to see this.", muted = true)
            AxfButton("Go to Voice", { runtime.navigate("home") }, tone = ButtonTone.PRIMARY, icon = "mic")
        }
    }
}

@Composable
fun NoteLine(note: Note?, modifier: Modifier = Modifier) {
    note ?: return
    val c = Axf.colors
    val color: Color = when (note.tone) { Tone.OK -> c.success; Tone.WARN -> c.warning; Tone.ERROR -> c.danger; Tone.INFO -> c.muted }
    AxfText(note.text, modifier, color = color)
}
