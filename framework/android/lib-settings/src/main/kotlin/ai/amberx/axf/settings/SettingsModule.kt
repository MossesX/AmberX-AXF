package ai.amberx.axf.settings

import ai.amberx.axf.data.PreferenceStore
import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.config.ConfigLayer
import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingScope
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.engine.Spacing
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.AxfUiPoints
import ai.amberx.axf.ui.ViewContribution
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * Settings engine: collects every `SettingsGroup` from `ExtensionPoints.SETTINGS`, keeps values in
 * DataStore (SECRET kind in the secure store), mirrors them into the kernel Config (USER layer) and
 * contributes the `settings` route and view (apps no longer register their own), the `app.settings` action, a default
 * `help.about` (app name, version and framework version from the manifest, plus `app.about` when the manifest has
 * one; an app's own `help.about` replaces it) and the framework's own groups (Appearance = every asset slot, General, About).
 */
public class SettingsModule : BaseModule(ID, "Settings") {
    override val provides: List<Capability> = listOf(Capability("axf.settings", "Schema-driven settings with generated UI"))
    override val dependsOn: List<String> = listOf("ai.amberx.axf.data")
    public val engine: SettingsEngine = SettingsEngine()

    override fun register(ctx: ModuleContext) {
        ctx.services.register(SettingsEngine::class, engine, "axf.settings")
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec(ROUTE, "Settings", icon = "settings", module = id)))
        ctx.extensions.contribute(AxfUiPoints.VIEWS, id, ViewContribution(ROUTE, "Settings", "settings") { SettingsScreen() })
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("app.settings", ActionMeta("Settings", module = id)) { _, _ -> runtime?.navigate(ROUTE) })
        // Lowest order, so an app module's own help.about (registered later) replaces it.
        val manifest = ctx.service(AxfKernel::class)?.manifest
        if (manifest != null) ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("help.about", ActionMeta("About", module = id)) { _, _ ->
            runtime?.toast(aboutText(manifest.appName, manifest.appVersion, manifest.frameworkVersion, ((manifest.raw["app"] as? kotlinx.serialization.json.JsonObject)?.get("about") as? JsonPrimitive)?.takeIf { it.isString }?.content), ToastKind.INFO, "About")
        }, order = 0)
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(appearanceGroup(runtime)), order = 10)
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(generalGroup()), order = 20)
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(aboutGroup()), order = 999)
        engine.bind(ctx)
        // The Spacing choice is the runtime's (it recompiles the theme); the setting mirrors it both ways.
        engine.onChange { k, v -> if (k == SPACING_KEY) runtime?.setSpacing(Spacing.of((v as? JsonPrimitive)?.content)) }
        ctx.extensions.onChange(ExtensionPoints.SETTINGS) { engine.refreshGroups(ctx) }
        // The app-wide search finds settings groups and single settings (web: SearchIndex.settingsEntries); a pick opens
        // Settings with the group's filter (settings.open:<group id>, read by SettingsScreen).
        runtime?.search?.add("axf.settings") {
            engine.groups.value.flatMap { g ->
                listOf(ai.amberx.axf.kernel.engine.SearchEntry("settings-group:${g.id}", "setting", g.label, detail = "Settings › ${g.label}", icon = g.icon, keywords = listOfNotNull(g.description), focus = mapOf("kind" to "setting", "tab" to g.id))) +
                    g.settings.filter { it.kind != SettingKind.SECTION }.map { sp ->
                        ai.amberx.axf.kernel.engine.SearchEntry("setting:${sp.key}", "setting", sp.label, detail = "Settings › ${g.label}", icon = sp.icon ?: g.icon, keywords = listOfNotNull(sp.key, sp.description), requires = sp.requires, focus = mapOf("kind" to "setting", "tab" to g.id, "anchor" to "setting:${sp.key}"))
                    }
            }
        }
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("settings.open", ActionMeta("Open settings group", module = id, params = true)) { a, _ ->
            runtime?.navigate("settings"); engine.requestFocus(a.getOrNull(0), a.getOrNull(1))
        })
    }

    override suspend fun init(ctx: ModuleContext) { engine.load() }

    private fun appearanceGroup(runtime: AxfRuntime?): SettingsGroup {
        val types = runtime?.registry?.types?.all() ?: emptyList()
        return SettingsGroup("appearance", "Appearance", "palette", id, order = 10, description = "Every slot is a hot-swappable asset. Changes apply instantly and persist.", settings = listOf(
            SettingSpec("axf.appearance.followSystem", "Follow system dark mode", SettingKind.TOGGLE, "Pick the dark/light counterpart of the color theme automatically", JsonPrimitive(false)),
            SettingSpec(SPACING_KEY, "Spacing", SettingKind.CHOICE, "How much room between and around things. Applies to every theme; Regular shows the style theme as designed.",
                JsonPrimitive((runtime?.spacing() ?: Spacing.DEFAULT).id), options = Spacing.entries.map { it.id to it.label }),
        ) + types.filter { !it.attachable && (!it.optional || runtime?.registry?.list(it.id)?.isNotEmpty() == true) }.map { t ->
            SettingSpec("axf.slot.${t.id}", t.label, SettingKind.ASSET_SLOT, if (t.id == AssetTypes.UAC_POLICY) "Changing the policy may change your role" else if (t.hideable) "Hidden removes it from the screen; its other options grey out." else null, JsonPrimitive(""), SettingScope.USER, target = t.id, requires = if (t.id == AssetTypes.UAC_POLICY) "uac.manage" else "assets.swap", icon = t.icon)
        })
    }
    private fun generalGroup(): SettingsGroup = SettingsGroup("general", "General", "settings", id, order = 20, settings = listOf(
        SettingSpec("axf.general.language", "Language", SettingKind.CHOICE, "String packs add more languages", JsonPrimitive("system"), options = listOf("system" to "System", "en" to "English")),
        SettingSpec("axf.general.haptics", "Haptic feedback", SettingKind.TOGGLE, default = JsonPrimitive(true)),
        SettingSpec("axf.general.animations", "Animations", SettingKind.TOGGLE, "Off = reduced motion", JsonPrimitive(true)),
        SettingSpec("axf.general.fontScale", "Font scale", SettingKind.SLIDER, default = JsonPrimitive(100), min = 80.0, max = 140.0, step = 5.0),
        SettingSpec("axf.general.startView", "Start screen", SettingKind.TEXT, "View id to open at launch", JsonPrimitive("home")),
    ))
    private fun aboutGroup(): SettingsGroup = SettingsGroup("about", "About", "info", id, order = 999, settings = listOf(
        SettingSpec("axf.about.open", "About this app", SettingKind.ACTION, target = "help.about", icon = "info"),
        SettingSpec("axf.about.docs", "Documentation", SettingKind.ACTION, target = "help.docs", icon = "external"),
        SettingSpec("axf.about.shortcuts", "Shortcuts", SettingKind.ACTION, target = "dialog:shortcuts", icon = "keyboard"),
        SettingSpec("axf.about.reset", "Reset assets to defaults", SettingKind.ACTION, target = "assets.reset", icon = "refresh"),
    ))

    public companion object {
        public const val ID: String = "ai.amberx.axf.settings"
        public const val ROUTE: String = "settings"
        /** "AXHub 0.1.0 on AmberX AXF 0.2.0. <about>" — the default About toast. */
        public fun aboutText(name: String, version: String, framework: String, about: String?): String =
            "$name $version on AmberX AXF $framework." + (about?.trim()?.takeIf { it.isNotEmpty() }?.let { " $it" } ?: "")
        /** Same key as the web port (core/runtime.ts SPACING_KEY). */
        public const val SPACING_KEY: String = "axf.appearance.spacing"
    }
}

