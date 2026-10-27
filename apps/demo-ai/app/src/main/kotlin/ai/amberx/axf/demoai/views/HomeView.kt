package ai.amberx.axf.demoai.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.ai.AiService
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * lib-ai demo: which AI modes this account may use (non-admins get chat only), then a live session on axHub —
 * start it with a prompt, watch the reply stream in, send a follow-up. Leaving the screen only stops following;
 * the session stays live on the hub until Close.
 */
@Composable
fun HomeView() {
    val ai = rememberService<AiService>() ?: run { AxfEmptyState("AI isn't installed", icon = "info"); return }
    val scope = rememberCoroutineScope()
    var prompt by remember { mutableStateOf("Say hello from AmberX in one sentence.") }
    var sessionId by remember { mutableStateOf<String?>(null) }
    var reply by remember { mutableStateOf("") }
    var status by remember { mutableStateOf("No session yet.") }
    var follow by remember { mutableStateOf<Job?>(null) }
    val modes = remember { ai.availableModes() }

    fun watch(id: String) {
        follow?.cancel()
        follow = scope.launch { ai.replies(id).collect { u -> reply = u.text; status = u.status } }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "What this shows", icon = "info") {
            AxfText("lib-ai runs every AI session live on axHub (the console's assistant behind the hub sign-in). Sign in to the hub first. Non-admins get Chat only; other modes are granted per user.")
        }
        AxfCard(Modifier.fillMaxWidth(), title = "Modes you can use", icon = "list") {
            AxfText(if (modes.isEmpty()) "None — sign in to the hub." else modes.joinToString("\n") { "• ${it.label} (${it.id})" })
        }
        AxfCard(Modifier.fillMaxWidth(), title = "Live session", icon = "play") {
            AxfTextField(prompt, { prompt = it }, Modifier.fillMaxWidth(), label = "Prompt", singleLine = false, minLines = 2)
            AxfButton(if (sessionId == null) "Start" else "Send", {
                scope.launch {
                    val id = sessionId
                    if (id == null) {
                        when (val r = ai.start(AiRequestInput(prompt))) {
                            is AxfResult.Ok -> { sessionId = r.value.session.id; watch(r.value.session.id) }
                            is AxfResult.Err -> status = r.failure.message
                        }
                    } else {
                        when (val r = ai.send(id, AiRequestInput(prompt))) {
                            is AxfResult.Ok -> Unit
                            is AxfResult.Err -> status = r.failure.message
                        }
                    }
                }
            }, tone = ButtonTone.PRIMARY, icon = "play")
            sessionId?.let { id ->
                AxfButton("Close session", { scope.launch { ai.close(id); follow?.cancel(); sessionId = null; status = "Closed." } }, tone = ButtonTone.GHOST)
            }
            AxfText("Status: $status")
            if (reply.isNotEmpty()) AxfText(reply)
        }
    }
}
