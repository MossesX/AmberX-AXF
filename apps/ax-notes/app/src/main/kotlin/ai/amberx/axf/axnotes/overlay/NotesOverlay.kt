package ai.amberx.axf.axnotes.overlay

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Color
import ai.amberx.axf.axnotes.capture.CaptureController
import ai.amberx.axf.axnotes.capture.CaptureState
import ai.amberx.axf.axnotes.capture.VoiceLoop
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.kernel.triggers.TriggerRegistry
import ai.amberx.axf.overlay.Chip
import ai.amberx.axf.overlay.OverlayHost
import ai.amberx.axf.triggers.AxfTriggers
import ai.amberx.axf.triggers.ThresholdEditor
import ai.amberx.axf.triggers.TriggerLogEntry
import ai.amberx.axf.triggers.formatThreshold
import ai.amberx.axf.ui.ViewContribution
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * AX Notes on lib-overlay's pill (OverlayHost, `axf.overlay`):
 *  - chips ARMED (voice armed: arming phrase said, or always armed), MIC (the engine is listening), AI (lib-ai can answer);
 *  - the log: every utterance the trigger host decided on, with its confidence and outcome (fired / below threshold /
 *    not armed …); tapping a line opens a card under the pill that writes that trigger's threshold;
 *  - the mini screen: live transcript, last note, AI reply, a mic button (dictation) and hands-free on/off, plus a tab
 *    for every plugin mini screen (extension point `axnotes.mini-screens`);
 *  - the quick action starts / stops dictation.
 */
