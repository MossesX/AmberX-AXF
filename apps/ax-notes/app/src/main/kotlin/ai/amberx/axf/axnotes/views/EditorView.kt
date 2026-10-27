package ai.amberx.axf.axnotes.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSelectField
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.SelectOption
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf

private const val NEW_CATEGORY = "\u0000new"

/**
 * Note editor (route `editor`): create or edit by hand — title, text, category (pick one or type a new one; this is
 * also how a note is re-categorized), tags, priority, which note lists it's in, its code links. Delete asks twice.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EditorView() {
    val store = rememberService<NotesStore>() ?: run { AxfEmptyState("Notes unavailable", icon = "edit"); return }
    val selection = rememberService<Selection>() ?: run { AxfEmptyState("Notes unavailable", icon = "edit"); return }
    val runtime = LocalAxfRuntime.current
    val id by selection.note.collectAsState()
    val notes by store.notes.collectAsState()
    val categories by store.categories.collectAsState()
    val lists by store.lists.collectAsState()
    val note = remember(id, notes) { id?.let { i -> notes.firstOrNull { it.id == i } } }

    // Form state, reset whenever another note is opened.
    var title by remember(id) { mutableStateOf(note?.title.orEmpty()) }
    var text by remember(id) { mutableStateOf(note?.text.orEmpty()) }
    var category by remember(id) { mutableStateOf(note?.category.orEmpty()) }
    var newCategory by remember(id) { mutableStateOf("") }
    var tags by remember(id) { mutableStateOf(note?.tags?.joinToString(", ").orEmpty()) }
    var priority by remember(id) { mutableStateOf(note?.priority ?: Priority.NONE) }
    var inLists by remember(id) { mutableStateOf(note?.listIds?.toSet() ?: setOf(NotesStore.INBOX)) }
    var confirmDelete by remember(id) { mutableStateOf(false) }

    fun categoryName(): String = when (category) {
        NEW_CATEGORY -> newCategory.trim()
        "" -> ""
        else -> categories.firstOrNull { it.id == category }?.name ?: category
    }

    fun save() {
        val tagList = tags.split(',', ' ').map { it.trim() }.filter { it.isNotEmpty() }
        val noteLists = inLists.filter { l -> lists.any { it.id == l && it.kind == ListKind.NOTES } }
        if (note == null) {
            if (text.isBlank() && title.isBlank()) return
            val n = store.createNote(text, title, categoryName(), tagList, listIds = noteLists, priority = priority)
            selection.editNote(n.id)
        } else {
            // One save (one `axnotes.notes.saved`), category included: note-sorter learns from re-categorizations.
            val cat = categoryName().let { if (it.isBlank()) "" else store.ensureCategory(it).id }
            store.saveNote(note.copy(title = title.ifBlank { note.title }, text = text, tags = tagList, priority = priority, listIds = noteLists, category = cat))
        }
        runtime.navigate(Selection.ROUTE_HOME)
    }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead(if (note == null) "New note" else "Edit note", eyebrow = "AX Notes",
            description = note?.let { "Created ${formatWhen(it.createdAt)} · ${it.source.wire}" }) {
            AxfButton("Save", { save() }, tone = ButtonTone.PRIMARY, icon = "save")
        }
        AxfTextField(title, { title = it }, Modifier.fillMaxWidth(), label = "Title", placeholder = "From the first words if empty")
        AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), label = "Note", singleLine = false, minLines = 6)

        AxfCard(Modifier.fillMaxWidth(), title = "Sort it", icon = "folder") {
            AxfSelectField("Category", category, categories.sortedBy { it.order }.map { SelectOption(it.id, it.name) } + SelectOption(NEW_CATEGORY, "New category…"),
                { category = it }, Modifier.fillMaxWidth(), empty = "Uncategorized", hint = "Categories are shared with to-dos")
            if (category == NEW_CATEGORY) AxfTextField(newCategory, { newCategory = it }, Modifier.fillMaxWidth(), label = "New category")
            AxfTextField(tags, { tags = it }, Modifier.fillMaxWidth(), label = "Tags", placeholder = "work, idea", leadingIcon = "tag")
            AxfSelectField("Priority", priority.wire, PRIORITY_OPTIONS, { priority = Priority.of(it) }, Modifier.fillMaxWidth())
            val noteLists = lists.filter { it.kind == ListKind.NOTES }
            if (noteLists.isNotEmpty()) {
                AxfText("In lists", style = Axf.type.labelLarge)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                    noteLists.forEach { l ->
                        AxfChip(l.name, icon = "list", selected = l.id in inLists, onClick = { inLists = if (l.id in inLists) inLists - l.id else inLists + l.id })
                    }
                }
            }
        }

        if (note != null && note.codeLinks.isNotEmpty()) AxfCard(Modifier.fillMaxWidth(), title = "Code", icon = "code") { CodeLinkChips(note.codeLinks) }

        if (note != null) {
            AxfButton(if (confirmDelete) "Tap again to delete" else "Delete note", {
                if (confirmDelete) { store.deleteNote(note.id); selection.editNote(null); runtime.navigate(Selection.ROUTE_HOME) } else confirmDelete = true
            }, tone = ButtonTone.DANGER, icon = "trash")
        }
    }
}
