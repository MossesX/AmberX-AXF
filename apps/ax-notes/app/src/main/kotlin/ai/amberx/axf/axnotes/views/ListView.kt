package ai.amberx.axf.axnotes.views

import ai.amberx.axf.axnotes.model.SmartFilter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.axnotes.model.Categories
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.ListRules
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.axnotes.model.TodoItem
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCheckbox
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import java.time.ZoneId

/**
 * One list (route `list`): its own sort (date / category / priority / my order) and direction, then its notes or
 * to-do items. The arrows move a row (and switch the list to “my order”). A to-do list adds items inline; tap an item
 * to see its notes. A smart list shows and edits its filter.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ListView() {
    val store = rememberService<NotesStore>() ?: run { AxfEmptyState("Lists unavailable", icon = "list"); return }
    val selection = rememberService<Selection>() ?: run { AxfEmptyState("Lists unavailable", icon = "list"); return }
    val runtime = LocalAxfRuntime.current
    val listId by selection.list.collectAsState()
    val lists by store.lists.collectAsState()
    val notes by store.notes.collectAsState()
    val categories by store.categories.collectAsState()
    val l = lists.firstOrNull { it.id == listId } ?: run {
        AxfEmptyState("Pick a list", icon = "list", action = { AxfButton("All lists", { runtime.navigate(Selection.ROUTE_LISTS) }, icon = "list") }); return
    }
    var newItem by remember(l.id) { mutableStateOf("") }
    var editingFilter by remember(l.id) { mutableStateOf(false) }
    var renaming by remember(l.id) { mutableStateOf(false) }
    var name by remember(l.id) { mutableStateOf(l.name) }
    var confirmDelete by remember(l.id) { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfPageHead(l.name, eyebrow = kindLabel(l.kind)) {
            AxfIconButton("edit", "Rename", { renaming = !renaming })
            AxfIconButton("trash", if (confirmDelete) "Tap again to delete the list" else "Delete list", {
                if (confirmDelete) { store.deleteList(l.id); runtime.navigate(Selection.ROUTE_LISTS) } else confirmDelete = true
            }, tint = if (confirmDelete) Axf.colors.danger else Axf.colors.muted)
        }
        if (confirmDelete) AxfText("Tap the bin again to delete “${l.name}”." + (if (l.kind == ListKind.NOTES) " Its notes stay." else ""), color = Axf.colors.danger)
        if (renaming) FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfTextField(name, { name = it }, label = "List name")
            AxfButton("Rename", { if (name.isNotBlank()) store.saveList(l.copy(name = name.trim())); renaming = false }, icon = "check")
        }
        SortBar(l) { s, d -> store.setSort(l.id, s, d) }

        if (l.kind == ListKind.SMART) {
            AxfButton(if (editingFilter) "Done" else "Edit filter", { editingFilter = !editingFilter }, tone = ButtonTone.GHOST, icon = "filter")
            if (editingFilter) FilterFields(l.filter ?: SmartFilter(), categories) { store.saveList(l.copy(filter = it)) }
        }

        if (l.kind == ListKind.TODO) {
            val items = remember(l, categories) { ListRules.itemsOf(l, categories) }
            val ids = items.map { it.id }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfTextField(newItem, { newItem = it }, placeholder = "Add a to-do", leadingIcon = "plus")
                AxfButton("Add", { store.addTodo(l.id, newItem); newItem = "" }, tone = ButtonTone.PRIMARY, enabled = newItem.isNotBlank())
            }
            if (items.isEmpty()) AxfEmptyState("Nothing to do", message = "Add one above or say “add to-do … to ${l.name}”.", icon = "check-circle")
            LazyColumn(verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                itemsIndexed(items, key = { _, it -> it.id }) { i, item ->
                    TodoRow(item, categories.let { c -> Categories.nameOf(item.category, c).takeIf { item.category.isNotBlank() } },
                        onToggle = { store.setDone(l.id, item.id, it) },
                        onOpen = { selection.openItem(l.id, item.id); runtime.navigate(Selection.ROUTE_TODO) },
                        onUp = if (i > 0) ({ store.move(l.id, ids, item.id, i - 1) }) else null,
                        onDown = if (i < items.size - 1) ({ store.move(l.id, ids, item.id, i + 1) }) else null)
                }
            }
        } else {
            val shown = remember(l, notes, categories) { ListRules.notesOf(l, notes, categories) }
            val ids = shown.map { it.id }
            if (shown.isEmpty()) AxfEmptyState("No notes here", message = if (l.kind == ListKind.NOTES) "Add notes to this list from the note editor." else "No note matches the filter.", icon = "edit")
            LazyColumn(verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                itemsIndexed(shown, key = { _, it -> it.id }) { i, n ->
                    Column {
                        NoteRow(n, categories) { selection.editNote(n.id); runtime.navigate(Selection.ROUTE_EDITOR) }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                            if (i > 0) AxfIconButton("arrow-up", "Move up", { store.move(l.id, ids, n.id, i - 1) })
                            if (i < shown.size - 1) AxfIconButton("arrow-down", "Move down", { store.move(l.id, ids, n.id, i + 1) })
                            if (l.kind == ListKind.NOTES) AxfIconButton("x", "Remove from this list", { store.removeFromList(n.id, l.id) })
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun TodoRow(item: TodoItem, category: String?, onToggle: (Boolean) -> Unit, onOpen: () -> Unit, onUp: (() -> Unit)?, onDown: (() -> Unit)?) {
    val zone = ZoneId.systemDefault()
    val bits = buildList {
        if (item.priority != Priority.NONE) add(priorityLabel(item.priority))
        item.dueAt?.let { add("due ${ListRules.isoDay(it, zone)}") }
        category?.let { add(it) }
        if (item.noteIds.isNotEmpty()) add(if (item.noteIds.size == 1) "1 note" else "${item.noteIds.size} notes")
    }
    AxfListItem(item.text, subtitle = bits.joinToString(" · ").ifBlank { null }, onClick = onOpen, trailing = {
        if (onUp != null) AxfIconButton("arrow-up", "Move up", onUp)
        if (onDown != null) AxfIconButton("arrow-down", "Move down", onDown)
        AxfCheckbox(item.done, onToggle)
    })
}
