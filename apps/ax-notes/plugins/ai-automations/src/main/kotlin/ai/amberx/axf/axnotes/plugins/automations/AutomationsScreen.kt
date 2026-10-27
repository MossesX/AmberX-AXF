package ai.amberx.axf.axnotes.plugins.automations

import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfContainer
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfNote
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.NoteTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier

/** The `ai-automations` screen: every rule with its on/off switch, and what ran lately. */
@Composable
internal fun AutomationsScreen() {
    val auto = rememberService<AutomationsController>()
    if (auto == null) { AxfEmptyState("Automations are off", message = "Turn the AI automations plugin on in Settings → Plugins.", icon = "zap"); return }
    val rules by auto.rules.collectAsState()
    val log by auto.log.collectAsState()
    LazyColumn(Modifier.fillMaxSize().padding(Axf.space.x(2)), verticalArrangement = Arrangement.spacedBy(Axf.space.x(1))) {
        if (!auto.on()) item { AxfNote("Automations are paused (Settings → Plugins → AI automations).", tone = NoteTone.WARNING) }
        items(rules, key = { it.id }) { r ->
            AxfSwitch(r.enabled, { auto.setEnabled(r.id, it) }, Modifier.fillMaxWidth(), label = r.label, description = "${RuleText.trigger(r.trigger)}: ${RuleText.action(r.action)}.")
        }
        item { AxfButton("Check now", { auto.wake() }, tone = ButtonTone.GHOST, icon = "refresh") }
        item {
            AxfContainer(Modifier.fillMaxWidth(), title = "Recent", icon = "clock") {
                if (log.isEmpty()) AxfText("Nothing has run yet.", muted = true) else { for (line in log.take(15)) AxfText(line) }
            }
        }
    }
}