/** Values + groups, observable. Writes go to DataStore (or SecureStore for SECRET) and the kernel Config. */
public class SettingsEngine {
    private var ctx: ModuleContext? = null
    private val _groups = MutableStateFlow<List<SettingsGroup>>(emptyList())
    public val groups: StateFlow<List<SettingsGroup>> get() = _groups
    private val _values = MutableStateFlow<Map<String, JsonElement>>(emptyMap())
    public val values: StateFlow<Map<String, JsonElement>> get() = _values
    private val listeners = mutableListOf<(String, JsonElement) -> Unit>()
    private val _focus = MutableStateFlow<Pair<String?, String?>?>(null)
    /** (group id, setting key) the screen should scroll to and filter by (from search / `settings.open:<group>[:<key>]`). */
    public val focusRequest: StateFlow<Pair<String?, String?>?> get() = _focus
    public fun requestFocus(group: String?, key: String?) { _focus.value = if (group == null && key == null) null else group to key }
    public fun clearFocus() { _focus.value = null }

    internal fun bind(c: ModuleContext) { ctx = c; refreshGroups(c) }
    internal fun refreshGroups(c: ModuleContext) { _groups.value = c.extensions.contributions(ExtensionPoints.SETTINGS).sortedBy { it.order }.map { it.value.group }.sortedBy { it.order } }
    public fun spec(key: String): SettingSpec? = _groups.value.asSequence().flatMap { it.settings.asSequence() }.firstOrNull { it.key == key }
    public fun get(key: String): JsonElement? = _values.value[key] ?: spec(key)?.default
    public fun string(key: String): String? = (get(key) as? JsonPrimitive)?.content
    public fun bool(key: String, default: Boolean = false): Boolean = string(key)?.toBooleanStrictOrNull() ?: default
    public fun onChange(fn: (String, JsonElement) -> Unit): () -> Unit { listeners += fn; return { listeners -= fn } }

    /** Loads persisted values for every known spec. */
    public suspend fun load() {
        val c = ctx ?: return
        val prefs = c.service(PreferenceStore::class) ?: return
        val secure = c.service(SecureStore::class)
        val config = c.service(Config::class)
        val out = LinkedHashMap<String, JsonElement>()
        for (g in _groups.value) for (s in g.settings) {
            val raw = if (s.kind == SettingKind.SECRET) secure?.get(s.key)?.getOrNull() else prefs.raw(s.key)
            if (raw != null) { out[s.key] = JsonPrimitive(raw); if (s.kind != SettingKind.SECRET) config?.set(s.key, raw, ConfigLayer.USER) }
        }
        _values.value = out
    }

    public suspend fun set(key: String, value: JsonElement) {
        val c = ctx ?: return
        val s = spec(key)
        val text = (value as? JsonPrimitive)?.content ?: value.toString()
        if (s?.kind == SettingKind.SECRET) c.service(SecureStore::class)?.put(key, text) else { c.service(PreferenceStore::class)?.setRaw(key, text); c.service(Config::class)?.set(key, text, ConfigLayer.USER) }
        _values.update { it + (key to value) }
        listeners.forEach { it(key, value) }
        c.service(AxfKernel::class)?.events?.emit(SettingChanged(key, text))
    }

    /** Portable export of non-secret values (import = set each). */
    public fun export(): Map<String, String> = _values.value.filterKeys { spec(it)?.kind != SettingKind.SECRET }.mapValues { (it.value as? JsonPrimitive)?.content ?: it.value.toString() }
}

public data class SettingChanged(val key: String, val value: String) : ai.amberx.axf.kernel.event.AxfEvent { override val topic: String = "axf.settings.changed" }
