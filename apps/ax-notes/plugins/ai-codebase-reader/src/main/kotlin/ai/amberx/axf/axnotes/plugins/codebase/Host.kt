package ai.amberx.axf.axnotes.plugins.codebase

import ai.amberx.axf.kernel.ai.AI_SESSION_CAPABILITY
import ai.amberx.axf.kernel.ai.AiModePolicy
import ai.amberx.axf.kernel.ai.AiModeRegistry
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiSessionClient
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import kotlinx.serialization.json.JsonObject

/**
 * The host seams this plugin uses, all through kernel contracts (never app classes), so the app runs the same with the
 * plugin removed: AI sessions (`axf.ai.session`, mode ai.read-codebase runs on axHub and reads the repo there), the KV
 * store (data under [prefix]), Config (settings) and JSON actions on the action bus that the app handles:
 *   `axnotes.notes.save`   {id?, title, text, tags[], source, category?, codeLinks[]?}   (with id: create or update that note)
 *   `axnotes.notes.saved`  the app announces a saved note (payload = note JSON); watched without consuming it
 *   `axnotes.todos.sync`   {list: {id, name}, owner, add[], update[], close[], reopen[]}  (a generated to-do list; items
 *                          are the app's to-do JSON; close / reopen are item ids; the user's own items are never touched)
 *   `axnotes.lists.delete` {id}   removes a list this plugin generated (purge)
 * A missing action is skipped quietly (the plugin keeps working with less).
 */
internal object HostActions {
    const val SAVE_NOTE: String = "axnotes.notes.save"
    const val NOTE_SAVED: String = "axnotes.notes.saved"
    const val SYNC_TODOS: String = "axnotes.todos.sync"
    const val DELETE_LIST: String = "axnotes.lists.delete"
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

    fun client(): AiSessionClient = (ctx.services.capability(AI_SESSION_CAPABILITY) as? AiSessionClient) ?: PlaceholderAiSessionClient
    fun ai(): AiAsk = AiAsk(client(), ctx.service(AiModeRegistry::class)?.list() ?: AiModes.BUILTINS, Policies.fromPermissions(runtime?.permissions() ?: emptySet()))

    fun has(action: String): Boolean = runtime?.actions?.has(action) == true

    /** Dispatches a host action only when someone handles it (never a "no handler" toast). */
    fun dispatchIfHandled(actionId: String, payload: JsonObject): Boolean {
        val rt = runtime ?: return false
        return rt.actions.has(actionId) && rt.dispatch(actionId, payload.toString()).isOk
    }

    /** Watches an action without consuming it (the app's `axnotes.notes.saved`); returns the remover. */
    fun watch(actionId: String, fn: (JsonObject?) -> Unit): () -> Unit =
        runtime?.actions?.intercept { a, c -> if (a.id == actionId) runCatching { fn(J.parse(c.payload)) }; false } ?: {}

    fun toast(message: String, kind: ToastKind = ToastKind.INFO) { runCatching { runtime?.toast(message, kind) } }

    /** Runtime data, in the KV store under [prefix]. */
    fun get(key: String): String? = kv?.get(prefix + key)
    fun put(key: String, value: String) { kv?.put(prefix + key, value) }
    fun remove(key: String) { kv?.remove(prefix + key) }
    fun keys(sub: String): List<String> = kv?.keys()?.filter { it.startsWith(prefix + sub) }?.map { it.removePrefix(prefix) } ?: emptyList()

    /** A setting from this plugin's Settings → Plugins tab (keys are `<prefix><key>`; lib-settings mirrors saved values into Config). */
    fun setting(key: String, default: String): String = ctx.service(Config::class)?.string(prefix + key)?.takeIf { it.isNotEmpty() } ?: default
    fun setting(key: String, default: Boolean): Boolean = ctx.service(Config::class)?.bool(prefix + key, default) ?: default

    /** Removes every KV key this plugin wrote (the device half of a complete uninstall). */
    fun purge(): Int {
        val s = kv ?: return 0
        val mine = s.keys().filter { it.startsWith(prefix) }
        for (k in mine) s.remove(k)
        return mine.size
    }
}
