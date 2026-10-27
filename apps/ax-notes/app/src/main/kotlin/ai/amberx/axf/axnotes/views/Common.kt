package ai.amberx.axf.axnotes.views

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import ai.amberx.axf.axnotes.model.CodeLink
import ai.amberx.axf.axnotes.model.Priority
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.SelectOption
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.DateFormat
import java.util.Date

/** Which note / list / to-do item the editor screens show (screens pass the choice through here, then navigate). */
class Selection {
    private val _note = MutableStateFlow<String?>(null)
    val note: StateFlow<String?> = _note.asStateFlow()
    private val _list = MutableStateFlow<String?>(null)
    val list: StateFlow<String?> = _list.asStateFlow()
    private val _item = MutableStateFlow<String?>(null)
    val item: StateFlow<String?> = _item.asStateFlow()

    /** null = a new note. */
    fun editNote(id: String?) { _note.value = id }
    fun openList(id: String) { _list.value = id }
    fun openItem(listId: String, itemId: String) { _list.value = listId; _item.value = itemId }

    companion object {
        const val ROUTE_HOME = "home"
        const val ROUTE_EDITOR = "editor"
        const val ROUTE_CAPTURE = "capture"
        const val ROUTE_LISTS = "lists"
        const val ROUTE_LIST = "list"
        const val ROUTE_TODO = "todo-item"
    }
}

private val dateTime: DateFormat = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)
private val dateOnly: DateFormat = DateFormat.getDateInstance(DateFormat.MEDIUM)

fun formatWhen(ms: Long): String = dateTime.format(Date(ms))
fun formatDay(ms: Long): String = dateOnly.format(Date(ms))

val PRIORITY_OPTIONS: List<SelectOption> = listOf(
    SelectOption(Priority.NONE.wire, "No priority"), SelectOption(Priority.LOW.wire, "Low"),
    SelectOption(Priority.MEDIUM.wire, "Medium"), SelectOption(Priority.HIGH.wire, "High"),
)

fun priorityLabel(p: Priority): String = when (p) { Priority.NONE -> ""; Priority.LOW -> "Low"; Priority.MEDIUM -> "Medium"; Priority.HIGH -> "High" }

/** Code links as chips; a tap opens the file on GitHub. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CodeLinkChips(links: List<CodeLink>) {
    if (links.isEmpty()) return
    val context = LocalContext.current
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
        links.forEach { l ->
            val url = l.githubUrl()
            val open: (() -> Unit)? = if (url == null) null else {
                { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } }
            }
            AxfChip(l.label(), icon = "github", onClick = open)
        }
    }
}
