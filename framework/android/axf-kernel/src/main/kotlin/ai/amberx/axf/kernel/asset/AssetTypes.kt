package ai.amberx.axf.kernel.asset

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull

/** Ids of the asset types every port shares (framework/schemas/asset-types.json). */
public object AssetTypes {
    public const val COLOR_THEME: String = "color-theme"
    public const val STYLE_THEME: String = "style-theme"
    public const val LAYOUT: String = "layout"
    public const val APP_MENU: String = "app-menu"
    public const val TOOLBAR: String = "toolbar"
    public const val NAV_MENU: String = "nav-menu"
    public const val CONTEXT_MENU: String = "context-menu"
    public const val DIALOG: String = "dialog"
    public const val POPUP: String = "popup"
    public const val BUTTON: String = "button"
    public const val SLIDER: String = "slider"
    public const val CONTAINER: String = "container"
    public const val UAC_POLICY: String = "uac-policy"
    /** Optional chrome types every port shares: the banner, and the attachable types it hosts (widgets and badges; web OPTIONAL_TYPES). */
    public const val BANNER: String = "banner"
    /** The floating pill over other apps (overlay@1, OverlayEngine; Android host: lib-overlay). */
    public const val OVERLAY: String = "overlay"
    public const val CLOCK: String = "clock"
    public const val SEARCH_BAR: String = "search-bar"
    public const val BADGE: String = "badge"
    /** Widget kinds (Oct 20 2026): logo, action button, label, status, counter, progress, avatar, link, theme switch, spacer, divider. */
    public val WIDGET_KINDS: List<String> = listOf("action-button", "logo", "label", "status", "counter", "progress", "avatar", "link", "theme-switch", "spacer", "divider")
    /** Brand types (brand-rules.mjs on the web; Kotlin twin deferred, PORTING.md): optional, never rolled except the branding package. */
    public val BRAND: List<String> = listOf("logo-mark", "animated-logo", ICON_PACK, "branding")
    public val OPTIONAL_SHARED: List<String> = listOf(BANNER, OVERLAY, CLOCK, SEARCH_BAR) + WIDGET_KINDS + BADGE

    /** Android-port asset types (framework/schemas/asset-types.android.json). Optional slots: an app may have none. */
    public const val SCREEN_TEMPLATE: String = "screen-template"
    /** `icon-pack` is a shared type since Oct 27 2026 (icon-pack@1, brand types); it lives in the core spec now. */
    public const val ICON_PACK: String = "icon-pack"
    public const val STRING_PACK: String = "string-pack"
    public const val IMAGE_PACK: String = "image-pack"
    public const val FONT_PACK: String = "font-pack"
    public const val MOTION_PACK: String = "motion-pack"
    public const val SETTINGS_SCHEMA: String = "settings-schema"
    public const val NAV_GRAPH: String = "nav-graph"
    public const val WIDGET: String = "widget"
    public const val NOTIFICATION_STYLE: String = "notification-style"
    /** Selects the active third-party UI kit (component implementation table). Optional: the port default applies when absent. */
    public const val UI_KIT: String = "ui-kit"
    /** Window schema per kind (toolbars allowed/forced, minimize defaults). */
    public const val WINDOW: String = "window"

    /** The 13 slots every app must fill (defaults.json). */
    public val CORE: List<String> = listOf(COLOR_THEME, STYLE_THEME, LAYOUT, APP_MENU, TOOLBAR, NAV_MENU, CONTEXT_MENU, DIALOG, POPUP, BUTTON, SLIDER, CONTAINER, UAC_POLICY)
    public val ANDROID: List<String> = listOf(SCREEN_TEMPLATE, STRING_PACK, IMAGE_PACK, FONT_PACK, MOTION_PACK, SETTINGS_SCHEMA, NAV_GRAPH, WIDGET, NOTIFICATION_STYLE, UI_KIT, WINDOW)
}

