package ai.amberx.axf.xselect

import ai.amberx.axf.kernel.engine.BadgeData
import ai.amberx.axf.readaloud.ReadAloud
import ai.amberx.axf.readaloud.ReadAloudState
import ai.amberx.axf.readaloud.TextChunker
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfBannerBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfNote
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.components.NoteTone
import ai.amberx.axf.ui.settings.SettingsGroupView
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import kotlinx.coroutines.launch

/** Sections of the X Select screen; each shows some of the settings groups (all = every group, search covers all). */
private val SECTIONS: List<Triple<String, String, List<String>>> = listOf(
    Triple("all", "All", emptyList()),
    Triple("menu", "Menu", listOf("xselect.menu", "xselect.feedback")),
    Triple("voice", "Voice", listOf("xselect.voice", "xselect.speed", "xselect.pauses")),
    Triple("text", "Text", listOf("xselect.text", "xselect.chunks")),
    Triple("playback", "Playback", listOf("xselect.queue", "xselect.audio", "xselect.reading", "xselect.timers")),
    Triple("look", "Banner & look", listOf("xselect.banner", "xselect.look")),
)

/**
 * The X Select screen (view `xselect`): settings only. A toolbar (test voice, pause/resume, stop, read the clipboard,
 * check axHub, reset the voice settings), a live banner (what's being read, the word highlighted, progress), the axHub
 * badge, then every X Select setting in sections with search. Theme tokens and framework controls only.
 */
@Composable
public fun XSelectScreen(modifier: Modifier = Modifier) {
    val engine = rememberService<SettingsEngine>()
    val svc = rememberService<XSelectService>()
    if (engine == null || svc == null) { AxfEmptyState("X Select isn't ready", message = "The app needs SettingsModule, ReadAloudModule, SelectionModule and XSelectModule."); return }
    val context = LocalContext.current
    val groups by engine.groups.collectAsState()
    val values by engine.values.collectAsState()
    val state by ReadAloud.state.collectAsState()
    val hub by svc.hub.collectAsState()
    val scope = rememberCoroutineScope()
    var section by remember { mutableStateOf("all") }
    var filter by remember { mutableStateOf("") }
    var note by remember { mutableStateOf<String?>(null) }
    val mine = groups.filter { it.tab == XSelectSettings.TAB }
    val ids = SECTIONS.firstOrNull { it.first == section }?.third.orEmpty()
    val shown = if (filter.isNotBlank() || ids.isEmpty()) mine else mine.filter { it.id in ids }
    val count = mine.sumOf { g -> g.settings.size }
    fun flag(key: String, d: Boolean) = svc.bool(key, d)
    LaunchedEffect(Unit) { ReadAloud.refreshVoices(context) }

    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item {
            AxfPageHead("X Select", eyebrow = "Plugin · $count settings", description = "Select text in any app and tap ${XSelectMenu.entry(svc.string(XSelectSettings.MAIN_LABEL) ?: "ReadAloud").label} next to Select all.", actions = {
                val v = XSelectBadge.hub(hub.first, hub.second, svc.bool(XSelectSettings.HUB_COMPACT, false))
                if (flag(XSelectSettings.HUB_BADGE, true)) AxfBannerBadge(BadgeData(v.icon, v.label, v.tone, "pill", v.tooltip, "xselect.hub"))
            })
        }
        if (flag(XSelectSettings.SCREEN_TOOLBAR, true)) item {
            XToolbar(state, onTest = { svc.testVoice() }, onToggle = { ReadAloud.toggle(context) }, onStop = { ReadAloud.stop(context) },
                onClipboard = { if (!svc.readClipboard()) note = "The clipboard is empty." },
                onHub = { scope.launch { svc.checkHub(0) } },
                onReset = { scope.launch { svc.resetVoice(); note = "Voice, speed and text settings are back to their defaults." } },
                onSlower = { ReadAloud.slower(context) }, onFaster = { ReadAloud.faster(context) })
        }
        if (flag(XSelectSettings.SCREEN_BANNER, true)) item { LiveBanner(state, svc) }
        if (!flag(XSelectSettings.ON, true)) item { AxfNote("Read aloud is switched off: the entry isn't in any app's text menu.", tone = NoteTone.WARNING, icon = "alert") }
        note?.let { n -> item { AxfNote(n, icon = "info") } }
        state.error?.let { e -> item { AxfNote(e, tone = NoteTone.WARNING, icon = "alert") } }
        item { AxfTextField(filter, { filter = it }, Modifier.fillMaxWidth(), placeholder = "Search $count settings…", leadingIcon = "search") }
        if (filter.isBlank()) item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                for ((id, label, _) in SECTIONS) AxfChip(label, selected = section == id, onClick = { section = id })
            }
        }
        for (g in shown) item(key = g.id) { SettingsGroupView(g, values, { k, v -> scope.launch { engine.set(k, v) } }, filter = filter) }
        if (flag(XSelectSettings.SHOW_VOICES, true) && (section == "all" || section == "voice") && filter.isBlank()) item { VoicesCard(state, svc, onPick = { name -> scope.launch { engine.set(XSelectModule.KEYS.voice, kotlinx.serialization.json.JsonPrimitive(name)) } }, onEngine = { pkg -> scope.launch { engine.set(XSelectModule.KEYS.engine, kotlinx.serialization.json.JsonPrimitive(pkg)) } }) }
        if (state.queue.history.isNotEmpty() && (section == "all" || section == "playback") && filter.isBlank()) item {
            AxfCard(title = "Recently read", icon = "history") {
                Column { for (h in state.queue.history.take(10)) AxfListItem(h.title.ifBlank { "Text" }, subtitle = "${"%,d".format(h.chars)} characters · ${if (h.finished) "finished" else "stopped"}", icon = if (h.finished) "check-circle" else "x-circle") }
            }
        }
    }
}

