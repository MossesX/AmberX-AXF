package ai.amberx.axf.kernel.module

import kotlin.reflect.KClass

/**
 * A named, typed slot that modules fill (Foundations: f.extpoints). The kernel declares the standard
 * points below; any module may declare its own. Contributions are ordered by `order`, then insertion.
 */
public class ExtensionPoint<T : Any>(public val id: String, public val type: KClass<T>, public val description: String = "", public val multiple: Boolean = true)

public data class Contribution<T : Any>(val value: T, val module: String, val order: Int = 100)

public class ExtensionRegistry {
    private val points = LinkedHashMap<String, ExtensionPoint<*>>()
    private val contributions = LinkedHashMap<String, MutableList<Contribution<*>>>()
    private val listeners = LinkedHashMap<String, MutableList<() -> Unit>>()

    public fun <T : Any> declare(point: ExtensionPoint<T>): ExtensionPoint<T> { points.putIfAbsent(point.id, point); return point }
    public fun points(): List<ExtensionPoint<*>> = points.values.toList()
    public fun isDeclared(id: String): Boolean = id in points

    public fun <T : Any> contribute(point: ExtensionPoint<T>, module: String, value: T, order: Int = 100): () -> Unit {
        declare(point)
        val c = Contribution(value, module, order)
        val list = contributions.getOrPut(point.id) { mutableListOf() }
        if (!point.multiple) list.clear()
        list += c
        listeners[point.id]?.forEach { it() }
        return { list.remove(c); listeners[point.id]?.forEach { it() } }
    }

    @Suppress("UNCHECKED_CAST")
    public fun <T : Any> get(point: ExtensionPoint<T>): List<T> = (contributions[point.id] ?: emptyList<Contribution<*>>()).sortedBy { it.order }.map { it.value as T }
    @Suppress("UNCHECKED_CAST")
    public fun <T : Any> contributions(point: ExtensionPoint<T>): List<Contribution<T>> = (contributions[point.id] ?: emptyList<Contribution<*>>()).sortedBy { it.order }.map { it as Contribution<T> }
    public fun <T : Any> first(point: ExtensionPoint<T>): T? = get(point).firstOrNull()
    public fun count(id: String): Int = contributions[id]?.size ?: 0
    public fun onChange(point: ExtensionPoint<*>, fn: () -> Unit): () -> Unit { listeners.getOrPut(point.id) { mutableListOf() } += fn; return { listeners[point.id]?.remove(fn) } }
    public fun removeAllFrom(module: String) { for (l in contributions.values) l.removeAll { it.module == module } }

    /** Empty / filled report for the console's kernel-status screen. */
    public fun report(): List<Triple<String, Int, String>> = points.values.map { Triple(it.id, count(it.id), it.description) }
}

/** Service registry: singletons keyed by type (and optionally by capability id). The DI boundary (Foundations: f.di). */
public class ServiceRegistry {
    private val byType = LinkedHashMap<KClass<*>, Any>()
    private val byCapability = LinkedHashMap<String, Any>()
    private val placeholders = LinkedHashMap<String, NotImplemented>()

    public fun <T : Any> register(type: KClass<T>, instance: T, capability: String? = null) { byType[type] = instance; capability?.let { byCapability[it] = instance; placeholders.remove(it) } }
    public inline fun <reified T : Any> register(instance: T, capability: String? = null): Unit = register(T::class, instance, capability)
    @Suppress("UNCHECKED_CAST")
    public fun <T : Any> get(type: KClass<T>): T? = byType[type] as T?
    public inline fun <reified T : Any> get(): T? = get(T::class)
    public fun capability(id: String): Any? = byCapability[id]
    public fun hasCapability(id: String): Boolean = id in byCapability
    /** Declares a capability without an implementation; `placeholder(id)` answers until something registers it. */
    public fun declarePlaceholder(id: String): NotImplemented = placeholders.getOrPut(id) { NotImplemented(id) }
    public fun placeholder(id: String): NotImplemented? = placeholders[id]
    public fun placeholders(): List<String> = placeholders.keys.toList()
    public fun types(): List<KClass<*>> = byType.keys.toList()
}

