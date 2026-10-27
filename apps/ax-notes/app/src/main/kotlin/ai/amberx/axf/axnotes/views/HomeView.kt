package ai.amberx.axf.axnotes.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
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
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.axnotes.model.Categories
import ai.amberx.axf.axnotes.model.Category
import ai.amberx.axf.axnotes.model.ListRules
import ai.amberx.axf.axnotes.model.Note
import ai.amberx.axf.axnotes.model.NoteSource
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import java.time.ZoneId

private enum class NotesView(val label: String, val icon: String) { ALL("All", "list"), CATEGORY("Category", "folder"), TAG("Tags", "tag"), DATE("Date", "calendar") }

/**
 * Notes (route `home`): search, then all notes, or grouped by category, tag or day. Tap a note to edit it (and
 * re-categorize it by hand). The mic opens the capture screen.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeView() {
    val store = rememberService<NotesStore>() ?: run { AxfEmptyState("Notes unavailable", icon = "edit"); return }
    val selection = rememberService<Selection>()
    val runtime = LocalAxfRuntime.current
    val notes by store.notes.collectAsState()
    val categories by store.categories.collectAsState()
    val pending by store.pending.collectAsState()
    var query by remember { mutableStateOf("") }
    var view by remember { mutableStateOf(NotesView.ALL) }
    val found = remember(notes, query) { ListRules.search(notes, query) }
    val groups: List<Pair<String, List<Note>>> = remember(found, categories, view) {
        when (view) {
            NotesView.ALL -> listOf("" to found)
            NotesView.CATEGORY -> ListRules.byCategory(found, categories)
            NotesView.TAG -> ListRules.byTag(found)
            NotesView.DATE -> ListRules.byDay(found, ZoneId.systemDefault()).map { (_, n) -> formatDay(n.first().createdAt) to n }
        }
    }
    fun open(id: String?) { selection?.editNote(id); runtime.navigate(Selection.ROUTE_EDITOR) }

    Column(Modifier.fillMaxSize().padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfPageHead("Notes", eyebrow = "AX Notes", description = "${notes.size} notes" + (if (pending > 0) " · $pending waiting to sync" else "")) {
            AxfButton("Speak", { runtime.navigate(Selection.ROUTE_CAPTURE) }, tone = ButtonTone.PRIMARY, icon = "mic")
            AxfButton("New", { open(null) }, icon = "plus")
        }
        AxfTextField(query, { query = it }, Modifier.fillMaxWidth(), placeholder = "Search notes", leadingIcon = "search")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            NotesView.entries.forEach { v -> AxfChip(v.label, icon = v.icon, selected = view == v, onClick = { view = v }) }
        }
        if (found.isEmpty()) AxfEmptyState(if (notes.isEmpty()) "No notes yet" else "No matches", message = if (notes.isEmpty()) "Tap Speak and say “take a note”, or tap New." else null, icon = "edit")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            for ((title, list) in groups) {
                if (title.isNotEmpty()) item(key = "h:$title") { AxfText("$title · ${list.size}", style = Axf.type.labelLarge, muted = true) }
                items(list, key = { "$title:${it.id}" }) { n -> NoteRow(n, categories) { open(n.id) } }
            }
        }
    }
}

@Composable
fun NoteRow(n: Note, categories: List<Category>, onClick: () -> Unit) {
    val bits = buildList {
        if (n.category.isNotBlank()) add(Categories.nameOf(n.category, categories))
        if (n.tags.isNotEmpty()) add(n.tags.joinToString(" ") { "#$it" })
        add(formatWhen(n.updatedAt))
    }
    AxfListItem(n.title, subtitle = bits.joinToString(" · "), icon = when (n.source) { NoteSource.VOICE -> "mic"; NoteSource.AI -> "sparkles"; NoteSource.TYPED -> "edit" }, onClick = onClick)
}
