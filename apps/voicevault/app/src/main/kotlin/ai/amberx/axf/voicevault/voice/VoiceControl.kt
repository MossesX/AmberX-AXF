package ai.amberx.axf.voicevault.voice

import android.content.Context
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.settings.SettingsEngine
import ai.amberx.axf.voice.AxfVoice
import ai.amberx.axf.voice.CommandMatch
import ai.amberx.axf.voice.VoiceCommand
import ai.amberx.axf.voicevault.background.WakeListener
import ai.amberx.axf.voicevault.notes.VoiceNotes
import ai.amberx.axf.voicevault.vault.VaultSession
import java.util.Calendar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive

/**
 * Voice Vault's voice control (app code): the master microphone switch, which triggers are on, your own voice actions
 * (registered as lib-voice commands, so they match like any trigger and show in Settings → Global trigger and commands),
 * quiet hours for the background listener, and the "What it heard" list. Everything stays on this phone.
 */
class VoiceControl(
    private val context: Context,
    private val scope: CoroutineScope,
    private val voice: AxfVoice?,
    private val kv: KeyValueStore?,
    private val config: () -> Config?,
    private val settings: () -> SettingsEngine?,
    private val runtime: () -> AxfRuntime?,
    private val session: () -> VaultSession,
    private val notes: () -> VoiceNotes,
) {
    private val _actions = MutableStateFlow(VoiceActionRules.parseActions(kv?.get(KEY_ACTIONS)))
    val actions: StateFlow<List<CustomAction>> = _actions.asStateFlow()
    private val _off = MutableStateFlow(VoiceActionRules.parseOff(kv?.get(KEY_OFF)))
    /** Command ids switched off (confirm and cancel never are). */
    val off: StateFlow<Set<String>> = _off.asStateFlow()
    private val _log = MutableStateFlow(VoiceActionRules.parseLog(kv?.get(KEY_LOG)))
    val log: StateFlow<List<HeardEntry>> = _log.asStateFlow()
    private val _micOff = MutableStateFlow(false)
    /** The master switch: true = Voice Vault doesn't listen at all (not in the app, not in the background). */
    val micOff: StateFlow<Boolean> = _micOff.asStateFlow()

    private fun setting(key: String): String? = config()?.string(key)

    /** Called once settings are loaded (and on every change of the keys below). */
    fun refreshFromSettings() { _micOff.value = setting(KEY_MIC_OFF)?.toBooleanStrictOrNull() ?: false }

    fun start() {
        registerAll()
        refreshFromSettings()
        settings()?.onChange { key, _ -> if (key == KEY_MIC_OFF) { val was = _micOff.value; refreshFromSettings(); if (was != _micOff.value) applyMic() } }
    }

    /* ---------------- the microphone switch ---------------- */

    fun setMicOff(off: Boolean) {
        if (_micOff.value == off) return
        _micOff.value = off
        applyMic()
        scope.launch { settings()?.set(KEY_MIC_OFF, JsonPrimitive(off)) ?: config()?.set(KEY_MIC_OFF, off) }
    }

    private fun applyMic() {
        if (_micOff.value) {
            session().stopListening()
            WakeListener.micTurnedOff(context)
        } else {
            session().micBackOn()
            WakeListener.ensureRunning(context, session().backgroundOn || notes().listenOn)
        }
    }

    /* ---------------- quiet hours ---------------- */

    val quietOn: Boolean get() = setting(KEY_QUIET)?.toBooleanStrictOrNull() ?: false
    val quietFrom: Int get() = VoiceActionRules.minutesOf(setting(KEY_QUIET_FROM)) ?: 22 * 60
    val quietTo: Int get() = VoiceActionRules.minutesOf(setting(KEY_QUIET_TO)) ?: 7 * 60

    /** Milliseconds until quiet hours end, 0 when the background listener may listen now. */
    fun quietLeftMs(now: Calendar = Calendar.getInstance()): Long {
        if (!quietOn) return 0
        return VoiceActionRules.msUntilQuietEnds(now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE), now.get(Calendar.SECOND), quietFrom, quietTo)
    }

    fun quietSummary(): String = if (!quietOn) "Off" else "${VoiceActionRules.clock(quietFrom)} to ${VoiceActionRules.clock(quietTo)}"

    /* ---------------- trigger switches ---------------- */

    fun isOn(commandId: String): Boolean = VoiceActionRules.isOn(commandId, _off.value)
    /** [ids] minus the ones switched off. */
    fun enabled(vararg ids: String): List<String> = ids.filter(::isOn)

    fun setOn(commandId: String, on: Boolean) {
        val next = if (on) _off.value - commandId else _off.value + commandId
        _off.value = VoiceActionRules.parseOff(VoiceActionRules.encodeOff(next))
        kv?.put(KEY_OFF, VoiceActionRules.encodeOff(_off.value))
        val a = _actions.value.firstOrNull { it.commandId == commandId }
        if (a != null && a.on != on) save(a.copy(on = on))
    }

    /* ---------------- your voice actions ---------------- */

    /** Ids of the custom actions that may match right now: on, and (from the background) marked for it. */
    fun activeIds(background: Boolean): List<String> = _actions.value.filter { it.on && isOn(it.commandId) && (!background || it.background) }.map { it.commandId }

    fun byCommand(commandId: String?): CustomAction? = _actions.value.firstOrNull { it.commandId == commandId }

    fun newAction(): CustomAction = CustomAction(VoiceActionRules.newId(_actions.value), "", emptyList(), ActionKind.OPEN, "vault")

    /** Saves (adds or replaces) [a]; returns why it can't, or null. */
    fun save(a: CustomAction): String? {
        val others = _actions.value.filter { it.id != a.id }
        VoiceActionRules.problem(a, others, { p -> voice?.commands?.owner(p) }, ROUTES.keys)?.let { return it }
        val list = _actions.value.toMutableList()
        val i = list.indexOfFirst { it.id == a.id }
        if (i >= 0) list[i] = a else list += a
        persist(list)
        return null
    }

    fun remove(id: String) {
        val a = _actions.value.firstOrNull { it.id == id } ?: return
        voice?.commands?.reset(a.commandId)
        voice?.commands?.unregister(a.commandId)
        _off.value = _off.value - a.commandId; kv?.put(KEY_OFF, VoiceActionRules.encodeOff(_off.value))
        persist(_actions.value.filter { it.id != id })
    }

    private fun persist(list: List<CustomAction>) {
        _actions.value = list
        kv?.put(KEY_ACTIONS, VoiceActionRules.encodeActions(list))
        registerAll()
    }

    private fun registerAll() {
        val cmds = voice?.commands ?: return
        cmds.commands.value.filter { it.id.startsWith(VoiceActionRules.PREFIX) && _actions.value.none { a -> a.commandId == it.id } }.forEach { cmds.unregister(it.id) }
        _actions.value.forEachIndexed { i, a -> cmds.register(VoiceCommand(a.commandId, a.label, a.phrases, VoiceActionRules.describe(a, ::routeLabel, ::actionLabel), GROUP, order = 100 + i)) }
    }

    /** Matches [heard] against your voice actions (background ones only when [background]). */
    fun match(heard: List<String>, background: Boolean): CommandMatch? {
        val ids = activeIds(background)
        if (ids.isEmpty()) return null
        return voice?.commands?.match(heard, ids, 0.82)
    }

    /**
     * Runs a voice action while Voice Vault is open. Vault actions wait for the unlock (they run once you're in).
     * Suspends while a voice note or a spoken reply is going, so the app's listener doesn't talk over it.
     */
    suspend fun runInApp(a: CustomAction) {
        val s = session()
        when (a.kind) {
            ActionKind.OPEN -> runtime()?.navigate(a.arg)
            ActionKind.RETRIEVE_SITE -> s.whenUnlocked("Unlock to copy the password for ${a.arg}.") { s.retrieveSite(a.arg) }
            ActionKind.STORE -> s.whenUnlocked("Unlock to save a password.") { s.startStore(a.arg) }
            ActionKind.NOTE -> notes().take()
            ActionKind.SAY -> voice?.speaker?.say(a.arg, voice.language)
            ActionKind.LOCK -> s.lock(clearClipboard = true)
            ActionKind.MIC_OFF -> setMicOff(true)
            ActionKind.RUN -> runtime()?.dispatch(a.arg)
        }
    }

    /** Runs the voice action with this id (one heard in the background that opened the app). */
    fun runById(id: String) { _actions.value.firstOrNull { it.id == id }?.let { a -> scope.launch { runInApp(a) } } }

    /* ---------------- what it heard ---------------- */

    val logOn: Boolean get() = setting(KEY_LOG_ON)?.toBooleanStrictOrNull() ?: true

    /** Notes a trigger that matched. [phrase] is the trigger's own phrase, never the rest of what was said. */
    fun heard(what: String, phrase: String, background: Boolean) {
        if (!logOn) return
        _log.value = VoiceActionRules.append(_log.value, HeardEntry(System.currentTimeMillis(), what, phrase, if (background) "background" else "app"))
        kv?.put(KEY_LOG, VoiceActionRules.encodeLog(_log.value))
    }

    fun clearLog() { _log.value = emptyList(); kv?.remove(KEY_LOG) }

    /* ---------------- labels ---------------- */

    fun routeLabel(id: String): String = ROUTES[id] ?: id

    /** App actions a voice action can run: argument-free, real ones (not the framework's stubs). */
    fun runnableActions(): List<Pair<String, String>> = runtime()?.actions?.list().orEmpty()
        .filter { (_, m) -> !m.params && !m.stub && m.label.isNotBlank() }.map { (id, m) -> id to m.label }.distinctBy { it.first }.sortedBy { it.second }

    fun actionLabel(id: String): String = runnableActions().firstOrNull { it.first == id }?.second ?: id

    companion object {
        const val GROUP = "Your voice actions"
        const val ROUTE = "voice-actions"
        /** Device-only (never mirrored to axHub): a phone's microphone is that phone's call. */
        const val KEY_MIC_OFF = "voicevault.device.micOff"
        const val KEY_QUIET = "voicevault.quiet.on"
        const val KEY_QUIET_FROM = "voicevault.quiet.from"
        const val KEY_QUIET_TO = "voicevault.quiet.to"
        const val KEY_LOG_ON = "voicevault.heardLog"
        const val KEY_ACTIONS = "voicevault.voice.actions"
        const val KEY_OFF = "voicevault.voice.off"
        const val KEY_LOG = "voicevault.voice.heard"
        /** Screens a voice action can open. */
        val ROUTES: Map<String, String> = linkedMapOf(
            "home" to "the Voice screen", "vault" to "Saved sites", VoiceNotes.ROUTE to "Voice notes", ROUTE to "Voice actions",
            "voice-triggers" to "Triggers and commands", "settings" to "Settings", "hub-sync" to "axHub sync",
        )
    }
}
