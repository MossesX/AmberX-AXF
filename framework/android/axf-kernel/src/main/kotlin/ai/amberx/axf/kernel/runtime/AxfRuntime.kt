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
import ai.amberx.axf.kernel.engine.WidgetEngine
import ai.amberx.axf.kernel.engine.HideEngine
import ai.amberx.axf.kernel.engine.Spacing
import ai.amberx.axf.kernel.engine.AppearanceChange
import ai.amberx.axf.kernel.engine.AppearanceDocument
import ai.amberx.axf.kernel.engine.AppearanceEngine
import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.kernel.engine.BannerAttachment
import ai.amberx.axf.kernel.engine.BannerData
import ai.amberx.axf.kernel.engine.BannerEngine
import ai.amberx.axf.kernel.engine.PlacedAttachment
import ai.amberx.axf.kernel.engine.RollEngine
import ai.amberx.axf.kernel.engine.RollRules
import ai.amberx.axf.kernel.engine.SearchEntry
import ai.amberx.axf.kernel.engine.SearchIndex
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
 * Where a developer app's appearance selection lives: the axHub data server (`shared/settings/appearance.json`,
 * AppearanceEngine). Off by default: an ordinary AXF app never attaches one. Mirrors runtime.ts `AppearanceSource`.
 * While the source isn't [AppearanceSourceState.Ready] the app shows its waiting screen: a developer app doesn't run
 * without the hub (no local fallback, no default theme). Android implementation: lib-hub `HubAppearanceSource`.
 */
public interface AppearanceSource {
    public fun state(): AppearanceSourceState
    /** Emits the document (null = none saved yet) whenever it loads or changes, and the state on every change. */
    public fun subscribe(listener: (AppearanceEvent) -> Unit): () -> Unit
    public fun start()
    public fun stop()
    /** Re-read now (UI-editor rule: fresh on resume). */
    public fun refresh()
    /** Save this app's keys; the source merges into the latest document (last write wins per key). */
    public fun save(change: AppearanceChange)
    /** The hub's origin, for the waiting screen. */
    public val origin: String? get() = null
}

public sealed interface AppearanceEvent {
    public data class Document(val doc: AppearanceDocument?, val version: String?) : AppearanceEvent
    public data class State(val state: AppearanceSourceState) : AppearanceEvent
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
    /** Search index (SearchEngine) the toolbar's live search reads; the UI layer adds views, settings, dialogs, page text. */
    public val search: SearchIndex = SearchIndex { gate(it) }
    /** Conflicts (two modules, same asset id) and crashes, as on the web port (alerts/AlertEngine.kt turns them into alerts). */
    public val diagnostics: ai.amberx.axf.kernel.alerts.Diagnostics = ai.amberx.axf.kernel.alerts.Diagnostics()
    private val _badges = MutableStateFlow<Map<String, Int>>(emptyMap())
    /** Named counters toolbar items show as badges (`badge` on a toolbar item), e.g. `alerts.unread`. */
    public val badges: StateFlow<Map<String, Int>> get() = _badges.asStateFlow()
    public fun badge(name: String): Int = _badges.value[name] ?: 0
    public fun setBadge(name: String, count: Int) {
        val n = count.coerceAtLeast(0)
        if ((_badges.value[name] ?: 0) == n) return
        _badges.value = _badges.value + (name to n)
    }
    private var toastSeq = 0L