/** The screen's own toolbar: framework icon buttons on a surface strip. */
@Composable
private fun XToolbar(st: ReadAloudState, onTest: () -> Unit, onToggle: () -> Unit, onStop: () -> Unit, onClipboard: () -> Unit, onHub: () -> Unit, onReset: () -> Unit, onSlower: () -> Unit, onFaster: () -> Unit) {
    val theme = Axf.theme
    val c = theme.colors
    Row(
        Modifier.fillMaxWidth().background(c.surface2, theme.shapes.smShape).border(theme.spacing.borderWidth, c.border, theme.shapes.smShape)
            .horizontalScroll(rememberScrollState()).padding(horizontal = theme.spacing.one, vertical = theme.spacing.half),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.half),
    ) {
        AxfButton("Test voice", onTest, tone = ButtonTone.PRIMARY, icon = "play")
        AxfIconButton(if (st.paused) "play" else "pause", if (st.paused) "Resume" else "Pause", onToggle, enabled = st.active)
        AxfIconButton("x", "Stop", onStop, enabled = st.active)
        AxfIconButton("minus", "Slower", onSlower, enabled = st.active)
        AxfIconButton("plus", "Faster", onFaster, enabled = st.active)
        AxfIconButton("paste", "Read the clipboard", onClipboard)
        AxfIconButton("refresh", "Check axHub now", onHub)
        AxfIconButton("undo", "Reset voice settings", onReset)
    }
}

