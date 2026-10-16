package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.WindowClass
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.PlaceholderModule
import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Loads every shared framework asset (framework/assets) and drives the kernel the way the shell does. */
class KernelTest {
    private val assetsDir = File("../../assets")
    private fun assets() = assetsDir.walkTopDown().filter { it.isFile && it.extension == "json" }.mapNotNull { it.readText().parseJsonObject() }.toList()
    private val manifest = AxfManifest.parse("""{"${'$'}axf":"manifest@1","app":{"id":"test","name":"Test","version":"0.1.0"},"framework":{"version":"0.2.0","template":"android-compose"},"targets":["android"],"startView":"home","defaults":${File("../../defaults.json").readText()}}""")!!

    @Test fun `every shared asset validates and loads`() {
        val kernel = AxfKernel.builder(manifest).assets(assets()).build()
        assertTrue(kernel.runtime.loadErrors.isEmpty(), "load errors: ${kernel.runtime.loadErrors}")
        assertEquals(39, kernel.registry.count())
        for (t in AssetTypes.CORE) assertTrue(kernel.runtime.current.active.containsKey(t), "slot $t")
    }

    @Test fun `swap recompiles theme and layout`() = runTest {
        val kernel = AxfKernel.builder(manifest).assets(assets()).build()
        kernel.start()
        val before = kernel.runtime.compiled.value.theme.colors["accent"]
        assertTrue(kernel.runtime.swap(AssetTypes.COLOR_THEME, "next"))
        assertTrue(kernel.runtime.compiled.value.theme.colors["accent"] != before)
        assertTrue(kernel.runtime.swap(AssetTypes.LAYOUT, "focus-top"))
        val l = kernel.runtime.compiled.value.layouts.getValue(WindowClass.EXPANDED)
        assertTrue(l.cssAreas.contains("\"nav\""))
        assertTrue(kernel.runtime.compiled.value.layouts.getValue(WindowClass.COMPACT).cssColumns == "minmax(0, 1fr)")
    }

    @Test fun `uac gating and action bus`() = runTest {
        val kernel = AxfKernel.builder(manifest).assets(assets()).build()
        kernel.start()
        kernel.runtime.setRole("guest")
        assertTrue(!kernel.runtime.can("files.write"))
        assertTrue(!kernel.runtime.dispatch("file.save").isOk)
        kernel.runtime.setRole("admin")
        assertTrue(kernel.runtime.dispatch("file.save").isOk)
        assertTrue(kernel.runtime.dispatch("swap:style-theme:next").isOk)
    }

    @Test fun `modules order by dependency and placeholders answer`() = runTest {
        val log = mutableListOf<String>()
        val a = object : BaseModule("ai.amberx.test.a") { override suspend fun start(ctx: ai.amberx.axf.kernel.module.ModuleContext) { log += "a" } }
        val b = object : BaseModule("ai.amberx.test.b") { override val dependsOn = listOf("ai.amberx.test.a"); override suspend fun start(ctx: ai.amberx.axf.kernel.module.ModuleContext) { log += "b" } }
        val ph = PlaceholderModule("ai.amberx.test.camera", "Camera", listOf(Capability("android.camera")))
        val kernel = AxfKernel.builder(manifest).assets(assets()).modules(b, a, ph).build()
        kernel.start()
        assertEquals(listOf("a", "b"), log)
        assertTrue("android.camera" in kernel.services.placeholders())
        assertTrue(kernel.status().modules.any { it.placeholder })
    }
}