    init {
        val saved = Persisted.fromJson(store.get(key))
        val active = LinkedHashMap<String, String>()
        for (t in registry.types.ids()) {
            val spec = registry.types.get(t)!!
            // A changed app default (manifest default ≠ the one saved with the choices) wins once, as on the web port.
            val appChanged = saved?.defaults != null && saved.defaults[t] != manifest.defaults[t]
            val pick = listOf(if (appChanged) null else saved?.active?.get(t), manifest.defaults[t], registry.list(t).firstOrNull()?.id).firstOrNull { it != null && registry.has(t, it) }
            if (pick == null) { if (!spec.optional) throw IllegalStateException("AmberX AXF: no \"$t\" asset is available — every core slot needs at least one asset.") }
            else active[t] = pick
        }
        val policy = UacPolicy.fromJson(registry.get(AssetTypes.UAC_POLICY, active.getValue(AssetTypes.UAC_POLICY))!!.data)
        val role = saved?.role?.takeIf { r -> policy.roles.any { it.id == r } } ?: policy.defaultRole
        _state = MutableStateFlow(AxfState(active, role, manifest.startView))
        _compiled = MutableStateFlow(compile(_state.value))
        // asset ids registered twice by different modules: those from before the runtime existed, then live ones
        for (r in registry.replacements) diagnostics.report(ai.amberx.axf.kernel.alerts.Diagnostic.AssetConflict(r.type, r.id, r.was, r.now))
        registry.onReplace = { r -> diagnostics.report(ai.amberx.axf.kernel.alerts.Diagnostic.AssetConflict(r.type, r.id, r.was, r.now)) }
        registerBuiltinActions()
        search.add("axf.actions") {
            actions.list().filter { (_, m) -> !m.stub && !m.params && m.searchable }.map { (id, m) ->
                SearchEntry("action:$id", "action", m.label, detail = id, icon = "zap", requires = m.requires, focus = mapOf("kind" to "action", "spec" to id))
            }
        }
        search.add("axf.assets") {
            registry.types.ids().flatMap { t -> registry.list(t).map { a ->
                SearchEntry("asset:$t:${a.id}", "asset", a.name, detail = t, icon = "palette", keywords = listOfNotNull(a.id, a.description) + a.tags, focus = mapOf("kind" to "asset", "type" to t, "id" to a.id))
            } }
        }
    }

    /* ---------------- store ---------------- */

    private fun set(patch: (AxfState) -> AxfState, persist: Boolean = false, recompile: Boolean = false) {
        _state.update { s -> patch(s).copy(rev = s.rev + 1) }
        if (recompile) _compiled.value = compile(_state.value)
        if (persist) store.put(key, Persisted(_state.value.active, _state.value.role, manifest.defaults).toJson())
    }

    /**
     * Load the saved hot-swap choices again (another window or editor may have saved since; last save wins), as on the
     * web port (`refreshFromSaved`). UI-editing modules (theme, style, layout, manager, builder) call it whenever they
     * open, load or come back into focus. Returns the slots that changed (plus "role" when the role did).
     */
    public fun refreshFromSaved(): List<String> {
        appearanceSource?.refresh() // developer apps: the saved values live on the hub
        val saved = Persisted.fromJson(store.get(key)) ?: return emptyList()
        val now = _state.value
        val changed = saved.active.filter { (t, id) -> t != AssetTypes.UAC_POLICY && now.active[t] != id && registry.has(t, id) }
        val policy = UacPolicy.fromJson(registry.get(AssetTypes.UAC_POLICY, now.active.getValue(AssetTypes.UAC_POLICY))!!.data)
        val role = saved.role?.takeIf { r -> principal == null && r != now.role && policy.roles.any { it.id == r } }
        if (changed.isEmpty() && role == null) return emptyList()
        set({ s -> s.copy(active = s.active + changed, role = role ?: s.role, swaps = s.swaps + if (changed.isEmpty()) 0 else 1) }, recompile = changed.isNotEmpty())
        return changed.keys.toList() + listOfNotNull(role?.let { "role" })
    }

    public val current: AxfState get() = _state.value

    /* ---------------- assets ---------------- */

    public fun asset(type: String): AssetEnvelope? = current.active[type]?.let { registry.get(type, it) }
    public fun requireAsset(type: String): AssetEnvelope = asset(type) ?: throw IllegalStateException("No active $type")
    public inline fun <T> decode(type: String, decoder: (JsonObject) -> T): T = decoder(requireAsset(type).data)

    /** Hot-swap the active asset of a slot. `target` = asset id | "next" | "prev" | "random". */
    /* ---------------- signed-in account (web: runtime.bindPrincipal) ---------------- */

    /** A signed-in account bound to the runtime: its policy + role replace the role switcher. */
    public data class BoundPrincipal(val id: String, val label: String, val policy: String, val role: String, val attributes: Map<String, String> = emptyMap())

    private var principal: BoundPrincipal? = null