/** Live banner: what's being read, the current word (or sentence) highlighted in the chosen tone, progress, queue. */
@Composable
private fun LiveBanner(st: ReadAloudState, svc: XSelectService) {
    val theme = Axf.theme
    val c = theme.colors
    val prefs = remember(st.queue.current?.id) { ReadAloud.prefs() }
    val tone = when (svc.string(XSelectSettings.TONE)) { "success" -> c.success; "warning" -> c.warning; "danger" -> c.danger; else -> c.accent }
    val size = svc.number(XSelectSettings.TEXT_SIZE, 1.0).coerceIn(0.8, 2.0).toFloat()
    val item = st.queue.current
    val u = st.utterance
    Column(
        Modifier.fillMaxWidth().background(if (item != null) c.accentSoft else c.surface2, theme.shapes.smShape).border(theme.spacing.borderWidth, c.border, theme.shapes.smShape).padding(theme.spacing.oneHalf),
        verticalArrangement = Arrangement.spacedBy(theme.spacing.half),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.half)) {
            AxfBadge(when { item == null -> "Idle"; st.paused -> "Paused"; else -> "Reading ${XSelectBadge.fmt(st.rate)}×" }, tone = when { item == null -> "muted"; st.paused -> "warning"; else -> "accent" })
            AxfText(item?.title?.ifBlank { null } ?: "Nothing is being read", style = theme.typography.titleSmall, maxLines = 1)
        }
        if (item != null && u != null) {
            val word = st.word?.takeIf { prefs.highlight == ai.amberx.axf.readaloud.HighlightMode.WORD }
                ?.let { r -> if (r.first in u.text.indices) r.first..minOf(r.last, u.text.lastIndex) else null }
            val text = buildAnnotatedString {
                when {
                    prefs.highlight == ai.amberx.axf.readaloud.HighlightMode.NONE -> append(u.text)
                    word == null -> withStyle(SpanStyle(color = tone, fontWeight = FontWeight.SemiBold)) { append(u.text) }
                    else -> {
                        append(u.text.substring(0, word.first))
                        withStyle(SpanStyle(color = c.text, background = tone.copy(alpha = theme.opacityTint), fontWeight = FontWeight.Bold)) { append(u.text.substring(word.first, word.last + 1)) }
                        append(u.text.substring(word.last + 1))
                    }
                }
            }
            Text(text, style = theme.typography.bodyLarge.copy(fontSize = theme.typography.bodyLarge.fontSize * size), color = c.text)
            LinearProgressIndicator(progress = { st.queue.progress().toFloat() }, modifier = Modifier.fillMaxWidth().height(theme.spacing.half), color = tone, trackColor = c.surface3)
            val left = TextChunker.estimateMs(item.utterances.drop(st.queue.position), st.rate) / 1000
            AxfText("Piece ${st.queue.position + 1} of ${item.utterances.size} · about ${if (left >= 60) "${left / 60} min" else "$left s"} left" + (if (st.queue.next.isNotEmpty()) " · ${st.queue.next.size} next" else "") + (if (st.sleepAt > 0) " · sleep timer on" else ""), muted = true)
        } else AxfText("Select text in any app and tap the X Select entry, or use Test voice.", muted = true)
    }
}

/** Installed engines and voices: tap one to use it (same settings as the Voice group's text fields). */
@Composable
private fun VoicesCard(st: ReadAloudState, svc: XSelectService, onPick: (String) -> Unit, onEngine: (String) -> Unit) {
    var lang by remember { mutableStateOf("") }
    val chosen = svc.string(XSelectModule.KEYS.voice).orEmpty()
    val engine = svc.string(XSelectModule.KEYS.engine).orEmpty()
    AxfCard(title = "Voices on this phone", icon = "user", actions = { AxfText("${st.voices.size}", muted = true) }) {
        Column(verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            if (st.engines.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                AxfChip("Phone default", selected = engine.isEmpty(), onClick = { onEngine("") })
                for (e in st.engines) AxfChip(e.label, selected = engine == e.packageName, onClick = { onEngine(e.packageName) })
            }
            if (st.voices.isEmpty()) AxfText("No voices reported yet. Test voice starts the engine.", muted = true)
            else {
                AxfTextField(lang, { lang = it }, Modifier.fillMaxWidth(), placeholder = "Filter by language (en, en-GB, fr…)", leadingIcon = "filter")
                AxfListItem("Best voice for the language", subtitle = "Picked automatically", icon = "sparkles", selected = chosen.isEmpty(), onClick = { onPick("") })
                for (v in st.voices.filter { lang.isBlank() || it.language.startsWith(lang.trim(), ignoreCase = true) }.take(60)) {
                    AxfListItem(v.name, subtitle = "${v.language} · quality ${v.quality}" + (if (v.network) " · online" else "") + (if (!v.installed) " · not installed" else ""),
                        icon = if (v.network) "cloud" else "smartphone", selected = chosen == v.name, onClick = { onPick(v.name) })
                }
            }
        }
    }
}
