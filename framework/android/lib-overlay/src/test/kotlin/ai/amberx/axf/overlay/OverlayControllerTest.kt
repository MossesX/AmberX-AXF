package ai.amberx.axf.overlay

import ai.amberx.axf.kernel.asset.parseJsonObject
import ai.amberx.axf.kernel.engine.OverlayData
import ai.amberx.axf.kernel.engine.OverlayEngine
import ai.amberx.axf.kernel.engine.OverlayPoint
import ai.amberx.axf.kernel.engine.OverlaySize
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The pure half of lib-overlay on the JVM: geometry clamps against the screen the service attaches, KV persistence of
 * position / mini size, chips and their state, the quick action, the log, config refresh, the hidden slot. The windows,
 * the service and the Compose pill are not under test here (CI compiles them; a device shows them).
 */
class OverlayControllerTest {
    private fun starter(id: String): OverlayData = OverlayEngine.normalize(File("../../assets/overlay/$id.json").readText().parseJsonObject()!!["data"])
    private var now = 1_700_000_000_000L

    private fun controller(config: OverlayData = starter("detector-panel"), kv: MemoryKeyValueStore = MemoryKeyValueStore(), hidden: () -> Boolean = { false }): OverlayController {
        return OverlayController({ config }, kv, { now }, hidden).also { it.attachScreen(1080, 2400, 2.5f); it.reportWindowSize(600, 400) }
    }

    @Test fun startsFromTheAsset() {
        val c = controller()
        val s = c.current
        assertTrue(s.miniOpen, "detector-panel opens its mini screen")
        assertTrue(s.logOpen)
        assertFalse(s.visible)
        assertEquals(OverlaySize(240, 300), s.miniSize)
        assertEquals(OverlayPoint(0, 0), s.position)
        assertEquals(listOf("Idle", "Mic off"), s.resolvedChips.map { it.text })
        assertTrue(s.canDrag)
        assertEquals("Detector", s.titleText)
    }

    @Test fun positionClampsToTheScreenAndPersists() {
        val kv = MemoryKeyValueStore()
        val c = controller(kv = kv)
        c.moveTo(5000f, 5000f)
        assertEquals(OverlayPoint(1080 - 600, 2400 - 400), c.current.position)
        assertEquals("480,2000", kv.get(OverlayEngine.Settings.POSITION))
        c.moveBy(-100f, -50f)
        assertEquals(OverlayPoint(380, 1950), c.current.position)
        c.moveBy(-9999f, -9999f)
        assertEquals(OverlayPoint(0, 0), c.current.position)
        // a new controller on the same store comes back where it was (clamped to its screen)
        kv.put(OverlayEngine.Settings.POSITION, "300,9999")
        val again = controller(kv = kv)
        assertEquals(OverlayPoint(300, 2000), again.current.position)
        kv.put(OverlayEngine.Settings.POSITION, "junk")
        assertEquals(OverlayPoint(0, 0), controller(kv = kv).current.position)
    }

    @Test fun aBiggerWindowPullsThePositionBack() {
        val c = controller()
        c.moveTo(480f, 2000f)
        c.reportWindowSize(800, 1000)
        assertEquals(OverlayPoint(280, 1400), c.current.position)
    }

    @Test fun miniResizeStaysInRangeAndPersists() {
        val kv = MemoryKeyValueStore()
        val c = controller(kv = kv)
        c.resizeBy(250f, 250f)                      // px at density 2.5 = +100 dp
        assertEquals(OverlaySize(340, 400), c.current.miniSize)
        assertEquals("340,400", kv.get(OverlayEngine.Settings.SIZE))
        c.resizeBy(99999f, 99999f)
        // the asset allows 480×640, the screen (432×960 dp) allows 90 % × 80 % = 388×768
        assertEquals(OverlaySize(388, 640), c.current.miniSize)
        c.resizeBy(-99999f, -99999f)
        assertEquals(OverlaySize(160, 160), c.current.miniSize)
        val again = controller(kv = kv)
        assertEquals(OverlaySize(160, 160), again.current.miniSize)
        c.resetGeometry()
        assertNull(kv.get(OverlayEngine.Settings.SIZE))
        assertNull(kv.get(OverlayEngine.Settings.POSITION))
        assertEquals(OverlaySize(240, 300), c.current.miniSize)
    }

    @Test fun positionLockStopsDragging() {
        val c = controller(starter("quiet-strip"))
        assertFalse(c.current.canDrag)
        c.moveBy(100f, 100f)
        assertEquals(OverlayPoint(0, 0), c.current.position)
        c.moveTo(100f, 100f)                        // the app may still place it
        assertEquals(OverlayPoint(100, 100), c.current.position)
    }

    @Test fun chipsAndTheirState() {
        val c = controller()
        c.setChip("armed", true)
        assertEquals(listOf("Armed", "Mic off"), c.current.resolvedChips.map { it.text })
        assertEquals("success", c.current.resolvedChips[0].tone)
        c.setChips(listOf(Chip("rec", "Recording", "Stopped", tone = "danger"), Chip("rec", "dupe"), Chip("net", "Online", on = true, tone = "pink")))
        val chips = c.current.resolvedChips
        assertEquals(listOf("rec", "net"), chips.map { it.id })
        assertEquals("Stopped", chips[0].text)
        assertEquals("Online", chips[1].text)
        assertEquals("success", chips[1].tone, "an unknown tone falls back")
        c.setChip("rec", true)
        assertEquals("Recording", c.current.resolvedChips[0].text)
        c.setChips(null)
        assertEquals("Armed", c.current.resolvedChips[0].text, "state survives going back to the asset's chips")
        c.setChips((1..9).map { Chip("c$it", "C$it") })
        assertEquals(OverlayEngine.Limits.CHIPS_MAX, c.current.resolvedChips.size)
        c.setTitle("x".repeat(60))
        assertEquals(40, c.current.titleText.length)
        c.setTitle(null)
        assertEquals("Detector", c.current.titleText)
    }

