package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult

public data class ActionMeta(val label: String, val requires: String? = null, /** true for the framework's no-op stubs (apps override) */ val stub: Boolean = false, val module: String = "kernel", /** needs arguments (`swap:<type>:<id>`); search lists only argument-free actions */ val params: Boolean = false, /** false keeps an argument-free action out of search */ val searchable: Boolean = true)

public class ActionContext(public val payload: String? = null, public val extras: Map<String, Any?> = emptyMap())

public fun interface ActionHandler { public fun invoke(args: List<String>, ctx: ActionContext) }

public data class ParsedAction(val id: String, val args: List<String>)

/**
 * Action engine — the cross-application command bus. Menus, toolbars, context menus, shortcuts and
 * gestures never call code directly; they reference an action spec like `file.save` or `swap:color-theme:next`.
 * Grammar (Foundations: f.actions): `id[:arg[:arg…]]`, `{payload}` substituted from the context.
 */
public class ActionBus(private val can: (String?) -> Boolean, private val onMissing: (String) -> Unit = {}, private val onDenied: (ActionMeta) -> Unit = {}) {
    private val handlers = LinkedHashMap<String, Pair<ActionHandler, ActionMeta>>()
    private val interceptors = mutableListOf<(ParsedAction, ActionContext) -> Boolean>()

    public fun register(id: String, meta: ActionMeta, fn: ActionHandler): () -> Unit {
        handlers[id] = fn to meta
        return { if (handlers[id]?.first === fn) handlers.remove(id) }
    }

    /** An interceptor returning true consumes the action (used by devtools recording, scripting, undo grouping). */
    public fun intercept(fn: (ParsedAction, ActionContext) -> Boolean): () -> Unit { interceptors += fn; return { interceptors -= fn } }

    public fun get(id: String): ActionMeta? = handlers[id]?.second
    public fun has(id: String): Boolean = id in handlers
    public fun list(): List<Pair<String, ActionMeta>> = handlers.map { (k, v) -> k to v.second }
    public fun isStub(id: String): Boolean = handlers[id]?.second?.stub == true

    public fun dispatch(spec: String, ctx: ActionContext = ActionContext()): AxfResult<Unit> {
        val resolved = ctx.payload?.let { spec.replace("{payload}", it) } ?: spec
        val parsed = parse(resolved)
        for (i in interceptors) if (i(parsed, ctx)) return AxfResult.ok(Unit)
        val (fn, meta) = handlers[parsed.id] ?: run { onMissing(parsed.id); return AxfResult.err(AxfFailure.NotFound("action", parsed.id)) }
        if (meta.requires != null && !can(meta.requires)) { onDenied(meta); return AxfResult.err(AxfFailure.Denied(meta.requires)) }
        return AxfResult.runCatching { fn.invoke(parsed.args, ctx) }
    }

    public companion object {
        public fun parse(spec: String): ParsedAction { val parts = spec.split(':'); return ParsedAction(parts.firstOrNull() ?: "", parts.drop(1)) }
    }
}

/** The standard action vocabulary shared by every AXF app. The framework registers stubs; apps override the ones they implement. */
public object StandardActions {
    public val ALL: Map<String, ActionMeta> = linkedMapOf(
        "file.new" to ActionMeta("New file"), "file.open" to ActionMeta("Open…"), "file.save" to ActionMeta("Save", "files.write"), "file.export" to ActionMeta("Export", "files.write"),
        "edit.undo" to ActionMeta("Undo"), "edit.redo" to ActionMeta("Redo"), "edit.cut" to ActionMeta("Cut"), "edit.copy" to ActionMeta("Copy"), "edit.paste" to ActionMeta("Paste"), "edit.delete" to ActionMeta("Delete", "files.write"),
        "run.build" to ActionMeta("Build", "dev.tools"), "run.deploy" to ActionMeta("Deploy", "dev.deploy"), "dev.console" to ActionMeta("Developer console", "dev.tools"),
        "help.about" to ActionMeta("About"), "help.docs" to ActionMeta("Documentation"), "view.shortcuts" to ActionMeta("Keyboard shortcuts"),
        // Android additions (all stubs until a module implements them)
        "app.settings" to ActionMeta("Settings"), "app.logs" to ActionMeta("Logs", "dev.tools"), "app.share" to ActionMeta("Share"), "app.search" to ActionMeta("Search"),
        "account.signin" to ActionMeta("Sign in"), "account.signout" to ActionMeta("Sign out"), "account.profile" to ActionMeta("Profile"), "billing.manage" to ActionMeta("Manage subscription"),
    )
}
