package ai.amberx.axf.kernel.runtime

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.asset.AppMenu
import ai.amberx.axf.kernel.asset.AssetEnvelope
import ai.amberx.axf.kernel.asset.AssetRegistry
import ai.amberx.axf.kernel.asset.AssetSource
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.asset.Button
import ai.amberx.axf.kernel.asset.ColorTheme
import ai.amberx.axf.kernel.asset.Container
import ai.amberx.axf.kernel.asset.ContextMenu
import ai.amberx.axf.kernel.asset.Dialog
import ai.amberx.axf.kernel.asset.Layout
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.asset.NavMenu
import ai.amberx.axf.kernel.asset.Popup
import ai.amberx.axf.kernel.asset.RegisterResult
import ai.amberx.axf.kernel.asset.Slider
import ai.amberx.axf.kernel.asset.StyleTheme
import ai.amberx.axf.kernel.asset.Toolbar
import ai.amberx.axf.kernel.asset.UacPolicy
import ai.amberx.axf.kernel.engine.ActionBus
import ai.amberx.axf.kernel.engine.ActionContext
import ai.amberx.axf.kernel.engine.ActionHandler
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.engine.CompiledLayout
import ai.amberx.axf.kernel.engine.ComponentStyleEngine
import ai.amberx.axf.kernel.engine.ComponentStyles
import ai.amberx.axf.kernel.engine.ContextMenuEngine
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.kernel.engine.LayoutEngine
import ai.amberx.axf.kernel.engine.StandardActions
import ai.amberx.axf.kernel.engine.ThemeEngine
import ai.amberx.axf.kernel.engine.ThemeTokens
import ai.amberx.axf.kernel.engine.UacEngine
import ai.amberx.axf.kernel.engine.WindowClass
import ai.amberx.axf.kernel.event.EventBus
import ai.amberx.axf.kernel.event.KernelEvent
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.platform.AxfClock
import ai.amberx.axf.kernel.platform.KeyValueStore
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.platform.SystemClock
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonObject
import kotlin.random.Random

/** Everything compiled from the active assets. Recomputed on swap; UI layers read only this. */
public data class Compiled(
    val theme: ThemeTokens,
    val layout: Layout,
    val layouts: Map<WindowClass, CompiledLayout>,
    val styles: ComponentStyles,
    val appMenu: AppMenu, val toolbar: Toolbar, val navMenu: NavMenu, val contextMenu: ContextMenu, val policy: UacPolicy,
    val popup: Popup, val dialog: Dialog,
    val rev: Long,
) {
    public fun layoutFor(widthDp: Int): CompiledLayout = layouts.getValue(LayoutEngine.windowClass(widthDp, layout))
}

/**
 * AxfRuntime — the single source of truth for an AXF app. Holds the asset registry, the active asset
 * per slot, the UAC role, the current view, overlays, and compiles everything through the engines.
 * Framework-agnostic: axf-ui only subscribes to [state] and [compiled]. Mirrors runtime.ts one to one.
 */
