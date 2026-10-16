package ai.amberx.axf.kernel.contract

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.int
import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strOrNull
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonObject

/*
 * Plugin extension engine contract (kernel API level 1). Modules compiled into an app are the first
 * tier; plugins are the same thing delivered after install, by anyone, under a manifest and a grant.
 *
 *   pack    assets + action macros + string packs, no code — loadable from a zip, URL or QR; safe for anyone to author
 *   module  compiled Kotlin (dynamic feature / split APK), signed; becomes an AxfModule once loaded
 *   script  reserved for a sandboxed scripting runtime (not built; manifests with it are accepted and parked)
 *
 * The loader (capability `axf.plugins`) is a placeholder until axf-platform-android implements it.
 */

public enum class PluginKind { PACK, MODULE, SCRIPT; public companion object { public fun parse(s: String?): PluginKind = entries.firstOrNull { it.name.equals(s, true) } ?: PACK } }
public enum class PluginState { STAGED, DISABLED, ENABLED, FAILED, BLOCKED }

/** Scopes a plugin may ask for; the host grants them. A PACK can never hold more than ASSETS and ACTIONS. */
public enum class PluginScope {
    ASSETS, ACTIONS, ROUTES, SETTINGS, MENU_ITEMS, NETWORK, FILES, NOTIFICATIONS, BACKGROUND, DEVICE, IDENTITY, BILLING;
    public companion object {
        public val PACK_MAX: Set<PluginScope> = setOf(ASSETS, ACTIONS)
        public fun parse(s: String): PluginScope? = entries.firstOrNull { it.name.equals(s, true) }
    }
}

/** `plugin@1` manifest — the envelope every plugin carries, whatever its payload. */
public data class PluginManifest(
    val frame: String,
    val id: String,
    val name: String,
    val version: String,
    val kind: PluginKind,
    val apiLevel: Int,
    val author: String? = null,
    val description: String? = null,
    val provides: List<String> = emptyList(),
    val requires: List<String> = emptyList(),
    val scopes: Set<PluginScope> = emptySet(),
    /** module class name for MODULE plugins; entry asset/macro for PACKs */
    val entry: String? = null,
    /** host app ids this plugin targets ("*" = any AXF app) */
    val targets: List<String> = listOf("*"),
    val signed: Boolean = false,
    val minFrameworkVersion: String = "0.2.0",
    val raw: JsonObject,
) {
    public val isCompatible: Boolean get() = apiLevel <= AxfVersion.API_LEVEL && ai.amberx.axf.kernel.migrate.Semver.isCompatible(minFrameworkVersion, AxfVersion.FRAMEWORK)
    public val scopesAllowed: Boolean get() = kind != PluginKind.PACK || scopes.all { it in PluginScope.PACK_MAX }

    public companion object {
        public const val FRAME: String = "plugin@1"
        public fun fromJson(o: JsonObject): PluginManifest = PluginManifest(
            frame = o.str("\$axf", FRAME), id = o.str("id"), name = o.str("name", o.str("id")), version = o.str("version", "0.1.0"),
            kind = PluginKind.parse(o.strOrNull("kind")), apiLevel = o.int("apiLevel", 1), author = o.strOrNull("author"), description = o.strOrNull("description"),
            provides = o.strList("provides"), requires = o.strList("requires"),
            scopes = o.strList("scopes").mapNotNull { PluginScope.parse(it) }.toSet(), entry = o.strOrNull("entry"),
            targets = o.strList("targets").ifEmpty { listOf("*") }, signed = o.bool("signed"), minFrameworkVersion = o.str("minFrameworkVersion", "0.2.0"), raw = o,
        )
        public fun parse(text: String): PluginManifest? = text.parseJsonObject()?.let(::fromJson)
        /** Structural validation shared by every port (the loader adds signature + scope checks). */
        public fun validate(m: PluginManifest): List<String> = buildList {
            if (m.frame != FRAME) add("\"\$axf\" must be \"$FRAME\"")
            if (!ai.amberx.axf.kernel.AxfIds.isNamespaced(m.id)) add("plugin id must be namespaced (e.g. com.example.myplugin)")
            if (m.name.isBlank()) add("name is required")
            if (!m.isCompatible) add("plugin needs kernel API level ${m.apiLevel} / framework ${m.minFrameworkVersion}")
            if (!m.scopesAllowed) add("a pack may only request ASSETS and ACTIONS scopes")
            if (m.kind == PluginKind.MODULE && m.entry == null) add("module plugins must name their entry class")
        }
    }
}

public data class PluginInfo(val manifest: PluginManifest, val state: PluginState, val granted: Set<PluginScope>, val installedAtMillis: Long, val error: String? = null, val source: String? = null)

/** Capability `axf.plugins`. Placeholder until the platform loader exists; the contract is fixed now so apps can rely on it. */
public interface PluginLoader {
    public val plugins: Flow<List<PluginInfo>>
    /** Stage from a local file/zip/APK split or a URL; returns the parsed manifest for the host to show a grant dialog. */
    public suspend fun stage(source: String): AxfResult<PluginManifest>
    /** Enable with the scopes the user granted (never more than requested; packs capped at PACK_MAX). */
    public suspend fun enable(id: String, granted: Set<PluginScope>): AxfResult<Unit>
    public suspend fun disable(id: String): AxfResult<Unit>
    public suspend fun uninstall(id: String): AxfResult<Unit>
    public fun info(id: String): PluginInfo?
}

/** A pack's action macro: a named sequence of action specs the pack contributes (runs through the action bus, so UAC still applies). */
public data class ActionMacro(val id: String, val label: String, val steps: List<String>, val icon: String? = null, val requires: String? = null)