    /** The app signed someone in. While bound, setRole and uac-policy swaps are refused; unbindPrincipal on sign-out. */
    public fun bindPrincipal(p: BoundPrincipal): Boolean {
        val asset = registry.get(AssetTypes.UAC_POLICY, p.policy) ?: return false
        if (UacPolicy.fromJson(asset.data).role(p.role) == null) return false
        principal = p
        set({ s -> s.copy(active = s.active + (AssetTypes.UAC_POLICY to p.policy), role = p.role) }, recompile = true)
        terminal.ok("uac", "signed in as ${p.label} (${p.role})")
        return true
    }

    public fun unbindPrincipal() { if (principal != null) { principal = null; set({ it }) } }

    public fun boundPrincipal(): BoundPrincipal? = principal

    public fun swap(type: String, target: String): Boolean {
        if (type == AssetTypes.UAC_POLICY && principal != null) { toast("Your access comes from your account. An admin changes it in Account management.", ToastKind.INFO, "Access"); return false }
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
        if (type != AssetTypes.UAC_POLICY) pushAppearance(AppearanceChange(slots = mapOf(type to next), palette = if (type == AssetTypes.COLOR_THEME) appearancePalette() else null))
        return true
    }

    public fun swapAll(targets: Map<String, String>) {
        val pushed = targets.filter { (t, id) -> t != AssetTypes.UAC_POLICY && registry.has(t, id) }
        set({ s -> s.copy(active = s.active + pushed, swaps = s.swaps + 1) }, persist = true, recompile = true)
        if (pushed.isNotEmpty()) pushAppearance(AppearanceChange(slots = pushed, palette = if (AssetTypes.COLOR_THEME in pushed) appearancePalette() else null))
    }

    /* ---------------- appearance source (AppearanceEngine; web: attachAppearanceSource) ---------------- */

    private var appearanceSource: AppearanceSource? = null
    private var appearanceOff: (() -> Unit)? = null
    private var applyingAppearance = false
    private var lastAppearance: AppearanceDocument? = null
    private val _appearance = MutableStateFlow<AppearanceSourceState?>(null)
    /** The source's state; null = no source (an ordinary app). UI: show the waiting screen unless Ready. */
    public val appearance: StateFlow<AppearanceSourceState?> get() = _appearance.asStateFlow()

    /** Make this a developer app: its appearance comes from the source and goes back to it. */
    public fun attachAppearanceSource(source: AppearanceSource) {
        detachAppearanceSource()
        appearanceSource = source
        appearanceOff = source.subscribe { ev ->
            when (ev) {
                is AppearanceEvent.State -> _appearance.value = ev.state
                is AppearanceEvent.Document -> applyAppearance(ev.doc)
            }
        }
        _appearance.value = source.state()
        source.start()
    }

    public fun detachAppearanceSource() {
        appearanceOff?.invoke(); appearanceOff = null
        appearanceSource?.stop(); appearanceSource = null
        lastAppearance = null
        _appearance.value = null
    }

    public fun hasAppearanceSource(): Boolean = appearanceSource != null
    public fun appearanceReady(): Boolean = appearanceSource == null || _appearance.value is AppearanceSourceState.Ready
    public fun appearanceHub(): String? = appearanceSource?.origin
    public fun appearanceSkipped(): List<String> = AppearanceEngine.resolve(lastAppearance, registry.types) { t, id -> registry.has(t, id) }.skipped

