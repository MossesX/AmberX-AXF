package ai.amberx.axf.axnotes.views

import ai.amberx.axf.axnotes.model.Categories
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import ai.amberx.axf.axnotes.model.ListRules
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSelectField
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.SelectOption
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import java.time.ZoneId

private const val NEW_CATEGORY = "\u0000new"

/**
 * One to-do item (route `todo-item`): text, done, due date, priority, category (shared with notes) and the notes it
 * holds — open, detach, attach an existing note (search) or write a new one straight onto the item.
 */
@Composable
fun TodoItemView() {
    val store = rememberService<NotesStore>() ?: run { AxfEmptyState("Lists unavailable", icon = "list"); return }
    val selection = rememberService<Selection>() ?: run { AxfEmptyState("Lists unavailable", icon = "list"); return }
    val runtime = LocalAxfRuntime.current
    val listId by selection.list.collectAsState()
    val itemId by selection.item.collectAsState()
    val lists by store.lists.collectAsState()
    val notes by store.notes.collectAsState()
    val categories by store.categories.collectAsState()
    val list = lists.firstOrNull { it.id == listId }
    val item = list?.items?.firstOrNull { it.id == itemId }
    if (list == null || item == null) {
        AxfEmptyState("Pick a to-do", icon = "check-circle", action = { AxfButton("All lists", { runtime.navigate(Selection.ROUTE_LISTS) }, icon = "list") }); return
    }
    val zone = ZoneId.systemDefault()
    var text by remember(item.id) { mutableStateOf(item.text) }
    var due by remember(item.id) { mutableStateOf(item.dueAt?.let { ListRules.isoDay(it, zone) }.orEmpty()) }
    var category by remember(item.id) { mutableStateOf(item.category) }
    var newCategory by remember(item.id) { mutableStateOf("") }
    var find by remember(item.id) { mutableStateOf("") }
    var newNote by remember(item.id) { mutableStateOf("") }
    val dueAt = ListRules.parseDay(due, zone)
    val attached = item.noteIds.mapNotNull { id -> notes.firstOrNull { it.id == id } }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead(item.text, eyebrow = list.name, description = "Added ${formatWhen(item.createdAt)}" + (item.doneAt?.let { " · done ${formatWhen(it)}" } ?: "")) {
            AxfButton("Back to list", { runtime.navigate(Selection.ROUTE_LIST) }, tone = ButtonTone.GHOST, icon = "arrow-left")
        }
        AxfCard(Modifier.fillMaxWidth(), title = "To-do", icon = "check-circle") {
            AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), label = "What", singleLine = false)
            AxfSwitch(item.done, { store.setDone(list.id, item.id, it) }, label = "Done")
            AxfTextField(due, { due = it }, Modifier.fillMaxWidth(), label = "Due (yyyy-mm-dd)", leadingIcon = "calendar",
                error = if (due.isNotBlank() && dueAt == null) "Use yyyy-mm-dd" else null)
            AxfSelectField("Priority", item.priority.wire, PRIORITY_OPTIONS, { store.updateTodo(list.id, item.copy(priority = Priority.of(it))) }, Modifier.fillMaxWidth())
            AxfSelectField("Category", category, categories.sortedBy { it.order }.map { SelectOption(it.id, it.name) } + SelectOption(NEW_CATEGORY, "New category…"),
                { category = it; if (it != NEW_CATEGORY) store.recategorizeTodo(list.id, item.id, categories.firstOrNull { c -> c.id == it }?.name.orEmpty()) },
                Modifier.fillMaxWidth(), empty = "Uncategorized", hint = "Shared with notes")
            if (category == NEW_CATEGORY) {
                AxfTextField(newCategory, { newCategory = it }, Modifier.fillMaxWidth(), label = "New category")
                AxfButton("Use it", { if (newCategory.isNotBlank()) { store.recategorizeTodo(list.id, item.id, newCategory); category = Categories.slug(newCategory) } }, icon = "check")
            }
            AxfButton("Save", {
                if (text.isNotBlank() && (due.isBlank() || dueAt != null)) {
                    store.list(list.id)?.items?.firstOrNull { it.id == item.id }?.let { cur -> store.updateTodo(list.id, cur.copy(text = text.trim(), dueAt = if (due.isBlank()) null else dueAt)) }
                }
            }, tone = ButtonTone.PRIMARY, icon = "save")
            if (item.codeLinks.isNotEmpty()) CodeLinkChips(item.codeLinks)
        }

        AxfCard(Modifier.fillMaxWidth(), title = "Notes on this to-do", icon = "edit") {
            if (attached.isEmpty()) AxfText("No notes yet.", muted = true)
            attached.forEach { n ->
                AxfListItem(n.title, subtitle = formatWhen(n.updatedAt), icon = "edit", onClick = { selection.editNote(n.id); runtime.navigate(Selection.ROUTE_EDITOR) }, trailing = {
                    AxfIconButton("x", "Detach ${n.title}", { store.detachNote(list.id, item.id, n.id) })
                })
            }
            AxfTextField(newNote, { newNote = it }, Modifier.fillMaxWidth(), label = "Write a note on it", singleLine = false, minLines = 2)
            AxfButton("Add note", {
                val n = store.createNote(newNote, categoryName = categories.firstOrNull { it.id == item.category }?.name, listIds = emptyList())
                store.attachNote(list.id, item.id, n.id); newNote = ""
            }, icon = "plus", enabled = newNote.isNotBlank())
            AxfTextField(find, { find = it }, Modifier.fillMaxWidth(), placeholder = "Attach an existing note", leadingIcon = "search")
            if (find.isNotBlank()) ListRules.search(notes, find).filter { it.id !in item.noteIds }.take(5).forEach { n ->
                AxfListItem(n.title, subtitle = "Tap to attach", icon = "link", onClick = { store.attachNote(list.id, item.id, n.id); find = "" })
            }
        }

        AxfButton("Delete to-do", { store.deleteTodo(list.id, item.id); runtime.navigate(Selection.ROUTE_LIST) }, tone = ButtonTone.DANGER, icon = "trash")
    }
}
