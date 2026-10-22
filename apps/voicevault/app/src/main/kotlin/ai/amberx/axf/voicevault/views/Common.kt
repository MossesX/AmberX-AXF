package ai.amberx.axf.voicevault.views

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voicevault.vault.Note
import ai.amberx.axf.voicevault.vault.Tone

@Composable
fun NoteLine(note: Note?, modifier: Modifier = Modifier) {
    note ?: return
    val c = Axf.colors
    val color: Color = when (note.tone) { Tone.OK -> c.success; Tone.WARN -> c.warning; Tone.ERROR -> c.danger; Tone.INFO -> c.muted }
    AxfText(note.text, modifier, color = color)
}
