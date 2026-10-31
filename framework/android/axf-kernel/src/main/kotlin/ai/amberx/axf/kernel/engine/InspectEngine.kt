package ai.amberx.axf.kernel.engine

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * element-inspector@1 — the element inspector's pointer model. Mirrors core/engines/inspect.ts; both replay
 * spec/fixtures/element-inspector.json (ElementInspectorConformanceTest). Pure: the Compose host (axf-devtools
 * `ElementInspector`) feeds it pointer events and draws what it says.
 *
 * Left button only (the primary touch / pen, a mouse's main button); every other button passes through:
 * press on the page opens the follow panel at the pointer (`look`), drag keeps it following (live), release or cancel
 * closes it. A double press (within [InspectConfig.doubleMs] and [InspectConfig.doubleDist]) pins a panel on the element
 * under the second press (`pinned`); the pinned panel moves by its head and resizes from its corner, clamped to the
 * viewport and never under [InspectConfig.min]; [InspectEvent.Unpin] closes it. A press that inspected the page
 * swallows the click it would make (`consume`).
 */
public object InspectEngine {
    public const val VERSION: String = "element-inspector@1"

    public fun init(viewport: InspectSize): InspectState = InspectState(viewport = viewport)

    /** The left button (or the primary touch / pen)? */
    public fun isLeftPress(button: Int = 0, primary: Boolean = true): Boolean = button == 0 && primary

    /** Where the follow panel goes: past the pointer by `offset`, flipped to the other side to stay on screen. */
    public fun followPanel(at: InspectPoint, size: InspectSize, viewport: InspectSize, cfg: InspectConfig = InspectConfig()): InspectPoint {
        val m = cfg.margin
        var x = at.x + cfg.offset
        var y = at.y + cfg.offset
        if (x + size.w > viewport.w - m) x = max(m, at.x - cfg.offset - size.w)
        if (y + size.h > viewport.h - m) y = max(m, at.y - cfg.offset - size.h)
        return InspectPoint(x, y)
    }

    /** A panel kept inside the viewport: at least `min`, at most the viewport less the margins, then fully on screen. */
    public fun clampPanel(r: InspectRect, viewport: InspectSize, cfg: InspectConfig = InspectConfig()): InspectRect {
        val m = cfg.margin
        val w = max(cfg.min.w, min(r.w, viewport.w - 2 * m))
        val h = max(cfg.min.h, min(r.h, viewport.h - 2 * m))
        val x = max(m, min(r.x, viewport.w - m - w))
        val y = max(m, min(r.y, viewport.h - m - h))
        return InspectRect(x, y, w, h)
    }

    public fun movePanel(from: InspectRect, dx: Double, dy: Double, viewport: InspectSize, cfg: InspectConfig = InspectConfig()): InspectRect =
        clampPanel(InspectRect(from.x + dx, from.y + dy, from.w, from.h), viewport, cfg)

    /** Resized from the bottom-right corner: the top-left stays, the corner stops at the viewport edge. */
    public fun resizePanel(from: InspectRect, dw: Double, dh: Double, viewport: InspectSize, cfg: InspectConfig = InspectConfig()): InspectRect {
        val m = cfg.margin
        val w = max(cfg.min.w, min(from.w + dw, viewport.w - m - from.x))
        val h = max(cfg.min.h, min(from.h + dh, viewport.h - m - from.y))
        return clampPanel(InspectRect(from.x, from.y, w, h), viewport, cfg)
    }

    /** A new pin's panel: beside the pointer like the follow panel, at the configured size. */
    public fun pinPanel(at: InspectPoint, viewport: InspectSize, cfg: InspectConfig = InspectConfig()): InspectRect {
        val p = followPanel(at, cfg.panel, viewport, cfg)
        return clampPanel(InspectRect(p.x, p.y, cfg.panel.w, cfg.panel.h), viewport, cfg)
    }

    private fun none(s: InspectState) = InspectResult(s, null, null, false)

    /** One pointer (or panel) event → the next state and what the host does now. */
    public fun step(s: InspectState, e: InspectEvent, cfg: InspectConfig = InspectConfig()): InspectResult = when (e) {
        is InspectEvent.Unpin -> none(s.copy(pin = null, grab = null))
        is InspectEvent.Viewport -> {
            val vp = InspectSize(e.w, e.h)
            none(s.copy(viewport = vp, pin = s.pin?.let { InspectPin(it.at, clampPanel(it.panel, vp, cfg)) }))
        }
        is InspectEvent.Pointer -> pointer(s, e, cfg)
    }

    private fun pointer(s: InspectState, e: InspectEvent.Pointer, cfg: InspectConfig): InspectResult {
        val pt = InspectPoint(e.x, e.y)
        return when (e.type) {
            InspectPointerType.Down -> {
                if (!isLeftPress(e.button, e.primary)) return none(s)
                if (e.on != InspectOn.Page) {
                    val pin = s.pin
                    if (pin == null || e.on == InspectOn.Panel) return none(s)
                    return none(s.copy(grab = InspectGrab(if (e.on == InspectOn.Head) InspectGrabKind.Move else InspectGrabKind.Resize, e.x, e.y, pin.panel)))
                }
                val last = s.last
                val double = last != null && e.t - last.t <= cfg.doubleMs && hypot(e.x - last.x, e.y - last.y) <= cfg.doubleDist
                if (double) {
                    val pin = InspectPin(pt, pinPanel(pt, s.viewport, cfg))
                    InspectResult(s.copy(pressed = true, follow = pt, last = null, pin = pin, grab = null), pt, pt, true)
                } else {
                    InspectResult(s.copy(pressed = true, follow = pt, last = InspectPress(e.t, e.x, e.y), grab = null), pt, null, true)
                }
            }
            InspectPointerType.Move -> {
                val grab = s.grab
                val pin = s.pin
                if (grab != null && pin != null) {
                    val dx = e.x - grab.x
                    val dy = e.y - grab.y
                    val panel = if (grab.kind == InspectGrabKind.Move) movePanel(grab.from, dx, dy, s.viewport, cfg) else resizePanel(grab.from, dx, dy, s.viewport, cfg)
                    none(s.copy(pin = InspectPin(pin.at, panel)))
                } else if (!s.pressed) none(s)
                else InspectResult(s.copy(follow = pt), pt, null, false)
            }
            InspectPointerType.Up -> when {
                !isLeftPress(e.button, e.primary) -> none(s)
                s.grab != null -> none(s.copy(grab = null))
                !s.pressed -> none(s)
                else -> InspectResult(s.copy(pressed = false, follow = null), null, null, true)
            }
            InspectPointerType.Cancel -> none(s.copy(pressed = false, follow = null, grab = null))
        }
    }
}

public data class InspectPoint(val x: Double, val y: Double)
public data class InspectSize(val w: Double, val h: Double)
public data class InspectRect(val x: Double, val y: Double, val w: Double, val h: Double)
public data class InspectPress(val t: Double, val x: Double, val y: Double)
public data class InspectPin(val at: InspectPoint, val panel: InspectRect)
public enum class InspectGrabKind(public val wire: String) { Move("move"), Resize("resize") }
public data class InspectGrab(val kind: InspectGrabKind, val x: Double, val y: Double, val from: InspectRect)

/** Where a press landed: the page, or a part of the pinned panel. */
public enum class InspectOn(public val wire: String) {
    Page("page"), Panel("panel"), Head("head"), Resize("resize");
    public companion object { public fun of(wire: String?): InspectOn = entries.firstOrNull { it.wire == wire } ?: Page }
}
public enum class InspectPointerType(public val wire: String) {
    Down("down"), Move("move"), Up("up"), Cancel("cancel");
    public companion object { public fun of(wire: String): InspectPointerType? = entries.firstOrNull { it.wire == wire } }
}

public sealed interface InspectEvent {
    public data class Pointer(val type: InspectPointerType, val t: Double, val x: Double, val y: Double, val button: Int = 0, val primary: Boolean = true, val on: InspectOn = InspectOn.Page) : InspectEvent
    public data object Unpin : InspectEvent
    public data class Viewport(val w: Double, val h: Double) : InspectEvent
}

public data class InspectConfig(
    val doubleMs: Double = 320.0,
    val doubleDist: Double = 24.0,
    val offset: Double = 16.0,
    val margin: Double = 4.0,
    val panel: InspectSize = InspectSize(320.0, 280.0),
    val min: InspectSize = InspectSize(200.0, 120.0),
)

public data class InspectState(
    val viewport: InspectSize,
    val pressed: Boolean = false,
    val follow: InspectPoint? = null,
    val last: InspectPress? = null,
    val pin: InspectPin? = null,
    val grab: InspectGrab? = null,
)

/** [look]: hit-test there for the follow panel; [pinned]: a pin was made, hit-test there for it; [consume]: swallow the press. */
public data class InspectResult(val state: InspectState, val look: InspectPoint?, val pinned: InspectPoint?, val consume: Boolean)
