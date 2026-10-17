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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch

/** {{LABEL}} — The library's main screen. Apps map the "{{ROUTE}}" view to it. */
@Composable
public fun {{CLASS}}Screen(modifier: Modifier = Modifier) {
    val actions = LocalAxfActions.current
    val client = LocalAxfKernel.current?.services?.get({{CLASS}}Client::class)
    val scope = rememberCoroutineScope()
    var result by remember { mutableStateOf("not checked") }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("{{LABEL}}", eyebrow = "{{MODULE_NAME}} · {{TEMPLATE}}", description = "{{DESCRIPTION}}") }
        item {
            AxfCard(title = "Connection", icon = "cloud") {
                AxfText(client?.baseUrl ?: "client not registered", muted = true)
                AxfText(result)
                AxfButton("Check connection", { scope.launch { result = client?.ping()?.let { "HTTP $it" } ?: "unreachable" } }, tone = ButtonTone.PRIMARY, icon = "refresh")
                AxfButton("Sync now", { actions.dispatch("{{ROUTE}}.sync") }, icon = "refresh")
            }
        }
        item {
            AxfCard(title = "Settings", icon = "settings") {
                AxfText("Every library contributes a settings group; this one lives under {{LABEL}}.", muted = true)
                AxfButton("Open settings", { actions.dispatch("app.settings") }, icon = "settings", tone = ButtonTone.NEUTRAL)
            }
        }
    }
}
