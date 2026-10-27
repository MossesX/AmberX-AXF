package ai.amberx.axf.axnotes.plugins.aichat

import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfContainer
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfMarkdown
import ai.amberx.axf.ui.components.AxfNote
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.NoteTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/**
 * The chat UI. [compact] = the overlay's mini screen (short transcript, no header); otherwise the in-app `ai-chat`
 * screen. Framework components and theme tokens only, so it takes the app's look.
 */
@Composable
internal fun AiChatScreen(compact: Boolean) {
    val chat = rememberService<ChatController>()
    if (chat == null) { AxfEmptyState("AI chat is off", message = "Turn the AI chat plugin on in Settings → Plugins.", icon = "message"); return }
    val state by chat.state.collectAsState()
    var draft by remember { mutableStateOf("") }
    val list = rememberLazyListState()
    val shown = if (compact) state.messages.takeLast(6) else state.messages
    LaunchedEffect(shown.size, shown.lastOrNull()?.text?.length) { if (shown.isNotEmpty()) list.animateScrollToItem(shown.size - 1) }

    Column(Modifier.fillMaxSize().padding(Axf.space.x(if (compact) 1 else 2)), verticalArrangement = Arrangement.spacedBy(Axf.space.x(1))) {
        if (!compact) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Axf.space.x(1)), verticalAlignment = Alignment.CenterVertically) {
            AxfChip("Read aloud", icon = "volume", selected = state.readAloud, onClick = { chat.setReadAloud(!state.readAloud) })
            AxfChip("Voice", icon = "mic", selected = state.input == InputMode.VOICE, onClick = { chat.setInput(if (state.input == InputMode.VOICE) InputMode.TEXT else InputMode.VOICE) })
            AxfButton("New chat", { chat.clear() }, tone = ButtonTone.GHOST, icon = "refresh")
        }
        if (state.status.isNotEmpty()) AxfText(state.status, muted = true)
        if (shown.isEmpty()) AxfText(if (state.input == InputMode.VOICE) "Say \"ask Claude …\", or just talk while chat mode is on." else "Ask Claude anything.", muted = true)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, verticalArrangement = Arrangement.spacedBy(Axf.space.x(1))) {
            items(shown, key = { it.id }) { m -> Bubble(m, chat, compact) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Axf.space.x(1)), verticalAlignment = Alignment.CenterVertically) {
            AxfTextField(draft, { draft = it }, Modifier.weight(1f), placeholder = "Message Claude", singleLine = compact, minLines = 1)
            if (state.busy) AxfIconButton("stop", "Stop", { chat.stop() })
            else AxfIconButton("send", "Send", { chat.send(draft); draft = "" }, enabled = draft.isNotBlank())
        }
    }
}

@Composable
private fun Bubble(m: ChatMessage, chat: ChatController, compact: Boolean) {
    when (m.role) {
        Role.USER -> AxfText(m.text, Modifier.fillMaxWidth(), color = Axf.colors.accent)
        Role.SYSTEM -> AxfNote(m.error ?: m.text, tone = NoteTone.WARNING)
        Role.ASSISTANT -> {
            val tools: @Composable RowScope.() -> Unit = {
                AxfIconButton("volume", "Read aloud", { chat.speak(m.text) })
                if (chat.canSaveNotes()) AxfIconButton(if (m.savedAt != null) "check" else "save", if (m.savedAt != null) "Saved as a note" else "Save as note", { chat.save(m.id) }, enabled = m.savedAt == null)
            }
            Reply(m, compact, if (m.streaming || compact) null else tools)
        }
    }
}

@Composable
private fun Reply(m: ChatMessage, compact: Boolean, tools: (@Composable RowScope.() -> Unit)?) {
    AxfContainer(Modifier.fillMaxWidth(), title = if (compact) null else "Claude", icon = if (compact) null else "sparkles", actions = tools) {
        if (m.text.isNotEmpty()) AxfMarkdown(m.text, compact = compact) else if (m.streaming) AxfText("…", muted = true)
        m.error?.let { AxfNote(it, tone = NoteTone.DANGER) }
    }
}