/** Spec of one asset type, as read from asset-types*.json. Modules may register more at runtime. */
public data class AssetTypeSpec(
    val id: String,
    val label: String,
    val group: String,
    val icon: String,
    val required: List<String>,
    val enums: Map<String, List<String>> = emptyMap(),
    val nested: Map<String, List<String>> = emptyMap(),
    /** Core slots always have an active asset; optional types may have none active. */
    val optional: Boolean = false,
    /** Which hot-swap tier a change of this type triggers (see HotSwapTier). */
    val swapTier: HotSwapTier = HotSwapTier.RECOMPOSE,
    /** Which module registered it (`kernel` for the built-ins). */
    val owner: String = "kernel",
    /** Randomize rolls (`roll` block): does the slot take part, and the default for an asset's own `roll` flag. null = registry default. */
    val rollSlot: Boolean? = null,
    val rollAsset: Boolean? = null,
    /** `hideable`: the slot may be hidden (chrome only; see HideEngine). */
    val hideable: Boolean = false,
    /** `attachable`: assets placed on a host (the banner), not a slot picked in Appearance or rolled (see BannerEngine). */
    val attachable: Boolean = false,
    /** `widget`: an attachable type that also goes on toolbars (`toolbar.widgets`), not just the banner (see WidgetEngine). */
    val widget: Boolean = false,
) {
    public companion object {
        public fun fromJson(id: String, o: JsonObject, owner: String = "kernel", optional: Boolean = false): AssetTypeSpec = AssetTypeSpec(
            id = id,
            label = o.str("label", id),
            group = o.str("group", "Other"),
            icon = o.str("icon", "box"),
            required = o.strList("required"),
            enums = o.obj("enums")?.mapValues { (_, v) -> (v as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: emptyList() } ?: emptyMap(),
            nested = o.obj("nested")?.mapValues { (_, v) -> (v as? kotlinx.serialization.json.JsonArray)?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: emptyList() } ?: emptyMap(),
            optional = o.bool("optional", optional),
            swapTier = HotSwapTier.parse(o.str("swapTier", if (id.endsWith("theme")) "LIVE" else "RECOMPOSE")),
            owner = owner,
            rollSlot = o.obj("roll")?.let { (it["slot"] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull },
            rollAsset = o.obj("roll")?.let { (it["asset"] as? kotlinx.serialization.json.JsonPrimitive)?.booleanOrNull },
            hideable = o.bool("hideable", false),
            attachable = o.bool("attachable", false),
            widget = o.bool("widget", false),
        )
    }
}

/**
 * The hot-swap boundary, declared per asset type (Foundations: f.hotswap).
 * LIVE: tokens only, no recomposition of structure (themes).
 * RECOMPOSE: the components that read the asset recompose (layout, menus, controls).
 * RESTART: requires the shell to be rebuilt (nav graph, uac policy with role change, string packs).
 */
public enum class HotSwapTier {
    LIVE, RECOMPOSE, RESTART;
    public companion object { public fun parse(s: String): HotSwapTier = entries.firstOrNull { it.name.equals(s, true) } ?: RECOMPOSE }
}

/**
 * Open registry of asset types. Built-ins come from the shared JSON specs; any module may register new
 * types (Foundations: f.registry) — the kernel never needs to change to accept a new kind of asset.
 */
public class AssetTypeRegistry {
    private val specs = LinkedHashMap<String, AssetTypeSpec>()
    private val envelopeRequired = mutableListOf("\$axf", "type", "id", "name", "version", "data")
    public var idPattern: Regex = Regex("^[a-z0-9][a-z0-9-]{1,47}$")
        private set
    /** `rollDefaults` from the spec (see RollEngine): slot / asset defaults and slots never rolled. */
    public var rollSlotDefault: Boolean = true
        private set
    public var rollAssetDefault: Boolean = true
        private set
    public val rollNever: MutableSet<String> = mutableSetOf()

    public fun register(spec: AssetTypeSpec): AssetTypeSpec { specs[spec.id] = spec; return spec }
    public fun get(id: String): AssetTypeSpec? = specs[id]
    public fun has(id: String): Boolean = id in specs
    public fun all(): List<AssetTypeSpec> = specs.values.toList()
    public fun ids(): List<String> = specs.keys.toList()
    public fun requiredEnvelopeFields(): List<String> = envelopeRequired.toList()

    /** Load a spec file in the asset-types.json shape (`types` map, optional `envelope`). */
    public fun loadSpecJson(json: JsonObject, owner: String = "kernel", optional: Boolean = false): Int {
        json.obj("envelope")?.let { env ->
            env.strOrNull("idPattern")?.let { idPattern = Regex(it) }
            env.strList("required").takeIf { it.isNotEmpty() }?.let { envelopeRequired.clear(); envelopeRequired += it }
        }
        json.obj("rollDefaults")?.let { rd ->
            rollSlotDefault = rd.bool("slot", rollSlotDefault)
            rollAssetDefault = rd.bool("asset", rollAssetDefault)
            rollNever += rd.strList("never")
        }
        val types = json.obj("types") ?: return 0
        var n = 0
        for ((id, v) in types) { (v as? JsonObject)?.let { register(AssetTypeSpec.fromJson(id, it, owner, optional)); n++ } }
        // Widget hosts the spec declares (`attach` / `widgets` blocks) join the WidgetEngine's host registry.
        ai.amberx.axf.kernel.engine.WidgetEngine.loadHosts(this, json)
        return n
    }

    public companion object {
        /** Registry pre-loaded with the shared core spec and the Android extension spec from the kernel's resources. */
        public fun builtin(): AssetTypeRegistry {
            val r = AssetTypeRegistry()
            BuiltinSpecs.core()?.let { r.loadSpecJson(it) }
            BuiltinSpecs.android()?.let { r.loadSpecJson(it, owner = "kernel", optional = true) }
            return r
        }
    }
}

/** Reads the spec JSON files bundled as resources (copied from framework/schemas at build time). */
public object BuiltinSpecs {
    private fun read(path: String): JsonObject? = BuiltinSpecs::class.java.getResourceAsStream(path)?.bufferedReader()?.readText()?.parseJsonObject()
    public fun core(): JsonObject? = read("/asset-types.json")
    public fun android(): JsonObject? = read("/asset-types.android.json")
    public fun defaults(): Map<String, String> = read("/defaults.json")?.entries?.mapNotNull { (k, v) -> (v as? kotlinx.serialization.json.JsonPrimitive)?.let { k to it.content } }?.toMap() ?: emptyMap()
    public fun frameworkVersion(): String = core()?.str("frameworkVersion", "0.1.0") ?: "0.1.0"
}
