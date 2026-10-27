package ai.amberx.axf.axnotes.views

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import ai.amberx.axf.ai.AiModule
import ai.amberx.axf.axnotes.AppModule
import ai.amberx.axf.axnotes.data.NotesStore
import ai.amberx.axf.axnotes.host.PluginHost
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.onboarding.OnboardingModule
import ai.amberx.axf.overlay.OverlayModule
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.settings.SettingsScreen
import ai.amberx.axf.speech.SpeechModule
import ai.amberx.axf.triggers.TriggersModule
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.settings.SettingsGroupView
import ai.amberx.axf.ui.theme.Axf
import ai.amberx.axf.voice.VoiceModule
import kotlinx.coroutines.launch

/**
 * AX Notes' settings (route `settings`, replacing lib-settings' generic view for this app; the generic one stays one
 * tab away under "All settings", with Appearance and everything else).
 *
 * Tabs host the library settings groups by the module that contributed them — AX Notes (app group + sync status),
 * Voice (lib-voice: voice + voice listening, lib-speech, lib-triggers link), Overlay (lib-overlay), AI (lib-ai),
 * Setup (lib-onboarding) — then Plugins: every plugin listed in plugins.json with its state, and one sub-tab per loaded
 * plugin holding its own settings groups. A tab whose library isn't installed says so; nothing breaks.
 */
@Composable
fun SettingsView() {
    val engine = rememberService<SettingsEngine>() ?: run { SettingsScreen(); return }
    val plugins = rememberService<PluginHost>()
    val groups by engine.groups.collectAsState()
    val values by engine.values.collectAsState()
    val scope = rememberCoroutineScope()
    var tab by remember { mutableStateOf(TABS.first().id) }
    var sub by remember { mutableStateOf("") }
    val loaded = plugins?.plugins ?: emptyList()

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = Axf.space.two, vertical = Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfPageHead("Settings", eyebrow = "AX Notes")
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                for (t in TABS) AxfChip(t.label, icon = t.icon, selected = tab == t.id, onClick = { tab = t.id; sub = "" })
            }
            if (tab == TAB_PLUGINS && loaded.isNotEmpty()) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                AxfChip("All plugins", selected = sub.isEmpty(), onClick = { sub = "" })
                for (p in loaded) AxfChip(p.entry.folder, icon = if (p.ok) "package" else "alert", selected = sub == p.entry.id, onClick = { sub = p.entry.id })
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            val change: (String, kotlinx.serialization.json.JsonElement) -> Unit = { k, v -> scope.launch { engine.set(k, v) } }
            when (tab) {
                TAB_ALL -> SettingsScreen(title = "All settings")
                TAB_PLUGINS -> PluginsTab(loaded, groups, values, sub, change)
                else -> {
                    val t = TABS.first { it.id == tab }
                    val shown = groups.filter { it.module in t.modules }.sortedBy { it.order }
                    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
                        if (tab == TAB_NOTES) item(key = "sync") { SyncCard() }
                        for (g in shown) item(key = g.id) { SettingsGroupView(g, values, change) }
                        if (shown.isEmpty()) item { AxfText("${t.label} isn't installed in this build.", muted = true) }
                    }
                }
            }
        }
    }
}

/** NotesHubSync is still UnwiredHubSync: say plainly that sync is off and how much waits on the phone. */
@Composable
private fun SyncCard() {
    val store = rememberService<NotesStore>() ?: return
    val pending by store.pending.collectAsState()
    val note by store.syncNote.collectAsState()
    AxfCard(Modifier.fillMaxWidth(), title = "axHub sync", icon = "cloud") {
        if (store.sync.ready) AxfBadge("on", tone = "success") else AxfBadge("off", tone = "warning")
        AxfText(
            if (store.sync.ready) "Notes, lists and categories sync with axHub (project ax-notes)."
            else "Off in this version: AX Notes has no axHub data client yet. Everything is kept on this phone; $pending change(s) are queued and go up once sync is wired.",
            muted = !store.sync.ready,
        )
        note?.let { AxfText(it, muted = true, style = Axf.type.bodySmall) }
    }
}

@Composable
private fun PluginsTab(
    loaded: List<PluginHost.Loaded>, groups: List<SettingsGroup>, values: Map<String, kotlinx.serialization.json.JsonElement>,
    sub: String, change: (String, kotlinx.serialization.json.JsonElement) -> Unit,
) {
    val runtime = LocalAxfRuntime.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        val picked = loaded.firstOrNull { it.entry.id == sub }
        if (picked == null) {
            item(key = "intro") {
                AxfCard(Modifier.fillMaxWidth(), title = "Plugins", icon = "package") {
                    AxfText(if (loaded.isEmpty()) "No plugins installed. AX Notes runs as plain voice notes with read-back; plugins add AI sorting, chat and more."
                        else "Each plugin's settings are its own sub-tab above. Install or remove one with its install.mjs / uninstall.mjs.", muted = true)
                    AxfButton("Plugin Manager", { runtime.dispatch("plugin-manager.open") }, icon = "package")
                }
            }
            for (p in loaded) item(key = "p:" + p.entry.id) {
                AxfCard(Modifier.fillMaxWidth(), title = p.module?.label ?: p.entry.folder, icon = if (p.ok) "package" else "alert") {
                    AxfText("${p.entry.id} · ${p.entry.version}", muted = true, style = Axf.type.bodySmall)
                    if (p.ok) AxfBadge("loaded", tone = "success") else { AxfBadge("not loaded", tone = "warning"); AxfText(p.error ?: "", muted = true, style = Axf.type.bodySmall) }
                }
            }
        } else {
            val mine = groups.filter { g -> g.module == picked.module?.id }.sortedBy { it.order }
            if (!picked.ok) item { AxfText("This plugin didn't load: ${picked.error}", muted = true) }
            else if (mine.isEmpty()) item { AxfText("This plugin has no settings.", muted = true) }
            for (g in mine) item(key = g.id) { SettingsGroupView(g, values, change) }
        }
    }
}

private data class SettingsTabDef(val id: String, val label: String, val icon: String, val modules: Set<String> = emptySet())

private const val TAB_NOTES = "notes"
private const val TAB_PLUGINS = "plugins"
private const val TAB_ALL = "all"

private val TABS: List<SettingsTabDef> = listOf(
    SettingsTabDef(TAB_NOTES, "AX Notes", "edit", setOf(AppModule.ID)),
    SettingsTabDef("voice", "Voice", "mic", setOf(VoiceModule.ID, SpeechModule.ID, TriggersModule.ID)),
    SettingsTabDef("overlay", "Overlay", "layers", setOf(OverlayModule.ID)),
    SettingsTabDef("ai", "AI", "sparkles", setOf(AiModule.ID)),
    SettingsTabDef("setup", "Setup", "shield", setOf(OnboardingModule.ID)),
    SettingsTabDef(TAB_PLUGINS, "Plugins", "package"),
    SettingsTabDef(TAB_ALL, "All settings", "settings"),
)
