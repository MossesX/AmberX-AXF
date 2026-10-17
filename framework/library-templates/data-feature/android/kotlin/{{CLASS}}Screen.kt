package {{PACKAGE}}

import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfTextField
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/** {{LABEL}} — The library's main screen. Apps map the "{{ROUTE}}" view to it. */
@Composable
public fun {{CLASS}}Screen(modifier: Modifier = Modifier) {
    val actions = LocalAxfActions.current
    val repo = LocalAxfKernel.current?.services?.get({{CLASS}}Repository::class)
    val items by (repo?.items ?: kotlinx.coroutines.flow.MutableStateFlow(emptyList<{{CLASS}}Item>())).collectAsState()
    var draft by remember { mutableStateOf("") }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("{{LABEL}}", eyebrow = "{{MODULE_NAME}} · {{TEMPLATE}}", description = "{{DESCRIPTION}}") }
        item {
            AxfCard(title = "New {{P_ITEM}}", icon = "plus") {
                AxfTextField(draft, { draft = it }, Modifier.fillMaxWidth(), label = "Title")
                AxfButton("Add", { repo?.add(draft); draft = "" }, tone = ButtonTone.PRIMARY, icon = "plus", enabled = draft.isNotBlank())
            }
        }
        if (items.isEmpty()) item { AxfText("No {{P_ITEM}}s yet.", muted = true) }
        items(items.size) { i ->
            val it0 = items[i]
            AxfListItem(it0.title, subtitle = if (it0.done) "done" else "open", icon = if (it0.done) "check" else "box", onClick = { repo?.toggle(it0.id) }, trailing = { AxfIconButton("x", "Remove", { repo?.remove(it0.id) }) })
        }
        item {
            AxfCard(title = "Settings", icon = "settings") {
                AxfText("Every library contributes a settings group; this one lives under {{LABEL}}.", muted = true)
                AxfButton("Open settings", { actions.dispatch("app.settings") }, icon = "settings", tone = ButtonTone.NEUTRAL)
            }
        }
    }
}