/** Standard extension points every port shares. Modules add their own with their namespace. */
public object ExtensionPoints {
    public val ACTIONS: ExtensionPoint<ActionContribution> = ExtensionPoint("axf.actions", ActionContribution::class, "Action handlers bound to action ids")
    public val ASSET_TYPES: ExtensionPoint<AssetTypeContribution> = ExtensionPoint("axf.asset-types", AssetTypeContribution::class, "New asset types (spec + decoder)")
    public val ASSET_SOURCES: ExtensionPoint<AssetSourceContribution> = ExtensionPoint("axf.asset-sources", AssetSourceContribution::class, "Where assets are loaded from (bundle, files, remote, QR)")
    public val ROUTES: ExtensionPoint<RouteContribution> = ExtensionPoint("axf.routes", RouteContribution::class, "Typed routes / views registered with the shell")
    public val SETTINGS: ExtensionPoint<SettingsContribution> = ExtensionPoint("axf.settings", SettingsContribution::class, "Settings schema groups that generate the settings UI")
    public val MENU_ITEMS: ExtensionPoint<MenuContribution> = ExtensionPoint("axf.menu-items", MenuContribution::class, "Items injected into app/context menus")
    public val LOG_SINKS: ExtensionPoint<Any> = ExtensionPoint("axf.log-sinks", Any::class, "Log sinks (file, remote, console)")
    public val TELEMETRY: ExtensionPoint<Any> = ExtensionPoint("axf.telemetry", Any::class, "Analytics/crash reporters")
    public val THEME_SOURCES: ExtensionPoint<Any> = ExtensionPoint("axf.theme-sources", Any::class, "Dynamic color / wallpaper theme providers")
    public val AUTH_PROVIDERS: ExtensionPoint<Any> = ExtensionPoint("axf.auth-providers", Any::class, "Sign-in providers")
    public val BILLING_PROVIDERS: ExtensionPoint<Any> = ExtensionPoint("axf.billing-providers", Any::class, "Subscription / purchase providers")
    public val MIGRATIONS: ExtensionPoint<MigrationContribution> = ExtensionPoint("axf.migrations", MigrationContribution::class, "Ordered migrations for assets/settings/db")
    public val SHELL_REGIONS: ExtensionPoint<Any> = ExtensionPoint("axf.shell-regions", Any::class, "Composables rendered into layout regions (status items, toolbar extras)")
    public val DIALOGS: ExtensionPoint<Any> = ExtensionPoint("axf.dialogs", Any::class, "App dialogs opened through the dialog engine")
    public val COMMANDS: ExtensionPoint<Any> = ExtensionPoint("axf.commands", Any::class, "Command palette / search entries")
    public val DEVTOOLS_PANELS: ExtensionPoint<Any> = ExtensionPoint("axf.devtools-panels", Any::class, "Inspector panels in the developer console")
    public val MACROS: ExtensionPoint<ai.amberx.axf.kernel.contract.ActionMacro> = ExtensionPoint("axf.macros", ai.amberx.axf.kernel.contract.ActionMacro::class, "Action macros contributed by packs/plugins")
    public val WORKERS: ExtensionPoint<Any> = ExtensionPoint("axf.workers", Any::class, "Background workers registered with the work scheduler")
    public val PLUGIN_SOURCES: ExtensionPoint<Any> = ExtensionPoint("axf.plugin-sources", Any::class, "Where plugins are discovered (files, QR, URL, store)")
    public val UI_KITS: ExtensionPoint<Any> = ExtensionPoint("axf.ui-kits", Any::class, "UI kits: a UiKitSpec plus the port's implementation table (third-party widget libraries)")
    // Interop (protocol-neutral): adapters for MCP / axf-link / axHub / …, and the descriptors that decide what they may expose.
    public val PROTOCOL_ADAPTERS: ExtensionPoint<ai.amberx.axf.kernel.interop.ProtocolAdapter> = ExtensionPoint("axf.protocol-adapters", ai.amberx.axf.kernel.interop.ProtocolAdapter::class, "Protocol adapters (MCP, axf-link, axHub connector, …) started with the kernel")
    public val ACTION_DESCRIPTORS: ExtensionPoint<ai.amberx.axf.kernel.interop.ActionDescriptorContribution> = ExtensionPoint("axf.action-descriptors", ai.amberx.axf.kernel.interop.ActionDescriptorContribution::class, "Typed action descriptors (schemas, exposure) + optional value-returning callables")
    public val EVENT_DESCRIPTORS: ExtensionPoint<ai.amberx.axf.kernel.interop.EventDescriptorContribution> = ExtensionPoint("axf.event-descriptors", ai.amberx.axf.kernel.interop.EventDescriptorContribution::class, "Event topics external subscribers may receive")
    public val ALL: List<ExtensionPoint<*>> = listOf(ACTIONS, ASSET_TYPES, ASSET_SOURCES, ROUTES, SETTINGS, MENU_ITEMS, LOG_SINKS, TELEMETRY, THEME_SOURCES, AUTH_PROVIDERS, BILLING_PROVIDERS, MIGRATIONS, SHELL_REGIONS, DIALOGS, COMMANDS, DEVTOOLS_PANELS, MACROS, WORKERS, PLUGIN_SOURCES, UI_KITS, PROTOCOL_ADAPTERS, ACTION_DESCRIPTORS, EVENT_DESCRIPTORS)
}

/* Contribution shapes for the standard points. Kept in the kernel so every port agrees on them. */
public data class ActionContribution(val id: String, val meta: ai.amberx.axf.kernel.engine.ActionMeta, val handler: ai.amberx.axf.kernel.engine.ActionHandler)
public data class AssetTypeContribution(val spec: ai.amberx.axf.kernel.asset.AssetTypeSpec, val decode: ((kotlinx.serialization.json.JsonObject) -> Any)? = null)
public fun interface AssetSourceContribution { public suspend fun load(): List<kotlinx.serialization.json.JsonObject> }
public data class RouteContribution(val route: ai.amberx.axf.kernel.contract.RouteSpec)
public data class SettingsContribution(val group: ai.amberx.axf.kernel.contract.SettingsGroup)
public data class MenuContribution(val menu: String, val target: String = "default", val item: ai.amberx.axf.kernel.asset.MenuItem)
public data class MigrationContribution(val migration: ai.amberx.axf.kernel.migrate.Migration)