    @Test fun quickActionGoesToTheHandlerElseTheBus() {
        val c = controller()
        val dispatched = ArrayList<String>()
        c.dispatch = { dispatched += it }
        c.quickActionTapped()
        assertEquals(listOf("overlay.hide"), dispatched)
        val handled = ArrayList<String>()
        c.onQuickAction { handled += it }
        c.quickActionTapped()
        assertEquals(listOf("overlay.hide"), handled)
        assertEquals(1, dispatched.size, "the handler replaces the bus")
        c.onQuickAction(null)
        c.quickActionTapped()
        assertEquals(2, dispatched.size)
        val quiet = controller(starter("quiet-strip"))
        quiet.dispatch = { dispatched += it }
        quiet.quickActionTapped()
        assertEquals(2, dispatched.size, "no quick action on the asset = nothing dispatched")
    }

    @Test fun showHideAndTheService() {
        val c = controller()
        val calls = ArrayList<Boolean>()
        c.onVisibility = { calls += it }
        c.show(); c.show()
        assertEquals(listOf(true), calls)
        assertTrue(c.current.visible)
        c.setShown(true)
        assertTrue(c.current.shown)
        assertFalse(c.current.stripWanted)
        c.setCard { }
        assertTrue(c.current.cardShown)
        c.toggle()
        assertEquals(listOf(true, false), calls)
        assertFalse(c.current.visible)
        assertFalse(c.current.shown)
        assertFalse(c.current.cardShown, "hiding drops the card")
        assertNull(c.card.value)
        assertTrue(c.current.stripWanted, "the strip takes over while hidden")
        c.hide()
        assertEquals(2, calls.size)
    }

    @Test fun miniAndLogToggles() {
        val c = controller(starter("pill-compact"))
        assertFalse(c.current.miniOpen)
        c.toggleMini(); assertTrue(c.current.miniOpen)
        c.openMini(false); assertFalse(c.current.miniOpen)
        assertFalse(c.current.logOpen, "pill-compact ships the log off")
        c.openLog(true); assertTrue(c.current.logOpen)
        assertNull(c.miniContent.value)
        c.setMiniContent { }
        assertTrue(c.miniContent.value != null)
        c.setMiniContent(null)
        assertNull(c.miniContent.value)
    }

    @Test fun logKeepsTheNewestLinesAndTaps() {
        val c = controller()
        for (i in 1..8) { now += 100; c.log.add("line $i", i / 10.0, if (i % 2 == 0) "fired" else "", "trig.$i") }
        val lines = c.log.lines.value
        assertEquals(5, lines.size, "detector-panel keeps 5")
        assertEquals(listOf("line 4", "line 5", "line 6", "line 7", "line 8"), lines.map { it.text })
        assertEquals(0.8, lines.last().confidence)
        assertEquals("trig.8", lines.last().ref)
        assertEquals("line 8 · 80.0% · fired", OverlayEngine.logLineText(lines.last(), true))
        var tapped: String? = null
        assertFalse(c.log.hasTapHandler())
        c.log.onTap { tapped = it.ref }
        assertTrue(c.log.hasTapHandler())
        c.log.tapped(lines[1])
        assertEquals("trig.5", tapped)
        c.log.add("float", 0.5f, "x")
        assertEquals(0.5, c.log.lines.value.last().confidence)
        c.log.clear()
        assertTrue(c.log.lines.value.isEmpty())
    }

    @Test fun refreshFollowsTheConfigAndTheHiddenSlot() {
        var config = starter("detector-panel")
        var hidden = false
        val c = OverlayController({ config }, MemoryKeyValueStore(), { now }, { hidden })
        c.attachScreen(1080, 2400, 2.5f)
        for (i in 1..6) c.log.add("l$i")
        assertEquals(5, c.log.lines.value.size, "5 kept of 6")
        config = config.copy(log = config.log.copy(maxLines = 2, show = false), mini = config.mini.copy(width = config.mini.width.copy(max = 200)))
        hidden = true
        c.refreshConfig()
        assertEquals(2, c.log.lines.value.size, "re-trimmed after the config changed")
        assertFalse(c.current.logOpen, "the panel follows the config when its show flag changes")
        assertEquals(200, c.current.miniSize.width, "mini re-clamped into the new range")
        assertTrue(c.current.hidden)
        assertFalse(c.current.stripWanted, "nothing while the slot is hidden")
        hidden = false
        c.refreshConfig()
        assertFalse(c.current.hidden)
    }

    @Test fun anUnknownScreenClampsNothingButTheAssetLimits() {
        val c = OverlayController({ starter("detector-panel") }, null, { now })
        c.moveTo(123f, 456f)
        assertEquals(OverlayPoint(123, 456), c.current.position, "no screen yet: the position is kept as is")
        c.resizeTo(5000f, 5000f)
        assertEquals(OverlaySize(480, 640), c.current.miniSize, "the asset's limits still hold")
        c.attachScreen(400, 300, 1f)
        c.reportWindowSize(100, 100)
        assertEquals(OverlayPoint(123, 200), c.current.position, "clamped once a screen arrives")
    }
}
