package ai.amberx.axf.kernel.manifest

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.asset.bool
import ai.amberx.axf.kernel.asset.obj
import ai.amberx.axf.kernel.asset.objList
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.asset.str
import ai.amberx.axf.kernel.asset.strList
import ai.amberx.axf.kernel.asset.strMap
import ai.amberx.axf.kernel.asset.strOrNull
import kotlinx.serialization.json.JsonObject

public data class StructureEntry(val path: String, val purpose: String, val kind: String = "file", val required: Boolean = false)

/** axf.manifest.json — identical shape to the web port's AxfManifest, plus Android fields under `android`. */
public data class AxfManifest(
    val frame: String,
    val appId: String,
    val appName: String,
    val appVersion: String,
    val frameworkVersion: String,
    val template: String,
    val initializedAt: String?,
    val targets: List<String>,
    val startView: String,
    /** default asset per slot — every app starts from the same set, so apps left on defaults look identical */
    val defaults: Map<String, String>,
    /** chrome slots hidden by default (hideable types only, e.g. ["toolbar"]); the user can still show them in Settings */
    val hidden: List<String> = emptyList(),
    val structure: List<StructureEntry>,
    /** Android: application id, min/target sdk, module list, deep-link scheme */
    val android: AndroidManifestInfo?,
    val raw: JsonObject,
) {
    public data class AndroidManifestInfo(
        val applicationId: String, val scheme: String, val modules: List<String>, val minSdk: Int, val targetSdk: Int,
        /** FLAG_SECURE + WebView debugging off on the app's activity (`AxfActivity.secureWindow`); for apps holding secrets. */
        val secureWindow: Boolean = false,
    )

    public val isCompatible: Boolean get() = ai.amberx.axf.kernel.migrate.Semver.isCompatible(frameworkVersion, AxfVersion.FRAMEWORK)

    public companion object {
        public fun fromJson(o: JsonObject): AxfManifest = AxfManifest(
            frame = o.str("\$axf", AxfVersion.MANIFEST_FRAME),
            appId = o.obj("app")?.str("id", "axf-app") ?: "axf-app",
            appName = o.obj("app")?.str("name", "AXF App") ?: "AXF App",
            appVersion = o.obj("app")?.str("version", "0.1.0") ?: "0.1.0",
            frameworkVersion = o.obj("framework")?.str("version", AxfVersion.FRAMEWORK) ?: AxfVersion.FRAMEWORK,
            template = o.obj("framework")?.str("template", "android-compose") ?: "android-compose",
            initializedAt = o.strOrNull("initializedAt"),
            targets = o.strList("targets"),
            startView = o.str("startView", "home"),
            defaults = o.strMap("defaults"),
            hidden = o.strList("hidden"),
            structure = o.objList("structure").map { StructureEntry(it.str("path"), it.str("purpose"), it.str("kind", "file"), it.bool("required")) },
            android = o.obj("android")?.let { AndroidManifestInfo(it.str("applicationId", "ai.amberx.axf.app"), it.str("scheme", "axf"), it.strList("modules"), ai.amberx.axf.kernel.asset.int(it, "minSdk", 26), ai.amberx.axf.kernel.asset.int(it, "targetSdk", 35), it.bool("secureWindow")) },
            raw = o,
        )
        public fun parse(text: String): AxfManifest? = text.parseJsonObject()?.let(::fromJson)
    }
}
