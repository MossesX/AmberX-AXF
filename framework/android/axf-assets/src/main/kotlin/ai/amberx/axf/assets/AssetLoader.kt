package ai.amberx.axf.assets

import android.content.Context
import android.content.res.AssetManager
import ai.amberx.axf.kernel.asset.parseJsonObject
import kotlinx.serialization.json.JsonObject

/**
 * Reads every `assets/axf/assets/<type>/<id>.json` bundled in the APK. The directory is filled by the
 * `copyAxfAssets` Gradle task from framework/assets, so the Android app ships exactly the web demo's set.
 */
public object AssetLoader {
    public const val ROOT: String = "axf/assets"

    /** Every bundled asset as a raw envelope object, in type/id order. Invalid JSON files are skipped. */
    public fun loadAll(context: Context, root: String = ROOT): List<JsonObject> = loadAll(context.assets, root)

    public fun loadAll(assets: AssetManager, root: String = ROOT): List<JsonObject> {
        val out = mutableListOf<JsonObject>()
        for (path in listJsonFiles(assets, root)) {
            val text = runCatching { assets.open(path).bufferedReader().use { it.readText() } }.getOrNull() ?: continue
            text.parseJsonObject()?.let(out::add)
        }
        return out
    }

    /** Paths of every `.json` file under `root`, recursively, sorted. */
    public fun listJsonFiles(assets: AssetManager, root: String = ROOT): List<String> {
        val out = mutableListOf<String>()
        fun walk(dir: String) {
            val children = runCatching { assets.list(dir) }.getOrNull() ?: return
            for (c in children.sorted()) {
                val p = if (dir.isEmpty()) c else "$dir/$c"
                if (c.endsWith(".json")) out += p else walk(p)
            }
        }
        walk(root)
        return out
    }

    /** Reads one bundled asset (`type/id.json`) or null. */
    public fun load(context: Context, type: String, id: String, root: String = ROOT): JsonObject? =
        runCatching { context.assets.open("$root/$type/$id.json").bufferedReader().use { it.readText() } }.getOrNull()?.parseJsonObject()
}
