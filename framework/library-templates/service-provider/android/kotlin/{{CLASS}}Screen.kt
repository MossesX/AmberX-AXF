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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

/** {{LABEL}} — The library's main screen. Apps map the "{{ROUTE}}" view to it. */
@Composable
public fun {{CLASS}}Screen(modifier: Modifier = Modifier) {
    val actions = LocalAxfActions.current
    val service = LocalAxfKernel.current?.services?.get({{CLASS}}Service::class)
    var status by remember { mutableStateOf("checking…") }
    LaunchedEffect(service) { status = service?.provider?.status()?.getOrNull() ?: "service not registered" }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("{{LABEL}}", eyebrow = "{{MODULE_NAME}} · {{TEMPLATE}}", description = "{{DESCRIPTION}}") }
        item {
            AxfCard(title = "Provider", icon = "package") {
                AxfText("Active provider: ${service?.provider?.name ?: "none"}")
                AxfText(status, muted = true)
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