class NotesOverlay(
    private val overlay: OverlayHost,
    private val scope: CoroutineScope,
    private val controller: CaptureController,
    private val loop: VoiceLoop?,
    private val store: NotesStore,
    private val aiReply: StateFlow<String?>,
    private val aiOn: () -> Boolean,
    private val armed: () -> Boolean,
    private val triggers: AxfTriggers?,
    private val registry: TriggerRegistry?,
    private val miniScreens: () -> List<ViewContribution>,
) {
    private var ticker: kotlinx.coroutines.Job? = null
    /** The mini-screen tab showing: "" = the built-in notes view, else a plugin contribution id. */
    @Volatile private var miniTab: String? = null

    /** `<ctx>` while the open overlay shows a plugin's `<ctx>.mini` screen; null otherwise (the route decides). */
    fun miniContext(): String? {
        val st = overlay.state.value
        val t = miniTab ?: return null
        if (!st.shown || !st.miniOpen || t.isEmpty()) return null
        return t.removeSuffix(".mini")
    }

    fun install() {
        overlay.setTitle("AX Notes")
        overlay.setChips(listOf(
            Chip(CHIP_ARMED, "Armed", "Idle", tone = "success"),
            Chip(CHIP_MIC, "Mic", "Mic off", tone = "info", icon = "mic"),
            Chip(CHIP_AI, "AI", "AI off", tone = "accent", icon = "sparkles"),
        ))
        overlay.onQuickAction { toggleDictation() }
        overlay.log.onTap { line -> if (line.ref.isNotBlank()) overlay.setCard { dismiss -> ThresholdCard(line.ref, dismiss) } }
        overlay.setMiniContent { MiniScreen() }
        if (ticker?.isActive != true) ticker = scope.launch {
            var last = Triple<Boolean?, Boolean?, Boolean?>(null, null, null)
            while (isActive) {
                val now = Triple(armed(), controller.capture.listening.value, aiOn())
                if (now != last) {
                    overlay.setChip(CHIP_ARMED, now.first == true)
                    overlay.setChip(CHIP_MIC, now.second == true)
                    overlay.setChip(CHIP_AI, now.third == true)
                    last = now
                }
                delay(TICK_MS)
            }
        }
    }

    fun uninstall() {
        ticker?.cancel(); ticker = null
        overlay.onQuickAction(null)
        overlay.log.onTap(null)
        overlay.setMiniContent(null)
        overlay.setCard(null)
        overlay.setChips(null)
        overlay.setTitle(null)
    }

    fun toggleDictation() { if (controller.state.value is CaptureState.Dictating) controller.finishDictation() else controller.startDictation() }

    /** lib-triggers' log sink: one overlay line per utterance (what was heard, confidence 0–1, outcome, trigger id). */
    fun log(e: TriggerLogEntry) {
        val heard = e.heard.firstOrNull().orEmpty()
        if (heard.isBlank()) return
        val dropped = e.dropped
        val fired = e.fired
        when {
            dropped != null -> overlay.log.add(heard, e.inputConfidence / 100.0, dropped.id, "")
            fired != null -> {
                val d = e.decisions.firstOrNull { it.triggerId == fired.triggerId }
                overlay.log.add("$heard → ${labelOf(fired.triggerId)}", (d?.confidence ?: e.inputConfidence) / 100.0, "fired", fired.triggerId)
            }
            else -> {
                val d = e.decisions.maxByOrNull { it.confidence }
                if (d == null) overlay.log.add(heard, e.inputConfidence / 100.0, "no match", "")
                else overlay.log.add("$heard ≈ ${labelOf(d.triggerId)}", d.confidence / 100.0, d.outcome.id, d.triggerId)
            }
        }
    }

    /** A plain line (e.g. a note saved by typing, an AI reply arriving). */
    fun note(text: String, tag: String = "") { overlay.log.add(text, null as Double?, tag, "") }

    private fun labelOf(id: String): String = triggers?.store?.get(id)?.trigger?.label ?: registry?.get(id)?.label ?: id

    // ---------------------------------------------------------------- compose

    @Composable
    private fun ThresholdCard(id: String, dismiss: () -> Unit) {
        val stored = remember(id) { triggers?.store?.get(id) }
        val t = stored?.trigger ?: remember(id) { registry?.get(id) }
        if (t == null) {
            AxfCard(Modifier.fillMaxWidth(), title = "Trigger", icon = "zap") {
                AxfText("“$id” isn't a trigger any more.", muted = true)
                AxfButton("Close", dismiss, tone = ButtonTone.GHOST)
            }
            return
        }
        var value by remember(id) { mutableStateOf(t.threshold) }
        var error by remember(id) { mutableStateOf<String?>(null) }
        AxfCard(Modifier.fillMaxWidth(), title = t.label, icon = "zap") {
            AxfText("Runs when a match is at least ${formatThreshold(value)} sure. Lower it if “${t.label}” is missed, raise it if it fires by mistake.", muted = true, style = Axf.type.bodySmall)
            ThresholdEditor(value, { value = it })
            if (stored == null) AxfText("Plugin trigger: the change lasts until the app restarts.", muted = true, style = Axf.type.bodySmall)
            error?.let { AxfText(it, color = Axf.colors.danger, style = Axf.type.bodySmall) }
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Save", {
                    val ok = if (stored != null) triggers?.store?.setThreshold(id, value)?.isOk == true
                        else registry?.update(id, JsonObject(mapOf("threshold" to JsonPrimitive(value)))) != null
                    if (ok) dismiss() else error = "Couldn't change it."
                }, tone = ButtonTone.PRIMARY, icon = "check")
                AxfButton("Cancel", dismiss, tone = ButtonTone.GHOST)
            }
        }
    }

    @Composable
    private fun MiniScreen() {
        val plugins = remember { miniScreens() }
        // The first plugin mini screen shows by default (e.g. ai-chat); "Notes" is the built-in one and the fallback.
        var tab by remember { mutableStateOf(plugins.firstOrNull()?.id ?: "") }
        miniTab = tab
        Column(Modifier.fillMaxWidth().padding(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            if (plugins.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                AxfChip("Notes", icon = "edit", selected = tab.isEmpty(), onClick = { tab = "" })
                for (p in plugins) AxfChip(p.title, icon = p.icon, selected = tab == p.id, onClick = { tab = p.id })
            }
            val picked = plugins.firstOrNull { it.id == tab }
            if (picked != null) picked.content() else NotesMini()
        }
    }

    @Composable
    private fun NotesMini() {
        val state by controller.state.collectAsState()
        val listening by controller.capture.listening.collectAsState()
        val partial by controller.capture.partial.collectAsState()
        val notes by store.notes.collectAsState()
        val reply by aiReply.collectAsState()
        val said by controller.speaker.said.collectAsState()
        val holders = loop?.holders?.collectAsState()
        val handsFree = holders?.value?.contains(VoiceLoop.HOLD_HANDS_FREE) == true
        val dictating = state as? CaptureState.Dictating
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            AxfText(when { dictating != null -> "Dictating — say “end note”"; listening -> "Listening…"; else -> "Mic off" }, style = Axf.type.labelLarge, color = if (dictating != null || listening) Axf.colors.accent else Color.Unspecified)
            val live = dictating?.text?.let { t -> listOf(t, partial).filter { it.isNotBlank() }.joinToString(" ") } ?: partial
            AxfText(live.ifBlank { "…" }, maxLines = 4)
            notes.maxByOrNull { it.createdAt }?.let { n ->
                AxfText("Last note", style = Axf.type.labelSmall, muted = true)
                AxfText(n.title, maxLines = 1)
                if (n.text != n.title) AxfText(n.text, muted = true, maxLines = 2, style = Axf.type.bodySmall)
            }
            (reply ?: said)?.let { r ->
                AxfText(if (reply != null) "AI reply" else "AX Notes said", style = Axf.type.labelSmall, muted = true)
                AxfText(r, maxLines = 5, style = Axf.type.bodySmall)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                AxfButton(if (dictating != null) "Save note" else "Note", { toggleDictation() }, tone = ButtonTone.PRIMARY, icon = if (dictating != null) "check" else "mic")
                if (loop != null) AxfButton(if (handsFree) "Stop" else "Listen", { loop.setHandsFree(!handsFree) }, tone = ButtonTone.GHOST, icon = "zap")
            }
        }
    }

    companion object {
        const val CHIP_ARMED: String = "armed"
        const val CHIP_MIC: String = "mic"
        const val CHIP_AI: String = "ai"
        const val TICK_MS: Long = 700
    }
}
