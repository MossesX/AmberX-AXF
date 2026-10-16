package ai.amberx.axf.platform

import android.content.Context
import ai.amberx.axf.kernel.platform.FileArea
import ai.amberx.axf.kernel.platform.FileLayout
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import java.io.File

/**
 * Maps [FileArea] to Android directories:
 *  DATA → filesDir/data, CACHE → cacheDir, EXPORT → getExternalFilesDir(null)/export (falls back to filesDir),
 *  ASSETS → filesDir/assets (imported/hot-reloaded assets), LOGS → filesDir/logs, TEMP → cacheDir/tmp.
 * Every path is namespaced by module so two modules never share a directory.
 */
public class AndroidFileLayout(context: Context) : FileLayout {
    private val app = context.applicationContext

    public fun root(area: FileArea): File = when (area) {
        FileArea.DATA -> File(app.filesDir, "data")
        FileArea.CACHE -> app.cacheDir
        FileArea.EXPORT -> File(app.getExternalFilesDir(null) ?: app.filesDir, "export")
        FileArea.ASSETS -> File(app.filesDir, "assets")
        FileArea.LOGS -> File(app.filesDir, "logs")
        FileArea.TEMP -> File(app.cacheDir, "tmp")
    }

    override fun path(area: FileArea, module: String, relative: String): String {
        val dir = File(root(area), module.replace('/', '_'))
        val f = if (relative.isEmpty()) dir else File(dir, relative)
        (if (relative.isEmpty() || relative.endsWith("/")) f else f.parentFile ?: dir).mkdirs()
        return f.absolutePath
    }

    override fun read(path: String): AxfResult<String> {
        val f = File(path)
        if (!f.exists()) return AxfResult.err(AxfFailure.NotFound("file", path))
        return AxfResult.runCatching { f.readText() }
    }

    override fun write(path: String, text: String): AxfResult<Unit> = AxfResult.runCatching {
        val f = File(path)
        f.parentFile?.mkdirs()
        val tmp = File(f.parentFile, f.name + ".tmp")
        tmp.writeText(text)
        if (!tmp.renameTo(f)) { f.writeText(text); tmp.delete() }
    }

    override fun exists(path: String): Boolean = File(path).exists()
    override fun list(path: String): List<String> = File(path).listFiles()?.map { it.absolutePath }?.sorted() ?: emptyList()
    override fun delete(path: String): Boolean = File(path).deleteRecursively()
}
