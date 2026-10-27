package ai.amberx.axf.axnotes.plugins.buildbridge

import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfContainer
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfNote
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.NoteTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler

/** The `ai-build-bridge` screen: send a request, see each one's approval state with its axHub link. Admins only. */
@Composable
internal fun BuildBridgeScreen() {
    val bridge = rememberService<BridgeController>()
    if (bridge == null) { AxfEmptyState("Build requests are off", message = "Turn the AI build bridge plugin on in Settings → Plugins.", icon = "hammer"); return }
    val denied = remember { bridge.denied() }
    if (denied != null) { AxfEmptyState("Admins only", message = denied, icon = "lock"); return }
    val requests by bridge.requests.collectAsState()
    var draft by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val uri = LocalUriHandler.current

    Column(Modifier.fillMaxSize().padding(Axf.space.x(2)), verticalArrangement = Arrangement.spacedBy(Axf.space.x(1.5))) {
        AxfText("Every request goes to Brett's Build Orchestrator only after he approves it in axHub (approval link + AXHub app push). Nothing is built from here.", muted = true)
        AxfTextField(draft, { draft = it; error = null }, Modifier.fillMaxWidth(), placeholder = "What should be built?", singleLine = false, minLines = 3)
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.x(1)), verticalAlignment = Alignment.CenterVertically) {
            AxfButton("Send for approval", { error = BuildIntents.fromVoice(draft)?.let { bridge.submit(it.copy(source = RequestSource.MANUAL)) } ?: "Type what to build."; if (error == null) draft = "" }, tone = ButtonTone.PRIMARY, icon = "send", enabled = draft.isNotBlank())
        }
        error?.let { AxfNote(it, tone = NoteTone.WARNING) }
        if (requests.isEmpty()) AxfText("No build requests yet. Say \"build …\" or tag a note #build.", muted = true)
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Axf.space.x(1))) {
            items(requests, key = { it.id }) { r ->
                AxfContainer(Modifier.fillMaxWidth(), title = r.title, icon = "hammer") {
                    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.x(1)), verticalAlignment = Alignment.CenterVertically) {
                        AxfBadge(r.status.label, tone = toneOf(r.status))
                        AxfText(r.source.wire + (r.buildId?.let { " · build $it" } ?: ""), muted = true)
                    }
                    r.message?.let { AxfText(it) }
                    r.summary?.let { AxfText(it, muted = true) }
                    if (r.status == RequestStatus.PENDING_APPROVAL && r.nextPollAt != null) AxfText("Checked ${r.polls} time${if (r.polls == 1) "" else "s"}; every ${ApprovalPoll.delayMs(r.polls) / 1000} s now.", muted = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.x(1))) {
                        r.approvalUrl?.takeIf { r.status == RequestStatus.PENDING_APPROVAL }?.let { url -> AxfButton("Open approval", { runCatching { uri.openUri(url) } }, tone = ButtonTone.PRIMARY, icon = "external-link") }
                        if (r.status.active) AxfButton("Check now", { bridge.checkNow(r.id) }, icon = "refresh")
                        if (r.status == RequestStatus.PENDING_APPROVAL || r.status == RequestStatus.SUBMITTING) AxfButton("Cancel", { bridge.cancel(r.id) }, tone = ButtonTone.DANGER)
                        if (!r.status.active) AxfButton("Remove", { bridge.forget(r.id) }, tone = ButtonTone.GHOST, icon = "trash")
                    }
                }
            }
        }
    }
}

private fun toneOf(s: RequestStatus): String = when (s) {
    RequestStatus.APPROVED, RequestStatus.FINISHED -> "success"
    RequestStatus.PENDING_APPROVAL, RequestStatus.SUBMITTING -> "warning"
    RequestStatus.REJECTED, RequestStatus.FAILED -> "danger"
    else -> "muted"
}