public class AxfRuntime(
    public val manifest: AxfManifest,
    public val registry: AssetRegistry,
    public val events: EventBus = EventBus(),
    private val store: KeyValueStore = MemoryKeyValueStore(),
    private val clock: AxfClock = SystemClock,
    private val random: Random = Random.Default,
    storageKey: String? = null,
) {
    private val key = storageKey ?: "axf:${manifest.appId}"
    public val loadErrors: MutableList<Pair<String, List<String>>> = mutableListOf()
    public val actions: ActionBus = ActionBus(can = { can(it) }, onMissing = { toast("No handler is registered for \"$it\".", ToastKind.WARNING, "Unknown action") }, onDenied = { toast("Your role can't run \"${it.label}\".", ToastKind.DANGER, "Permission denied") })

    private val _state: MutableStateFlow<AxfState>
    public val state: StateFlow<AxfState> get() = _state.asStateFlow()
    private val _compiled: MutableStateFlow<Compiled>
    public val compiled: StateFlow<Compiled> get() = _compiled.asStateFlow()
    /** The output terminal every install / import / hot-swap writes to (see [OutputTerminal]). */
    public val terminal: OutputTerminal = OutputTerminal()
    private var toastSeq = 0L

    init {
        val saved = Persisted.fromJson(store.get(key))
        val active = LinkedHashMap<String, String>()
        for (t in registry.types.ids()) {
            val spec = registry.types.get(t)!!
            val pick = listOf(saved?.active?.get(t), manifest.defaults[t], registry.list(t).firstOrNull()?.id).firstOrNull { it != null && registry.has(t, it) }
            if (pick == null) { if (!spec.optional) throw IllegalStateException("AmberX AXF: no \"$t\" asset is available — every core slot needs at least one asset.") }
            else active[t] = pick
        }
        val policy = UacPolicy.fromJson(registry.get(AssetTypes.UAC_POLICY, active.getValue(AssetTypes.UAC_POLICY))!!.data)
        val role = saved?.role?.takeIf { r -> policy.roles.any { it.id == r } } ?: policy.defaultRole
        _state = MutableStateFlow(AxfState(active, role, manifest.startView))
        _compiled = MutableStateFlow(compile(_state.value))
        registerBuiltinActions()
    }

    /* ---------------- store ---------------- */

    private fun set(patch: (AxfState) -> AxfState, persist: Boolean = false, recompile: Boolean = false) {
        _state.update { s -> patch(s).copy(rev = s.rev + 1) }
        if (recompile) _compiled.value = compile(_state.value)
        if (persist) store.put(key, Persisted(_state.value.active, _state.value.role).toJson())
    }

    public val current: AxfState get() = _state.value

    /* ---------------- assets ---------------- */

    public fun asset(type: String): AssetEnvelope? = current.active[type]?.let { registry.get(type, it) }
    public fun requireAsset(type: String): AssetEnvelope = asset(type) ?: throw IllegalStateException("No active $type")
    public inline fun <T> decode(type: String, decoder: (JsonObject) -> T): T = decoder(requireAsset(type).data)

    /** Hot-swap the active asset of a slot. `target` = asset id | "next" | "prev" | "random". */
    public fun swap(type: String, target: String): Boolean {
        val spec = registry.types.get(type) ?: run { toast("Unknown asset type \"$type\".", ToastKind.WARNING); return false }
        val need = if (type == AssetTypes.UAC_POLICY) "uac.manage" else "assets.swap"
        if (!can(need)) { toast("Your role needs \"$need\" to change the ${spec.label.lowercase()}.", ToastKind.DANGER, "Permission denied"); return false }
        val list = registry.list(type)
        val cur = current.active[type]
        val idx = list.indexOfFirst { it.id == cur }
        val next: String? = when (target) {
            "next" -> list.getOrNull((idx + 1).mod(list.size.coerceAtLeast(1)))?.id
            "prev" -> list.getOrNull((idx - 1 + list.size).mod(list.size.coerceAtLeast(1)))?.id
            "random" -> list.filter { it.id != cur }.randomOrNull(random)?.id ?: list.firstOrNull()?.id
            else -> target
        }
        if (next == null || !registry.has(type, next)) { terminal.error("hot-swap", "$type → \"$target\": no such asset"); toast("No $type asset with id \"$target\".", ToastKind.WARNING, "Swap failed"); return false }
        if (next == cur) return true
        var roleNote: String? = null
        set({ s ->
            var role = s.role
            if (type == AssetTypes.UAC_POLICY) {
                val policy = UacPolicy.fromJson(registry.get(type, next)!!.data)
                if (policy.roles.none { it.id == role }) { role = policy.defaultRole; roleNote = policy.role(role)?.label }
            }
            s.copy(active = s.active + (type to next), swaps = s.swaps + 1, role = role)
        }, persist = true, recompile = true)
        events.emit(KernelEvent.AssetSwapped(type, cur, next))
        terminal.ok("hot-swap", "$type: ${cur ?: "(none)"} → $next")
        if (type == AssetTypes.UI_KIT) terminal.forget("kit:")
        roleNote?.let { toast("This policy has no \"$cur\" role, so you're now $it.", ToastKind.INFO, "Role changed") }
        return true
    }

    public fun swapAll(targets: Map<String, String>) {
        set({ s -> s.copy(active = s.active + targets.filter { (t, id) -> t != AssetTypes.UAC_POLICY && registry.has(t, id) }, swaps = s.swaps + 1) }, persist = true, recompile = true)
    }

    public fun randomize() {
        if (!can("assets.swap")) { toast("Your role cannot swap assets.", ToastKind.DANGER, "Permission denied"); return }
        swapAll(registry.types.ids().mapNotNull { t -> registry.list(t).randomOrNull(random)?.let { t to it.id } }.toMap())
    }

    public fun reset() {
        val active = LinkedHashMap<String, String>()
        for (t in registry.types.ids()) { val d = manifest.defaults[t]; val id = if (d != null && registry.has(t, d)) d else registry.list(t).firstOrNull()?.id; if (id != null) active[t] = id }
        val policy = UacPolicy.fromJson(registry.get(AssetTypes.UAC_POLICY, active.getValue(AssetTypes.UAC_POLICY))!!.data)
        set({ s -> s.copy(active = active, role = policy.defaultRole, swaps = s.swaps + 1) }, persist = true, recompile = true)
    }

    public fun importAsset(raw: JsonObject, activate: Boolean = true): RegisterResult {
        if (!can("assets.import")) return RegisterResult(false, listOf("Your role needs \"assets.import\" to import assets."))
        val r = registry.register(raw, AssetSource.IMPORTED)
        r.asset?.let { a ->
            events.emit(KernelEvent.AssetImported(a.type, a.id))
            if (activate && can("assets.swap")) swap(a.type, a.id) else set({ it })
        }
        return r
    }
    public fun importAsset(text: String, activate: Boolean = true): RegisterResult = ai.amberx.axf.kernel.asset.AssetEnvelope.parse(text)?.let { importAsset(it.toJson(), activate) } ?: RegisterResult(false, listOf("Invalid JSON"))
    public fun exportAsset(type: String, id: String): String = registry.get(type, id)?.serialize() ?: ""

    /* ---------------- UAC ---------------- */

    public val policy: UacPolicy get() = _compiled.value.policy
    public fun permissions(): Set<String> = UacEngine.resolvePermissions(policy, current.role)
    public fun can(perm: String?): Boolean = UacEngine.hasPermission(permissions(), perm)
    public fun gate(requires: String?): Gate = UacEngine.gateFor(policy, permissions(), requires)
    public fun setRole(id: String) {
        val p = policy; val role = p.role(id) ?: return
        val from = current.role
        set({ it.copy(role = id) }, persist = true)
        events.emit(KernelEvent.RoleChanged(from, id))
        toast("Now acting as ${role.label}.", ToastKind.INFO, "Role switched")
    }

    /* ---------------- views & overlays ---------------- */

    public fun navigate(view: String) { val from = current.view; set({ it.copy(view = view, context = null) }); events.emit(KernelEvent.Navigated(from, view)) }
    public fun openDialog(id: String, props: Map<String, String> = emptyMap()): Unit = set({ it.copy(dialog = DialogState(id, props), context = null) })
    public fun closeDialog(): Unit = set({ it.copy(dialog = null) })

    public fun toast(message: String, kind: ToastKind = ToastKind.INFO, title: String? = null): Toast {
        val popup = _compiled.value.popup
        val t = Toast(++toastSeq, kind, title, message, clock.nowMillis())
        set({ s -> s.copy(toasts = (s.toasts + t).takeLast(popup.maxVisible.coerceAtLeast(1))) })
        events.emit(KernelEvent.Toast(message, kind.name.lowercase(), title))
        return t
    }
    /** The UI layer calls this after `popup.duration` ms (the kernel has no timers of its own). */
    public fun dismissToast(id: Long) { if (current.toasts.any { it.id == id }) set({ s -> s.copy(toasts = s.toasts.filter { it.id != id }) }) }

    public fun openContext(x: Float, y: Float, target: String, payload: String? = null): Unit = set({ it.copy(context = ContextState(x, y, target, payload)) })
    public fun closeContext() { if (current.context != null) set({ it.copy(context = null) }) }
    /** Extra context-menu targets registered by modules (tab-group, window-title, …), merged ahead of the asset's items. */
    public val contextExtras: MutableMap<String, List<MenuItem>> = LinkedHashMap()
    public fun contextItems(target: String, payload: String?): List<MenuItem> {
        val extra = contextExtras[target]
        val base = ContextMenuEngine.itemsFor(_compiled.value.contextMenu, target, payload) { gate(it) }
        if (extra == null) return base
        val menu = _compiled.value.contextMenu.copy(targets = mapOf(target to extra))
        val ex = ContextMenuEngine.itemsFor(menu, target, payload) { gate(it) }
        return if (_compiled.value.contextMenu.targets.containsKey(target)) ex + MenuItem("x-sep", separator = true) + base else ex
    }
    public fun filterMenu(items: List<MenuItem>): List<MenuItem> = UacEngine.filterMenu(items) { gate(it) }

    public fun setWindowWidth(dp: Int) { if (dp != current.windowWidthDp) set({ it.copy(windowWidthDp = dp) }) }

    public fun dispatch(spec: String, payload: String? = null, extras: Map<String, Any?> = emptyMap()): AxfResult<Unit> {
        val r = actions.dispatch(spec, ActionContext(payload, extras))
        events.emit(KernelEvent.ActionDispatched(spec, r.isOk))
        return r
    }
    public fun register(id: String, meta: ActionMeta, fn: ActionHandler): () -> Unit = actions.register(id, meta, fn)

    /* ---------------- rendering ---------------- */

    private fun compile(s: AxfState): Compiled {
        fun d(t: String) = registry.get(t, s.active.getValue(t))!!.data
        val color = ColorTheme.fromJson(d(AssetTypes.COLOR_THEME)); val style = StyleTheme.fromJson(d(AssetTypes.STYLE_THEME))
        val theme = ThemeEngine.compile(color, style)
        val layout = Layout.fromJson(d(AssetTypes.LAYOUT))
        val styles = ComponentStyleEngine.compile(Button.fromJson(d(AssetTypes.BUTTON)), Slider.fromJson(d(AssetTypes.SLIDER)), Container.fromJson(d(AssetTypes.CONTAINER)), Dialog.fromJson(d(AssetTypes.DIALOG)), Popup.fromJson(d(AssetTypes.POPUP)), ContextMenu.fromJson(d(AssetTypes.CONTEXT_MENU)), theme.style,
            Toolbar.fromJson(d(AssetTypes.TOOLBAR)), NavMenu.fromJson(d(AssetTypes.NAV_MENU)), AppMenu.fromJson(d(AssetTypes.APP_MENU)))
        return Compiled(theme, layout, WindowClass.entries.associateWith { LayoutEngine.compile(layout, it) }, styles,
            AppMenu.fromJson(d(AssetTypes.APP_MENU)), Toolbar.fromJson(d(AssetTypes.TOOLBAR)), NavMenu.fromJson(d(AssetTypes.NAV_MENU)), ContextMenu.fromJson(d(AssetTypes.CONTEXT_MENU)), UacPolicy.fromJson(d(AssetTypes.UAC_POLICY)),
            Popup.fromJson(d(AssetTypes.POPUP)), Dialog.fromJson(d(AssetTypes.DIALOG)), s.rev)
    }

    /** Force recompilation (after a module registers a new asset source, for example). */
    public fun recompile(): Unit = set({ it }, recompile = true)

    /* ---------------- built-in actions ---------------- */

    private fun registerBuiltinActions() {
        for ((id, meta) in StandardActions.ALL) actions.register(id, meta.copy(stub = true)) { _, _ -> toast("${meta.label} has no handler in this app yet.", ToastKind.INFO, meta.label) }
        actions.register("swap", ActionMeta("Swap asset")) { a, _ -> val t = a.getOrNull(0); if (t != null && registry.types.has(t)) swap(t, a.getOrElse(1) { "next" }) else toast("Unknown asset type \"$t\".", ToastKind.WARNING) }
        actions.register("nav", ActionMeta("Navigate")) { a, _ -> a.getOrNull(0)?.let(::navigate) }
        actions.register("dialog", ActionMeta("Open dialog")) { a, _ -> a.getOrNull(0)?.let { openDialog(it, if (a.size > 1) mapOf("arg" to a.drop(1).joinToString(":")) else emptyMap()) } }
        actions.register("toast", ActionMeta("Show toast")) { a, _ -> toast(a.drop(1).joinToString(":").ifEmpty { "Hello from AmberX AXF" }, ToastKind.entries.firstOrNull { it.name.equals(a.getOrNull(0), true) } ?: ToastKind.INFO) }
        actions.register("role", ActionMeta("Switch role")) { a, _ -> a.getOrNull(0)?.let(::setRole) }
        actions.register("assets.random", ActionMeta("Randomize assets", "assets.swap")) { _, _ -> randomize() }
        actions.register("assets.reset", ActionMeta("Reset to defaults")) { _, _ -> reset() }
        actions.register("asset.json", ActionMeta("View asset JSON")) { a, _ -> openDialog("asset-json", mapOf("type" to a.getOrElse(0) { "" }, "id" to a.getOrElse(1) { "" })) }
        actions.register("asset.copy", ActionMeta("Copy asset JSON")) { a, ctx -> val json = if (a.size >= 2) exportAsset(a[0], a[1]) else ""; (ctx.extras["clipboard"] as? (String) -> Unit)?.invoke(json) ?: toast("Clipboard is not available here.", ToastKind.WARNING) }
        actions.register("noop", ActionMeta("Nothing")) { _, _ -> }
    }

    public companion object {
        public const val VERSION: String = AxfVersion.FRAMEWORK
    }
}
