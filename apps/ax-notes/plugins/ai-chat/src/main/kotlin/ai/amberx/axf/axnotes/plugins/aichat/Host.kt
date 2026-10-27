package ai.amberx.axf.axnotes.plugins.aichat

import ai.amberx.axf.kernel.ai.AI_SESSION_CAPABILITY
import ai.amberx.axf.kernel.ai.AiMode
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModeRegistry
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.speech.PlaceholderSpeechProvider
import ai.amberx.axf.kernel.speech.SPEECH_CAPABILITY
import ai.amberx.axf.kernel.speech.SpeechProvider
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * The host seams this plugin uses, all through kernel contracts (never app classes), so the app runs the same with the
 * plugin removed: AI sessions (`axf.ai.session`), speech (`axf.speech`), the KV store, and two JSON actions on the
 * action bus — `axnotes.notes.save` (the app saves a note) and `axnotes.notes.saved` (the app announces a saved note;
 * plugins watch it through a non-consuming interceptor).
 */
internal object HostActions {
    const val SAVE_NOTE: String = "axnotes.notes.save"
    const val NOTE_SAVED: String = "axnotes.notes.saved"
}

/** UAC view for AI modes from the runtime's permissions (same rule as lib-ai's local policy). Pure. */
internal object Policies {
    fun fromPermissions(perms: Set<String>): AiModePolicy {
        val admin = "*" in perms || "ai.admin" in perms
        val modes = perms.filter { it.startsWith("ai.mode.") && it.length > 8 && !it.endsWith("*") }.map { it.removePrefix("ai.mode.") }
        return AiModePolicy(admin, perms.toList(), if (modes.isEmpty()) null else (listOf(AiModes.CHAT) + modes).distinct())
    }
}

internal class PluginHost(private val ctx: ModuleContext, val prefix: String) {
    val runtime: AxfRuntime? get() = ctx.service(AxfRuntime::class)
    val kv: KeyValueStore? get() = ctx.service(KeyValueStore::class)

    fun ai(): AiSessionClient = (ctx.services.capability(AI_SESSION_CAPABILITY) as? AiSessionClient) ?: PlaceholderAiSessionClient
    fun speech(): SpeechProvider = (ctx.services.capability(SPEECH_CAPABILITY) as? SpeechProvider) ?: PlaceholderSpeechProvider
    fun modes(): List<AiMode> = ctx.service(AiModeRegistry::class)?.list() ?: AiModes.BUILTINS
    fun policy(): AiModePolicy = Policies.fromPermissions(runtime?.permissions() ?: emptySet())

    fun canSaveNotes(): Boolean = runtime?.actions?.has(HostActions.SAVE_NOTE) == true
    fun saveNote(draft: JsonObject): Boolean {
        val rt = runtime ?: return false
        if (!rt.actions.has(HostActions.SAVE_NOTE)) return false
        return rt.dispatch(HostActions.SAVE_NOTE, draft.toString()).isOk
    }

    /** Runtime data, in the KV store under [prefix]. */
    fun getString(key: String): String? = kv?.get(prefix + key)
    fun putString(key: String, value: String) { kv?.put(prefix + key, value) }
    fun remove(key: String) { kv?.remove(prefix + key) }

    /** A setting from this plugin's Settings → Plugins tab (keys are `<prefix><key>`; lib-settings mirrors saved values into Config). */
    fun setting(key: String, default: Boolean): Boolean = ctx.service(Config::class)?.bool(prefix + key, default) ?: default
    fun settingString(key: String): String? = ctx.service(Config::class)?.string(prefix + key)
    /** Changes a setting for this run (the settings tab is what saves it). */
    fun setSetting(key: String, value: Boolean) { ctx.service(Config::class)?.set(prefix + key, value) }

    /**
     * Removes every KV key this plugin wrote (the device half of a complete uninstall). Saved settings values live in
     * lib-settings' preference store under the same prefix; the host clears those for plugins it no longer lists.
     */
    fun purge(): Int {
        val s = kv ?: return 0
        val mine = s.keys().filter { it.startsWith(prefix) }
        for (k in mine) s.remove(k)
        return mine.size
    }

    companion object {
        val json: Json = Json { ignoreUnknownKeys = true }
        fun parseObject(s: String?): JsonObject? = s?.let { runCatching { json.parseToJsonElement(it) as? JsonObject }.getOrNull() }
    }
}
