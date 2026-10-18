package ai.amberx.axf.kernel.contract

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/* ---------- routes (Foundations: f.routes, f.results) ---------- */

/**
 * A typed route registered by a module. The shell renders `view` ids coming from nav-menu assets
 * through these specs; deep links use `axf://<appId>/<path>`. Rendering belongs to axf-ui; the kernel
 * only owns identity, arguments, permissions and placeholders.
 */
public data class RouteSpec(
    /** view id used by nav-menu assets and `nav:<view>` actions, e.g. `home`, `settings`, `logs` */
    val id: String,
    val label: String,
    val icon: String = "box",
    /** deep-link path with `{arg}` placeholders, e.g. `tracker/{itemId}` */
    val path: String = id,
    val args: List<RouteArg> = emptyList(),
    val requires: String? = null,
    val module: String = "app",
    /** true: the route exists for navigation but renders the standard "coming soon" placeholder screen */
    val placeholder: Boolean = false,
    /** optional result type id this route can return to its caller */
    val resultType: String? = null,
    val group: String? = null,
)
public data class RouteArg(val name: String, val type: String = "string", val optional: Boolean = false)

/** The kernel-side router contract; axf-nav implements it with Navigation Compose. */
public interface Router {
    public val current: String
    public fun navigate(view: String, args: Map<String, String> = emptyMap())
    public fun back(): Boolean
    public fun setResult(type: String, value: JsonElement)
    public fun consumeResult(type: String): JsonElement?
    public fun deepLink(uri: String): Boolean
}

/* ---------- settings schema (Foundations: f.settingsschema) ---------- */

public enum class SettingScope { APP, USER, DEVICE, ROLE, REMOTE_LOCKED }
public enum class SettingKind { TOGGLE, TEXT, SECRET, NUMBER, SLIDER, CHOICE, MULTI_CHOICE, COLOR, ASSET_SLOT, ACTION, LINK, SECTION, CUSTOM }

/** One setting. `key` is namespaced; `kind` drives the generated UI. ASSET_SLOT settings list the assets of a type and hot-swap on change. */
public data class SettingSpec(
    val key: String,
    val label: String,
    val kind: SettingKind,
    val description: String? = null,
    val default: JsonElement = JsonPrimitive(""),
    val scope: SettingScope = SettingScope.USER,
    val options: List<Pair<String, String>> = emptyList(),
    val min: Double? = null, val max: Double? = null, val step: Double? = null,
    /** for ASSET_SLOT: the asset type id; for ACTION: the action spec; for LINK: the route id */
    val target: String? = null,
    val requires: String? = null,
    val icon: String? = null,
    val searchable: Boolean = true,
    val restartRequired: Boolean = false,
)

/** `tab` picks the settings tab (appearance, account, connections, plugins, about, or any a module adds); null = general. Same field as the web port. */
public data class SettingsGroup(val id: String, val label: String, val icon: String = "settings", val module: String = "app", val order: Int = 100, val settings: List<SettingSpec>, val description: String? = null, val tab: String? = null)

/* ---------- ports (Foundations: f.ports) ---------- */

public enum class PortStatus { BUILT, PLANNED, PLACEHOLDER }
public data class Port(val id: String, val label: String, val stack: String, val status: PortStatus, val notes: String = "")

/** Registry of every port of the framework. Only identity; each port ships its own kernel adapters. */
public object Ports {
    public val ALL: List<Port> = listOf(
        Port("web", "Web", "React + TypeScript (framework/core, framework/react)", PortStatus.BUILT),
        Port("android", "Android", "Kotlin + Jetpack Compose (framework/android)", PortStatus.BUILT),
        Port("desktop", "Desktop", "Electron/Tauri wrapper of the web port, or Compose Multiplatform", PortStatus.PLANNED),
        Port("react-next", "React / Next.js / Node", "Next.js app template + Node build-engine API over framework/core", PortStatus.PLANNED),
        Port("angular", "Angular", "Angular bindings over framework/core", PortStatus.PLACEHOLDER),
        Port("python", "Python / PyQt6", "PyQt6 desktop apps over a Python kernel port (same assets, spec and fixtures)", PortStatus.PLANNED),
        Port("ios", "iOS", "Swift/SwiftUI or Compose Multiplatform", PortStatus.PLACEHOLDER),
        Port("wear", "Wear OS", "Compose for Wear", PortStatus.PLACEHOLDER),
        Port("tv", "Android TV", "Compose for TV", PortStatus.PLACEHOLDER),
        Port("auto", "Android Auto", "Car App Library", PortStatus.PLACEHOLDER),
        Port("web-component", "Web Component", "Custom elements over framework/core", PortStatus.PLACEHOLDER),
    )
}

/* ---------- strings (Foundations: f.i18n) ---------- */

/** Every user-visible string resolves through this; string-pack assets and platform resources both implement it. */
public interface Strings {
    public fun get(key: String, vararg args: Any?): String
    public fun plural(key: String, count: Int, vararg args: Any?): String = get(key, count, *args)
    public val isRtl: Boolean get() = false
}
public class MapStrings(private val map: Map<String, String>, private val fallback: Strings? = null) : Strings {
    override fun get(key: String, vararg args: Any?): String = map[key]?.let { s -> if (args.isEmpty()) s else runCatching { String.format(s, *args) }.getOrDefault(s) } ?: fallback?.get(key, *args) ?: key
}

/** Icon names in assets resolve through a registry (Foundations: f.icons); the UI maps them to vectors. */
public interface IconResolver { public fun has(name: String): Boolean }

/** Helper to read a JSON default as text for the settings UI. */
public fun JsonElement.asText(): String = (this as? JsonPrimitive)?.content ?: (this as? JsonObject)?.toString() ?: toString()
