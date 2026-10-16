package ai.amberx.axf.kernel

/**
 * Marks kernel API that is internal to the framework. Apps and libraries must not call it; it can
 * change in any release without a deprecation cycle. Framework modules opt in through build-logic.
 */
@RequiresOptIn(message = "Internal AmberX AXF API — not stable for apps.", level = RequiresOptIn.Level.ERROR)
@Retention(AnnotationRetention.BINARY)
@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY, AnnotationTarget.CONSTRUCTOR)
public annotation class AxfInternal

/** Marks API that exists so future apps can plug in, but whose shape may still change. */
@RequiresOptIn(message = "Experimental AmberX AXF API — may change before 1.0.", level = RequiresOptIn.Level.WARNING)
@Retention(AnnotationRetention.BINARY)
public annotation class AxfExperimental

/** Kernel identity and compatibility constants. */
public object AxfVersion {
    /** Framework version (matches framework/schemas/asset-types.json → frameworkVersion for the web port lineage). */
    public const val FRAMEWORK: String = "0.2.0"
    /** Kernel API level. Bumped only when a public contract changes incompatibly; modules declare the level they need. */
    public const val API_LEVEL: Int = 1
    /** Asset envelope frame accepted by this kernel. asset@2 will be accepted alongside asset@1 via migrations. */
    public val ASSET_FRAMES: Set<String> = setOf("asset@1")
    /** Manifest frame accepted by this kernel. */
    public const val MANIFEST_FRAME: String = "manifest@1"
    /** Port identifier for this kernel build. Other ports: web, desktop, ios, wear, tv, auto, js. */
    public const val PORT: String = "android"
}

/** Namespacing rules shared by every id in the framework: modules, assets, actions, permissions, routes, settings, events. */
public object AxfIds {
    public const val ROOT: String = "ai.amberx"
    private val id = Regex("^[a-z0-9][a-z0-9-]{1,47}$")
    private val ns = Regex("^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$")

    /** Asset / slot ids: `^[a-z0-9][a-z0-9-]{1,47}$` (same pattern as the web port). */
    public fun isAssetId(s: String): Boolean = id.matches(s)
    /** Dotted namespaced ids such as `file.save`, `assets.swap`, `ai.amberx.axf.settings`. */
    public fun isNamespaced(s: String): Boolean = ns.matches(s)
    public fun module(name: String): String = "$ROOT.axf.$name"
}
