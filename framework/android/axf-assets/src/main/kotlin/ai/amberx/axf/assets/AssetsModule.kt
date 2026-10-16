package ai.amberx.axf.assets

import android.content.Context
import ai.amberx.axf.kernel.KernelFlags
import ai.amberx.axf.kernel.asset.AxfJson
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.flags.FeatureFlags
import ai.amberx.axf.kernel.module.AssetSourceContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.platform.FileArea
import ai.amberx.axf.kernel.platform.FileLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Asset sources beyond the bundle:
 *  - [FileAssetSource]: `FileArea.ASSETS/<module>/*.json` — assets imported at runtime survive restarts.
 *  - [RemoteAssetSource]: hot-reload from a URL (`axf.assets.url` config) when the `axf.hotReload` flag is on.
 * The bundle itself is passed to the kernel builder by AxfApplication, so the kernel validates it before
 * the first frame; these sources load during `kernel.start()`.
 */
public class AssetsModule(context: Context) : BaseModule(ID, "Assets") {
    private val app = context.applicationContext
    override val provides: List<Capability> = listOf(Capability("axf.assets.bundle", "Bundled asset loading"), Capability("axf.assets.remote", "Remote / hot-reload asset source"))

    override fun register(ctx: ModuleContext) {
        val files = ctx.services.get(FileLayout::class)
        if (files != null) ctx.extensions.contribute(ExtensionPoints.ASSET_SOURCES, id, FileAssetSource(files, "imported"), order = 50)
        val flags = ctx.services.get(FeatureFlags::class)
        val config = ctx.services.get(Config::class)
        ctx.extensions.contribute(ExtensionPoints.ASSET_SOURCES, id, RemoteAssetSource(
            enabled = { flags?.isEnabled(KernelFlags.HOT_RELOAD.id) == true },
            url = { config?.string("axf.assets.url") },
        ), order = 200)
        ctx.services.register(AssetsModule::class, this, "axf.assets.bundle")
    }

    /** Re-reads the bundle (for the devtools "reload bundle" button). */
    public fun bundle(): List<JsonObject> = AssetLoader.loadAll(app)

    public companion object { public const val ID: String = "ai.amberx.axf.assets" }
}

/** Loads every `*.json` under `FileArea.ASSETS/<module>`; a file may hold one envelope or an array of them. */
public class FileAssetSource(private val files: FileLayout, private val module: String = "imported") : AssetSourceContribution {
    override suspend fun load(): List<JsonObject> = withContext(Dispatchers.IO) {
        val dir = files.path(FileArea.ASSETS, module)
        files.list(dir).filter { it.endsWith(".json") }.flatMap { p -> files.read(p).getOrNull()?.let(::parseMany) ?: emptyList() }
    }

    /** Persists an asset so it is reloaded on the next start. */
    public fun save(raw: JsonObject): Boolean {
        val type = (raw["type"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return false
        val id = (raw["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: return false
        val path = files.path(FileArea.ASSETS, module, "$type--$id.json")
        return files.write(path, AxfJson.encodeToString(JsonObject.serializer(), raw)).isOk
    }
}

/**
 * Remote source stub: when enabled it GETs `url` and accepts one envelope or an array. No retries, no
 * polling, no QR — those arrive with axf-network's RemoteConfig; this exists so the extension point is filled
 * and the flag has an effect from day one.
 */
public class RemoteAssetSource(private val enabled: () -> Boolean, private val url: () -> String?) : AssetSourceContribution {
    override suspend fun load(): List<JsonObject> {
        if (!enabled()) return emptyList()
        val target = url()?.takeIf { it.isNotBlank() } ?: return emptyList()
        return withContext(Dispatchers.IO) {
            runCatching {
                val conn = URL(target).openConnection() as HttpURLConnection
                conn.connectTimeout = 5000; conn.readTimeout = 10000
                conn.inputStream.bufferedReader().use { it.readText() }
            }.getOrNull()?.let(::parseMany) ?: emptyList()
        }
    }
}

internal fun parseMany(text: String): List<JsonObject> {
    text.parseJsonObject()?.let { return listOf(it) }
    val arr = runCatching { AxfJson.parseToJsonElement(text) as? JsonArray }.getOrNull() ?: return emptyList()
    return arr.mapNotNull { it as? JsonObject }
}