    /**
     * Apply a document: every appearance slot starts from the app's own default, then takes the document's id when
     * the app has that asset (unknown = the default, never a crash); spacing and hidden go through the same stores
     * the UI uses. No permission check: the document *is* the saved setting; changing it is gated (swap, setSpacing…).
     */
    private fun applyAppearance(doc: AppearanceDocument?) {
        lastAppearance = doc
        val r = AppearanceEngine.resolve(doc, registry.types) { t, id -> registry.has(t, id) }
        applyingAppearance = true
        try {
            val active = LinkedHashMap(current.active)
            for (t in registry.types.ids()) {
                if (t == AssetTypes.UAC_POLICY) continue
                val want = r.slots[t] ?: manifest.defaults[t]
                if (want != null && registry.has(t, want)) active[t] = want
                else if (want == null && registry.types.get(t)?.optional == true) active.remove(t)
            }
            val hidden = LinkedHashMap<String, Boolean>()
            for (t in HideEngine.hideableTypes(registry.types)) r.hidden[t]?.let { hidden[t] = it }
            if (hidden.isEmpty()) store.remove(hideKey) else store.put(hideKey, JsonObject(hidden.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) }).toString())
            val sp = r.spacing ?: Spacing.DEFAULT
            if (spacing() != sp) store.put(spacingKey, sp.id)
            val changed = active != current.active
            set({ s -> s.copy(active = active, swaps = s.swaps + if (changed) 1 else 0) }, persist = true, recompile = true)
            if (r.skipped.isNotEmpty()) terminal.warn("appearance", "not in this app, kept the default: ${r.skipped.joinToString()}")
            terminal.ok("appearance", "applied from the hub" + (doc?.updatedBy?.let { " (saved by $it)" } ?: ""))
        } finally { applyingAppearance = false }
    }

    private fun pushAppearance(change: AppearanceChange) {
        val src = appearanceSource ?: return
        if (applyingAppearance) return
        src.save(change)
    }

    private fun appearancePalette(): Map<String, String> = AppearanceEngine.paletteFromColorTheme(asset(AssetTypes.COLOR_THEME)?.data)

    /** The document this app would write for its whole current look. */
    public fun currentAppearance(): AppearanceDocument {
        val slots = current.active.filterKeys { it != AssetTypes.UAC_POLICY }
        return AppearanceEngine.merge(null, AppearanceChange(slots = slots, spacing = spacing(), hidden = hideOverrides(), palette = appearancePalette()), manifest.appId, java.time.Instant.ofEpochMilli(clock.nowMillis()).toString())
    }

    /* ---------------- randomize rolls (RollEngine) ---------------- */

    private val rollKey get() = "$key:roll"

    /** Runtime roll overrides, persisted next to the hot-swap choices (web port: settings `axf.roll.*`). */
    public fun rollRules(): RollRules {
        val o = store.get(rollKey)?.let { ai.amberx.axf.kernel.asset.AxfJson.runCatching { parseToJsonElement(it) as JsonObject }.getOrNull() } ?: return RollRules()
        fun bools(k: String) = (o[k] as? JsonObject)?.mapNotNull { (id, v) -> (v as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBooleanStrictOrNull()?.let { id to it } }?.toMap() ?: emptyMap()
        return RollRules(bools("slots"), bools("assets"))
    }

    private fun saveRollRules(r: RollRules) {
        store.put(rollKey, kotlinx.serialization.json.buildJsonObject {
            put("slots", JsonObject(r.slots.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) }))
            put("assets", JsonObject(r.assets.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) }))
        }.toString())
        set({ it })
    }

    public fun rollSlotIncluded(type: String): Boolean = RollEngine.slotIncluded(registry.types, type, rollRules())
    /** Include or exclude a slot from rolls; null = built-in default. */
    public fun setRollSlot(type: String, on: Boolean?) {
        if (RollEngine.never(registry.types, type)) return
        val r = rollRules()
        saveRollRules(r.copy(slots = if (on == null) r.slots - type else r.slots + (type to on)))
    }
    public fun rollAssetIncluded(type: String, id: String): Boolean = registry.get(type, id)?.let { RollEngine.assetIncluded(registry.types, it, rollRules()) } ?: false
    /** Include or exclude one asset from rolls; null = the asset's own flag. */
    public fun setRollAsset(type: String, id: String, on: Boolean?) {
        val r = rollRules(); val k = RollEngine.assetKey(type, id)
        saveRollRules(r.copy(assets = if (on == null) r.assets - k else r.assets + (k to on)))
    }

    /* ---------------- hidden slots (HideEngine; web: settings `axf.hide.<type>`) ---------------- */

    /**
     * Bring a search entry into focus (web: SearchIndex.focus): the UI focuser goes first; the runtime fallback handles the
     * basic kinds (navigate / dispatch / open / swap). Returns whether anything happened.
     */
    public fun focusSearch(entry: SearchEntry): Boolean {
        if (search.focusWithUi(entry) == true) return true
        val f = entry.focus
        return when (f["kind"]) {
            "view", "text" -> { val v = f["view"] ?: return false; navigate(v); true }
            "action" -> f["spec"]?.let { dispatch(it).isOk } ?: false
            "setting" -> { navigate("settings"); f["tab"]?.let { dispatch("settings.open:$it") }; true }
            "dialog" -> { val id = f["id"] ?: return false; openDialog(id); true }
            "asset" -> { val t = f["type"]; val id = f["id"]; t != null && id != null && swap(t, id) }
            "window" -> { val id = f["id"] ?: return false; dispatch("windows.restore:$id").isOk }
            else -> false
        }
    }

    /* ---------------- widget hosts (WidgetEngine; web: rt.attachToHost / attachToBanner / attachToToolbar) ---------------- */

    /** Run-time attachments per host (`banner`, `toolbar`, any host a library registers). */
    private val hostExtra = LinkedHashMap<String, List<BannerAttachment>>()

    /** The active asset of an optional type (banner, clock, badge), or null when the app has none. */
    public fun assetOrNull(type: String): ai.amberx.axf.kernel.asset.AssetEnvelope? = asset(type)

    /**
     * Attach an asset to a widget host at run time. The entry is checked against the host's spec (type, side, asset
     * exists) so a bad call is reported in the terminal instead of silently vanishing; same type + id replaces the
     * earlier one. Returns a detach function.
     */
    public fun attachToHost(host: String, a: BannerAttachment): () -> Unit {
        val spec = WidgetEngine.hostSpec(host)
        val who = a.origin ?: "runtime"
        when {
            spec == null -> terminal.warn("widgets", "\"$host\" is not a widget host (${WidgetEngine.hostSpecs().joinToString { it.host }}); ${a.key} from $who will not show")
            a.type !in spec.types -> terminal.warn("widgets", "$host doesn't take ${a.type} assets (${spec.types.joinToString()}); ${a.key} from $who will not show")
            a.at !in spec.sides -> terminal.warn("widgets", "$host has no \"${a.at}\" side (${spec.sides.joinToString()}); ${a.key} from $who will not show")
            !registry.has(a.type, a.id) -> terminal.warn("widgets", "${a.key} (attached to $host by $who) is not registered; it shows once it is")
        }
        hostExtra[host] = (hostExtra[host] ?: emptyList()).filter { it.key != a.key } + a
        set({ it })
        return { detachFromHost(host, a.key) }
    }

    /** Remove run-time attachments from one host by key (`type:id`) or by origin (a module / plugin id). */
    public fun detachFromHost(host: String, keyOrOrigin: String) {
        val list = hostExtra[host] ?: return
        val next = list.filter { it.key != keyOrOrigin && it.origin != keyOrOrigin }
        if (next.size != list.size) { hostExtra[host] = next; set({ it }) }
    }

    /** Remove everything a module attached to any host (call it when a module is disabled). */
    public fun detachAll(origin: String) {
        var changed = false
        for ((host, list) in hostExtra.entries.toList()) {
            val next = list.filter { it.origin != origin }
            if (next.size != list.size) { hostExtra[host] = next; changed = true }
        }
        if (changed) set({ it })
    }

    /** Run-time attachments of a host. */
    public fun hostAttachments(host: String): List<BannerAttachment> = hostExtra[host] ?: emptyList()

    /** Attach an asset (badge, clock, search bar) to the banner at run time; same type + id replaces the earlier one. Returns detach. */
    public fun attachToBanner(a: BannerAttachment): () -> Unit = attachToHost(BannerEngine.HOST, a)

    /** Remove run-time banner attachments by key (`type:id`) or by origin (a module / plugin id). */
    public fun detachFromBanner(keyOrOrigin: String): Unit = detachFromHost(BannerEngine.HOST, keyOrOrigin)

    /** The banner to draw: its data (null = no banner or hidden), its height and where every attachment goes. */
    public fun banner(): Triple<BannerData?, Int, Map<String, List<PlacedAttachment>>> {
        val b = if (slotHidden(AssetTypes.BANNER)) null else assetOrNull(AssetTypes.BANNER)?.let { BannerData.fromJson(it.data) }
        return Triple(b, BannerEngine.height(b), BannerEngine.place(b, if (b != null) hostAttachments(BannerEngine.HOST) else emptyList()) { t, id -> registry.has(t, id) })
    }

    /** Pop a short message out of a banner attachment; the UI layer calls [dismissBannerPopup] after its duration. */
    public fun showBannerPopup(key: String, text: String, durationMs: Long = 5000): Unit = set({ it.copy(bannerPopup = BannerPopup(key, text, durationMs)) })
    public fun dismissBannerPopup() { if (current.bannerPopup != null) set({ it.copy(bannerPopup = null) }) }

    /** Attach a widget (clock, search bar) to the toolbar's start or end at run time; same type + id replaces. Returns detach. */
    public fun attachToToolbar(a: BannerAttachment): () -> Unit = attachToHost("toolbar", a)

    /** Remove run-time toolbar widgets by key (`type:id`) or by origin (a module / plugin id). */
    public fun detachFromToolbar(keyOrOrigin: String): Unit = detachFromHost("toolbar", keyOrOrigin)

    /** Where the toolbar's widgets go (start / end); empty when there's no toolbar or it's hidden. */
    public fun toolbarWidgets(): Map<String, List<PlacedAttachment>> {
        val tb = if (slotHidden("toolbar")) null else asset("toolbar")?.data
        return WidgetEngine.placeToolbar(tb, hostAttachments("toolbar")) { t, id -> registry.has(t, id) }
    }

    /* ---------------- spacing (SpacingEngine; web: settings `axf.appearance.spacing`) ---------------- */

    private val spacingKey get() = "$key:spacing"

    /** The user's Spacing choice: TIGHT (default), COMPACT or REGULAR. */
    public fun spacing(): Spacing = Spacing.of(store.get(spacingKey))

    /** Change the Spacing choice; it applies at once to every theme (styles recompile). */
    public fun setSpacing(s: Spacing) {
        if (spacing() == s) return
        store.put(spacingKey, s.id)
        terminal.ok("hot-swap", "spacing: ${s.id}")
        set({ it }, recompile = true)
        pushAppearance(AppearanceChange(spacing = s))
    }

    /* ---------------- collapsible toolbar (asset `collapsible: true`; web setting axf.toolbar.collapsed) ---------------- */
    private val toolbarCollapsedKey get() = "$key:toolbar-collapsed"

    /** Is a collapsible toolbar folded to its handle on this device? */
    public fun toolbarCollapsed(): Boolean = compiled.value.toolbar.collapsible && store.get(toolbarCollapsedKey) == "1"

    public fun setToolbarCollapsed(on: Boolean) {
        if (on) store.put(toolbarCollapsedKey, "1") else store.remove(toolbarCollapsedKey)
        set({ it })
    }

    private val hideKey get() = "$key:hide"

    /** Slots the app hides by default (`manifest.hidden`); the user's choice wins over it. */
    public fun defaultHiddenSlots(): List<String> = HideEngine.defaultHidden(registry.types, manifest.hidden)

    /** The user's hide overrides (type -> hidden). Stored as a JSON object; the older JSON array (a list of hidden types) still reads. */
    private fun hideOverrides(): Map<String, Boolean> {
        val el = store.get(hideKey)?.let { ai.amberx.axf.kernel.asset.AxfJson.runCatching { parseToJsonElement(it) }.getOrNull() } ?: return emptyMap()
        return when (el) {
            is kotlinx.serialization.json.JsonArray -> el.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }.associateWith { true }
            is kotlinx.serialization.json.JsonObject -> el.mapNotNull { (k, v) -> (v as? kotlinx.serialization.json.JsonPrimitive)?.content?.toBooleanStrictOrNull()?.let { k to it } }.toMap()
            else -> emptyMap()
        }
    }

    /** Every hidden slot (only hideable types: the chrome): the user's overrides over the app's defaults. */
    public fun hiddenSlots(): List<String> = HideEngine.hiddenSlots(registry.types, hideOverrides(), defaultHiddenSlots())

    public fun slotHidden(type: String): Boolean = type in hiddenSlots()

    /** Hide or show a slot's chrome; ignored for types that aren't hideable. Back at the app's default, the override is dropped. */
    public fun setSlotHidden(type: String, hidden: Boolean) {
        if (!HideEngine.hideable(registry.types, type) || slotHidden(type) == hidden) return
        if (!can("assets.swap")) { toast("Your role cannot change the layout.", ToastKind.DANGER, "Permission denied"); return }
        val next = hideOverrides().toMutableMap()
        if (hidden == (type in defaultHiddenSlots())) next.remove(type) else next[type] = hidden
        if (next.isEmpty()) store.remove(hideKey)
        else store.put(hideKey, kotlinx.serialization.json.JsonObject(next.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) }).toString())
        terminal.ok("hot-swap", "$type ${if (hidden) "hidden" else "shown"}")
        set({ s -> if (hidden && type == AssetTypes.CONTEXT_MENU) s.copy(context = null) else s }, recompile = true)
        pushAppearance(AppearanceChange(hidden = mapOf(type to if (hidden == (type in defaultHiddenSlots())) null else hidden)))
    }

    /** "Randomize all": rolls every included slot over its included assets; excluded and hidden slots keep their asset. */
    public fun randomize() {
        if (!can("assets.swap")) { toast("Your role cannot swap assets.", ToastKind.DANGER, "Permission denied"); return }
        val hidden = hiddenSlots()
        val plan = RollEngine.plan(registry.types, registry.types.ids().filter { it !in hidden }, { registry.list(it) }, rollRules())
        val targets = plan.mapNotNull { (t, ids) -> ids.randomOrNull(random)?.let { t to it } }.toMap()
        if (targets.isEmpty()) { toast("No slot is included in rolls.", ToastKind.INFO, "Nothing to roll"); return }
        terminal.ok("hot-swap", "roll: ${targets.keys.joinToString()}")
        swapAll(targets)
    }

    public fun reset() {
        store.remove(hideKey)
        val active = LinkedHashMap<String, String>()
        for (t in registry.types.ids()) { val d = manifest.defaults[t]; val id = if (d != null && registry.has(t, d)) d else registry.list(t).firstOrNull()?.id; if (id != null) active[t] = id }
        val p = principal
        if (p != null) { active[AssetTypes.UAC_POLICY] = p.policy; set({ s -> s.copy(active = active, role = p.role, swaps = s.swaps + 1) }, persist = true, recompile = true) }
        else {
            val policy = UacPolicy.fromJson(registry.get(AssetTypes.UAC_POLICY, active.getValue(AssetTypes.UAC_POLICY))!!.data)
            set({ s -> s.copy(active = active, role = policy.defaultRole, swaps = s.swaps + 1) }, persist = true, recompile = true)
        }
        pushAppearance(AppearanceChange(slots = active.filterKeys { it != AssetTypes.UAC_POLICY }, hidden = HideEngine.hideableTypes(registry.types).associateWith { null }, palette = appearancePalette()))
    }

    public fun importAsset(raw: JsonObject, activate: Boolean = true, origin: String? = null): RegisterResult {
        if (!can("assets.import")) return RegisterResult(false, listOf("Your role needs \"assets.import\" to import assets."))
        if (principal != null && (raw["type"] as? kotlinx.serialization.json.JsonPrimitive)?.content == AssetTypes.UAC_POLICY) return RegisterResult(false, listOf("Access policies come from your account while you are signed in."))
        val r = registry.register(raw, AssetSource.IMPORTED, origin)
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
        principal?.let { if (id != it.role) toast("Your role comes from your account. An admin changes it in Account management.", ToastKind.INFO, "Access"); return }
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

    public fun openContext(x: Float, y: Float, target: String, payload: String? = null) {
        if (slotHidden(AssetTypes.CONTEXT_MENU)) return
        set({ it.copy(context = ContextState(x, y, target, payload)) })
    }
    public fun closeContext() { if (current.context != null) set({ it.copy(context = null) }) }
    /** Extra context-menu targets registered by modules (tab-group, window-title, …), merged ahead of the asset's items. */
    public val contextExtras: MutableMap<String, List<MenuItem>> = LinkedHashMap()
    /** Context-menu items libraries and plugins contribute (web: `AxfWebLibrary.contextMenu`), keyed by id; removed per module. */
    public data class ContextContribution(val id: String, val module: String, val target: String = "default", val order: Int = 100, val items: List<MenuItem>)
    private val contextContributions = LinkedHashMap<String, ContextContribution>()
    public fun addContextItems(c: ContextContribution) { contextContributions[c.id] = c }
    public fun removeContextItems(module: String) { contextContributions.values.removeAll { it.module == module } }
    public fun contributedContext(target: String): List<MenuItem> =
        contextContributions.values.filter { it.target == target }.sortedBy { it.order }.flatMap { it.items }

    public fun contextItems(target: String, payload: String?): List<MenuItem> {
        val contributed = contributedContext(target)
        val extra = (contextExtras[target] ?: emptyList()).plus(contributed).ifEmpty { null }
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
        val theme = ThemeEngine.compile(color, style, spacing())
        val layout = Layout.fromJson(d(AssetTypes.LAYOUT))
        val styles = ComponentStyleEngine.compile(Button.fromJson(d(AssetTypes.BUTTON)), Slider.fromJson(d(AssetTypes.SLIDER)), Container.fromJson(d(AssetTypes.CONTAINER)), Dialog.fromJson(d(AssetTypes.DIALOG)), Popup.fromJson(d(AssetTypes.POPUP)), ContextMenu.fromJson(d(AssetTypes.CONTEXT_MENU)), theme.style,
            Toolbar.fromJson(d(AssetTypes.TOOLBAR)), NavMenu.fromJson(d(AssetTypes.NAV_MENU)), AppMenu.fromJson(d(AssetTypes.APP_MENU)))
        val hidden = hiddenSlots()
        return Compiled(theme, layout, WindowClass.entries.associateWith { LayoutEngine.compile(layout, it, hidden) }, styles,
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
        // roll.slot:<type>:on|off|default · roll.asset:<type>:<id>:on|off|default (same specs as the web port)
        fun onOff(v: String?): Boolean? = when (v) { "on" -> true; "off" -> false; else -> null }
        actions.register("roll.slot", ActionMeta("Include a slot in randomize rolls", "assets.swap", params = true)) { args, _ -> args.getOrNull(0)?.let { if (registry.types.has(it)) setRollSlot(it, onOff(args.getOrNull(1))) } }
        // spacing:tight|compact|regular (same spec as the web port)
        actions.register("spacing", ActionMeta("Change spacing (tight, compact, regular)", "assets.swap", params = true)) { args, _ -> args.getOrNull(0)?.let { v -> Spacing.entries.firstOrNull { it.id == v }?.let { setSpacing(it) } } }
        // slot.hide:<type>:on|off (same spec as the web port)
        actions.register("slot.hide", ActionMeta("Hide or show a slot", "assets.swap", params = true)) { args, _ -> args.getOrNull(0)?.let { if (registry.types.has(it)) setSlotHidden(it, args.getOrNull(1) != "off") } }
        actions.register("roll.asset", ActionMeta("Include an asset in randomize rolls", "assets.swap", params = true)) { args, _ -> val t = args.getOrNull(0); val id = args.getOrNull(1); if (t != null && id != null && registry.types.has(t)) setRollAsset(t, id, onOff(args.getOrNull(2))) }
        actions.register("assets.reset", ActionMeta("Reset to defaults")) { _, _ -> reset() }
        actions.register("asset.json", ActionMeta("View asset JSON")) { a, _ -> openDialog("asset-json", mapOf("type" to a.getOrElse(0) { "" }, "id" to a.getOrElse(1) { "" })) }
        actions.register("asset.copy", ActionMeta("Copy asset JSON")) { a, ctx -> val json = if (a.size >= 2) exportAsset(a[0], a[1]) else ""; (ctx.extras["clipboard"] as? (String) -> Unit)?.invoke(json) ?: toast("Clipboard is not available here.", ToastKind.WARNING) }
        actions.register("noop", ActionMeta("Nothing")) { _, _ -> }
    }

    public companion object {
        public const val VERSION: String = AxfVersion.FRAMEWORK
    }
}
