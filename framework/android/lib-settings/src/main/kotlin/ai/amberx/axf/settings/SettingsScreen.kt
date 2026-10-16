package ai.amberx.axf.settings

import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.settings.SettingsGroupView
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import kotlinx.coroutines.launch

/** The generated settings interface: every contributed group, searchable, rendered by SettingsGroupView. Register it as the `settings` view. */
@Composable
public fun SettingsScreen(modifier: Modifier = Modifier, title: String = "Settings") {
    val kernel = LocalAxfKernel.current
    val engine = remember(kernel) { kernel?.services?.get<SettingsEngine>() }
    if (engine == null) { AxfEmptyState("Settings unavailable", message = "SettingsModule is not installed."); return }
    val groups by engine.groups.collectAsState()
    val values by engine.values.collectAsState()
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf("") }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead(title, eyebrow = "${groups.size} groups", description = "Generated from the settings schema every module contributes.") }
        item { AxfTextField(filter, { filter = it }, Modifier.fillMaxWidth(), placeholder = "Search settings…", leadingIcon = "search") }
        for (g in groups) item(key = g.id) { SettingsGroupView(g, values, { k, v -> scope.launch { engine.set(k, v) } }, filter = filter) }
    }
}
