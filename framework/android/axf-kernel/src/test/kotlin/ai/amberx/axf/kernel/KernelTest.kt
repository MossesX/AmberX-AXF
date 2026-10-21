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
        // every shared asset (distinct type + id) is registered; counted from the files so new starter assets need no edit here
        val expected = assets().filter { (it["\$axf"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "asset@1" }
            .map { "${(it["type"] as? kotlinx.serialization.json.JsonPrimitive)?.content}:${(it["id"] as? kotlinx.serialization.json.JsonPrimitive)?.content}" }.toSet().size
        assertEquals(expected, kernel.registry.count())  // shared assets; port-specific ones live in framework/android/assets
        for (t in AssetTypes.CORE) assertTrue(kernel.runtime.current.active.containsKey(t), "slot $t")
        // the optional shared chrome types ship starters, so the defaults pick them
        for (t in AssetTypes.OPTIONAL_SHARED) assertTrue(kernel.runtime.current.active.containsKey(t), "optional slot $t")
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

    @Test fun `widget hosts: attach, replace, detach, warn`() = runTest {
        val kernel = AxfKernel.builder(manifest).assets(assets()).build()
        kernel.start()
        val rt = kernel.runtime
        val (_, h, placed) = rt.banner()
        assertEquals(24, h)
        assertEquals(listOf("search-bar:everything"), placed.getValue("center").map { it.key })
        assertEquals(listOf("clock:digital-12h"), placed.getValue("right").map { it.key })
        rt.attachToBanner(ai.amberx.axf.kernel.engine.BannerAttachment("badge", "new", "left", 5.0, "p1"))
        assertEquals(listOf("badge:new@p1"), rt.banner().third.getValue("left").map { "${it.key}@${it.origin}" })
        rt.attachToBanner(ai.amberx.axf.kernel.engine.BannerAttachment("badge", "new", "right", null, "p2"))
        assertEquals(0, rt.banner().third.getValue("left").size, "same type+id replaces")
        assertEquals(listOf("clock:digital-12h", "badge:new"), rt.banner().third.getValue("right").map { it.key }, "asset clock (10) before runtime badge (1000)")
        rt.detachFromBanner("p2")
        assertEquals(listOf("clock:digital-12h"), rt.banner().third.getValue("right").map { it.key })
        val warnsBefore = rt.terminal.lines.value.count { it.channel == "widgets" }
        rt.attachToBanner(ai.amberx.axf.kernel.engine.BannerAttachment("button", "rounded-solid", "left", null, "p3"))
        rt.attachToBanner(ai.amberx.axf.kernel.engine.BannerAttachment("badge", "new", "top", null, "p3"))
        rt.attachToBanner(ai.amberx.axf.kernel.engine.BannerAttachment("badge", "missing", "left", null, "p3"))
        rt.attachToHost("ribbon", ai.amberx.axf.kernel.engine.BannerAttachment("badge", "new", "left", null, "p3"))
        assertEquals(4, rt.terminal.lines.value.count { it.channel == "widgets" } - warnsBefore, "one warning per bad call")
        assertEquals(0, rt.banner().third.getValue("left").size, "bad attachments never show")
        rt.attachToToolbar(ai.amberx.axf.kernel.engine.BannerAttachment("clock", "digital-24h", "end", null, "p4"))
        rt.attachToBanner(ai.amberx.axf.kernel.engine.BannerAttachment("badge", "new", "left", null, "p4"))
        assertEquals(listOf("clock:digital-24h"), rt.toolbarWidgets().getValue("end").map { it.key })
        rt.detachAll("p4")
        assertEquals(0, rt.toolbarWidgets().getValue("end").size + rt.banner().third.getValue("left").size, "detachAll clears every host")
        rt.setSlotHidden(AssetTypes.BANNER, true)
        assertEquals(null, rt.banner().first, "hidden banner has no data")
        assertEquals(0, rt.banner().second, "hidden banner has no height")
        rt.setSlotHidden(AssetTypes.BANNER, false)
        rt.showBannerPopup("badge:new", "hi")
        assertEquals("hi", rt.current.bannerPopup?.text)
        rt.dismissBannerPopup()
        assertEquals(null, rt.current.bannerPopup)
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
