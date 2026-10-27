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
import ai.amberx.axf.axnotes.model.Category
import ai.amberx.axf.axnotes.model.ListKind
import ai.amberx.axf.axnotes.model.ListRules
import ai.amberx.axf.axnotes.model.ListSort
import ai.amberx.axf.axnotes.model.NoteList
import ai.amberx.axf.axnotes.model.SmartFilter
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSelectField
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.SelectOption
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import java.time.ZoneId

fun kindIcon(k: ListKind): String = when (k) { ListKind.NOTES -> "list"; ListKind.TODO -> "check-circle"; ListKind.SMART -> "filter" }
fun kindLabel(k: ListKind): String = when (k) { ListKind.NOTES -> "Note list"; ListKind.TODO -> "To-do list"; ListKind.SMART -> "Smart list" }
fun sortLabel(s: ListSort): String = when (s) { ListSort.DATE -> "Date"; ListSort.CATEGORY -> "Category"; ListSort.PRIORITY -> "Priority"; ListSort.MANUAL -> "My order" }

/** Lists (route `lists`): every note, to-do and smart list, and a form for a new one. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ListsView() {
    val store = rememberService<NotesStore>() ?: run { AxfEmptyState("Lists unavailable", icon = "list"); return }
    val selection = rememberService<Selection>()
    val runtime = LocalAxfRuntime.current
    val lists by store.lists.collectAsState()
    val notes by store.notes.collectAsState()
    val categories by store.categories.collectAsState()
    var adding by remember { mutableStateOf(false) }

    Column(Modifier.verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfPageHead("Lists", eyebrow = "AX Notes", description = "Say “new list …”, “add to-do …”, “check off …” or “read my list …”.") {
            AxfButton("New list", { adding = !adding }, tone = ButtonTone.PRIMARY, icon = "plus")
        }
        if (adding) NewListForm(categories, { adding = false }) { name, kind, filter ->
            val l = store.createList(name, kind, filter = filter)
            adding = false
            selection?.openList(l.id); runtime.navigate(Selection.ROUTE_LIST)
        }
        if (lists.isEmpty()) AxfEmptyState("No lists yet", icon = "list")
        lists.forEach { l ->
            val count = when (l.kind) {
                ListKind.TODO -> "${l.items.count { !it.done }} open of ${l.items.size}"
                else -> "${ListRules.notesOf(l, notes, categories).size} notes"
            }
            AxfListItem(l.name, subtitle = "${kindLabel(l.kind)} · $count · by ${sortLabel(l.sort).lowercase()}", icon = kindIcon(l.kind),
                onClick = { selection?.openList(l.id); runtime.navigate(Selection.ROUTE_LIST) })
        }
    }
}

/** Name + kind; a smart list also gets its filter (category, tag, date range, words). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun NewListForm(categories: List<Category>, onCancel: () -> Unit, onCreate: (String, ListKind, SmartFilter?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf(ListKind.TODO) }
    var filter by remember { mutableStateOf(SmartFilter()) }
    AxfCard(Modifier.fillMaxWidth(), title = "New list", icon = "plus") {
        AxfTextField(name, { name = it }, Modifier.fillMaxWidth(), label = "Name", placeholder = "Groceries")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            ListKind.entries.forEach { k -> AxfChip(kindLabel(k), icon = kindIcon(k), selected = kind == k, onClick = { kind = k }) }
        }
        if (kind == ListKind.SMART) FilterFields(filter, categories) { filter = it }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Create", { onCreate(name, kind, if (kind == ListKind.SMART) filter else null) }, tone = ButtonTone.PRIMARY, icon = "check", enabled = name.isNotBlank())
            AxfButton("Cancel", onCancel, tone = ButtonTone.GHOST)
        }
    }
}

/** A smart list's filter as fields. Dates are typed as yyyy-mm-dd (inclusive). */
@Composable
fun FilterFields(f: SmartFilter, categories: List<Category>, onChange: (SmartFilter) -> Unit) {
    val zone = ZoneId.systemDefault()
    var from by remember { mutableStateOf(f.fromAt?.let { ListRules.isoDay(it, zone) }.orEmpty()) }
    var to by remember { mutableStateOf(f.toAt?.let { ListRules.isoDay(it, zone) }.orEmpty()) }
    AxfText("Show every note that matches all of these:", muted = true)
    AxfSelectField("Category", f.category.orEmpty(), categories.sortedBy { it.order }.map { SelectOption(it.id, it.name) },
        { onChange(f.copy(category = it.ifBlank { null })) }, Modifier.fillMaxWidth(), empty = "Any category")
    AxfTextField(f.tag.orEmpty(), { onChange(f.copy(tag = it.trim().removePrefix("#").ifBlank { null })) }, Modifier.fillMaxWidth(), label = "Tag", leadingIcon = "tag")
    AxfTextField(f.text.orEmpty(), { onChange(f.copy(text = it.ifBlank { null })) }, Modifier.fillMaxWidth(), label = "Words", leadingIcon = "search")
    AxfTextField(from, { from = it; onChange(f.copy(fromAt = ListRules.parseDay(it, zone))) }, Modifier.fillMaxWidth(), label = "From (yyyy-mm-dd)", leadingIcon = "calendar",
        error = if (from.isNotBlank() && ListRules.parseDay(from, zone) == null) "Use yyyy-mm-dd" else null)
    AxfTextField(to, { to = it; onChange(f.copy(toAt = ListRules.parseDay(it, zone, endOfDay = true))) }, Modifier.fillMaxWidth(), label = "To (yyyy-mm-dd)", leadingIcon = "calendar",
        error = if (to.isNotBlank() && ListRules.parseDay(to, zone) == null) "Use yyyy-mm-dd" else null)
}

/** Sort picker shared by the list screen: four sorts + direction. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SortBar(l: NoteList, onChange: (ListSort, Boolean) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
        ListSort.entries.forEach { s -> AxfChip(sortLabel(s), icon = "sort", selected = l.sort == s, onClick = { onChange(s, l.descending) }) }
        if (l.sort != ListSort.MANUAL) AxfChip(if (l.descending) "Descending" else "Ascending", icon = if (l.descending) "arrow-down" else "arrow-up", onClick = { onChange(l.sort, !l.descending) })
    }
}
