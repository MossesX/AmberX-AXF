package ai.amberx.axf.voicevault.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.voicevault.vault.VaultSession
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.PhraseMatcher
import java.text.DateFormat
import java.util.Date

/** Saved sites (vault unlocked): search, copy (the tap is the confirmation), edit, delete. Passwords never show here. */
@Composable
fun VaultListView() {
    val session = rememberService<VaultSession>() ?: run { AxfEmptyState("Vault unavailable", icon = "lock"); return }
    val runtime = LocalAxfRuntime.current
    val entries by session.entries.collectAsState()
    val note by session.note.collectAsState()
    var query by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<String?>(null) }
    val shown = remember(entries, query) {
        if (query.isBlank()) entries else PhraseMatcher.ranked(listOf(query), entries, 0.5) { it.site }.map { it.item }
    }
    val dates = remember { DateFormat.getDateInstance(DateFormat.MEDIUM) }
    Column(Modifier.fillMaxSize().padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfPageHead("Saved sites", eyebrow = "Voice Vault", description = "${entries.size} saved. Tap the copy icon to copy a password.") {
            AxfButton("Add", { session.editNew(); runtime.navigate("home") }, tone = ButtonTone.PRIMARY, icon = "plus")
        }
        AxfTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = "Search sites", leadingIcon = "search")
        NoteLine(note)
        if (shown.isEmpty()) AxfEmptyState(if (entries.isEmpty()) "Nothing saved yet" else "No matches", message = if (entries.isEmpty()) "Say “store password” on the Voice screen." else null, icon = "lock")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            items(shown, key = { it.id }) { e ->
                val confirmDelete = deleting == e.id
                AxfListItem(e.site, subtitle = if (confirmDelete) "Tap the bin again to delete" else "Updated ${dates.format(Date(e.updatedAt))}", icon = "lock", trailing = {
                    AxfIconButton("copy", "Copy password for ${e.site}", { deleting = null; session.copy(e) })
                    AxfIconButton("edit", "Edit ${e.site}", { deleting = null; session.editEntry(e); runtime.navigate("home") })
                    AxfIconButton("trash", "Delete ${e.site}", { if (confirmDelete) { session.delete(e.id); deleting = null } else deleting = e.id }, tint = if (confirmDelete) Axf.colors.danger else Axf.colors.muted)
                })
            }
        }
    }
}
