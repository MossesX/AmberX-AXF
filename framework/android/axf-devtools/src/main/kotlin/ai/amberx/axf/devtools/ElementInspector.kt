package ai.amberx.axf.devtools

import ai.amberx.axf.kernel.engine.InspectConfig
import ai.amberx.axf.kernel.engine.InspectEngine
import ai.amberx.axf.kernel.engine.InspectEvent
import ai.amberx.axf.kernel.engine.InspectOn
import ai.amberx.axf.kernel.engine.InspectPoint
import ai.amberx.axf.kernel.engine.InspectPointerType
import ai.amberx.axf.kernel.engine.InspectRect
import ai.amberx.axf.kernel.engine.InspectSize
import ai.amberx.axf.kernel.engine.InspectState
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.kit.AxfIconButton
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.isPrimaryPressed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/**
 * Element inspector for Compose (element-inspector@1, the same pointer model as the web's AshesUI: kernel
 * [InspectEngine], fixture spec/fixtures/element-inspector.json).
 *
 * Wrap a screen in [ElementInspectorHost] and mark what it may show with [Modifier.inspectable]. While `enabled`:
 * left press (a touch, a pen or the main mouse button; other buttons pass through) opens a small panel by the pointer
 * with the innermost marked element under it; drag and the panel follows, updating live; release closes it. A double
 * press pins a panel on that element: drag it by its head, resize it from its corner, × unpins. Each panel shows the
 * element's fields and its current size. Presses that inspect never reach the screen beneath.
 *
 * Colours, shapes, spacing and type come from the active theme (Axf.*), never fixed values.
 */
public class InspectRegistry internal constructor() {
    internal class Entry(val name: String, val fields: () -> List<Pair<String, String>>, val order: Long, val bounds: Rect)
    internal val entries = mutableStateMapOf<Long, Entry>()
    private var next = 1L
    internal fun newId(): Long = next++

    /** The innermost marked element at [p] (root coordinates): the smallest box holding it; ties go to the later one. */
    internal fun at(p: Offset): Long? = entries.entries
        .filter { it.value.bounds.contains(p) }
        .minWithOrNull(compareBy<Map.Entry<Long, Entry>> { it.value.bounds.width * it.value.bounds.height }.thenByDescending { it.value.order })
        ?.key
}

public val LocalInspectRegistry: androidx.compose.runtime.ProvidableCompositionLocal<InspectRegistry?> = staticCompositionLocalOf { null }

/** Marks a composable for the element inspector: its [name] and the [fields] the panel lists (read when shown). */
public fun Modifier.inspectable(name: String, fields: () -> List<Pair<String, String>> = { emptyList() }): Modifier = composed {
    val reg = LocalInspectRegistry.current ?: return@composed Modifier
    val id = remember(reg) { reg.newId() }
    val latestFields by rememberUpdatedState(fields)
    DisposableEffect(reg, id) { onDispose { reg.entries.remove(id) } }
    Modifier.onGloballyPositioned { c ->
        val b = c.boundsInRoot()
        val cur = reg.entries[id]
        if (cur == null || cur.bounds != b || cur.name != name) reg.entries[id] = InspectRegistry.Entry(name, { latestFields() }, id, b)
    }
}

@Composable
public fun ElementInspectorHost(enabled: Boolean, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val reg = remember { InspectRegistry() }
    val density = LocalDensity.current
    val sp = Axf.space
    val cfg = remember(density, sp) {
        with(density) {
            InspectConfig(offset = sp.two.toPx().toDouble(), margin = sp.half.toPx().toDouble(), doubleDist = sp.three.toPx().toDouble(),
                panel = InspectSize(320.dp.toPx().toDouble(), 280.dp.toPx().toDouble()), min = InspectSize(200.dp.toPx().toDouble(), 120.dp.toPx().toDouble()))
        }
    }
    var state by remember { mutableStateOf(InspectEngine.init(InspectSize(0.0, 0.0))) }
    var hostOrigin by remember { mutableStateOf(Offset.Zero) }
    var followId by remember { mutableStateOf<Long?>(null) }
    var pinId by remember { mutableStateOf<Long?>(null) }
    val headPx = with(density) { (sp.touchTarget + sp.half).toPx() }
    val cornerPx = with(density) { sp.touchTarget.toPx() }

    fun partAt(s: InspectState, x: Float, y: Float): InspectOn {
        val r = s.pin?.panel ?: return InspectOn.Page
        val inside = x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
        if (!inside) return InspectOn.Page
        val closeStart = r.x + r.w - cornerPx // the × button stays a button
        return when {
            y <= r.y + headPx && x < closeStart -> InspectOn.Head
            x >= r.x + r.w - cornerPx && y >= r.y + r.h - cornerPx -> InspectOn.Resize
            else -> InspectOn.Panel
        }
    }

    fun hit(p: InspectPoint): Long? = reg.at(Offset(p.x.toFloat(), p.y.toFloat()) + hostOrigin)

    CompositionLocalProvider(LocalInspectRegistry provides reg) {
        Box(
            modifier
                .onGloballyPositioned { hostOrigin = it.positionInRoot() }
                .onSizeChanged { state = InspectEngine.step(state, InspectEvent.Viewport(it.width.toDouble(), it.height.toDouble()), cfg).state }
                .then(if (!enabled) Modifier else Modifier.pointerInput(cfg) {
                    var leftHeld = false
                    awaitPointerEventScope {
                        while (true) {
                            val ev = awaitPointerEvent(PointerEventPass.Initial)
                            val ch = ev.changes.firstOrNull() ?: continue
                            val type = when (ev.type) {
                                PointerEventType.Press -> InspectPointerType.Down
                                PointerEventType.Move -> InspectPointerType.Move
                                PointerEventType.Release -> InspectPointerType.Up
                                else -> null
                            } ?: continue
                            val mouse = ch.type == PointerType.Mouse
                            val left = when (type) {
                                InspectPointerType.Down -> (!mouse || ev.buttons.isPrimaryPressed).also { leftHeld = it }
                                InspectPointerType.Up -> leftHeld.also { if (!mouse || !ev.buttons.isPrimaryPressed) leftHeld = false }
                                else -> true
                            }
                            val x = ch.position.x
                            val y = ch.position.y
                            val on = partAt(state, x, y)
                            val r = InspectEngine.step(state, InspectEvent.Pointer(type, ch.uptimeMillis.toDouble(), x.toDouble(), y.toDouble(), button = if (left) 0 else 2, on = on), cfg)
                            val wasBusy = state.pressed || state.grab != null
                            state = r.state
                            r.look?.let { followId = hit(it) }
                            r.pinned?.let { pinId = hit(it) }
                            if (r.state.follow == null) followId = null
                            if (r.consume || wasBusy || r.state.grab != null) ev.changes.forEach { it.consume() }
                        }
                    }
                }),
        ) {
            content()
            if (enabled) {
                val pin = state.pin
                val pinned = pinId?.let { reg.entries[it] }
                if (pin != null && pinned != null) {
                    InspectPanel(pinned, pin.panel, pinnedPanel = true, origin = hostOrigin, onUnpin = { state = InspectEngine.step(state, InspectEvent.Unpin, cfg).state; pinId = null })
                }
                val at = state.follow
                val followed = followId?.let { reg.entries[it] }
                if (at != null && followed != null) {
                    var size by remember { mutableStateOf(IntSize.Zero) }
                    val p = InspectEngine.followPanel(at, InspectSize(size.width.toDouble(), size.height.toDouble()), state.viewport, cfg)
                    Box(Modifier.offset { IntOffset(p.x.roundToInt(), p.y.roundToInt()) }.onSizeChanged { size = it }) {
                        InspectPanel(followed, null, pinnedPanel = false, origin = hostOrigin, onUnpin = {})
                    }
                }
            }
        }
    }
}

@Composable
private fun InspectPanel(e: InspectRegistry.Entry, rect: InspectRect?, pinnedPanel: Boolean, origin: Offset, onUnpin: () -> Unit) {
    val c = Axf.colors
    val sp = Axf.space
    val density = LocalDensity.current
    val sized = if (rect == null) Modifier.widthIn(max = 320.dp) else with(density) {
        Modifier.offset { IntOffset(rect.x.roundToInt(), rect.y.roundToInt()) }.size(rect.w.toFloat().toDp(), rect.h.toFloat().toDp())
    }
    val box = with(density) { "${e.bounds.width.toDp().value.roundToInt()} × ${e.bounds.height.toDp().value.roundToInt()} dp at ${(e.bounds.left - origin.x).toDp().value.roundToInt()}, ${(e.bounds.top - origin.y).toDp().value.roundToInt()}" }
    Column(
        sized.background(c.surface, Axf.shapes.mdShape).border(sp.borderWidth, if (pinnedPanel) c.accent else c.border, Axf.shapes.mdShape).padding(sp.one),
        verticalArrangement = Arrangement.spacedBy(sp.half),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(sp.half)) {
            AxfText(e.name, Modifier.weight(1f), style = Axf.type.labelLarge, maxLines = 1)
            if (pinnedPanel) AxfIconButton("x", "Unpin", onUnpin)
        }
        Column(if (rect != null) Modifier.weight(1f).verticalScroll(rememberScrollState()) else Modifier, verticalArrangement = Arrangement.spacedBy(sp.x(0.25))) {
            FieldRow("Size", box)
            for ((k, v) in e.fields()) FieldRow(k, v)
        }
        if (pinnedPanel) Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.BottomEnd) { AxfText("⇲", muted = true, style = Axf.type.labelSmall) }
        else AxfText("Double-tap to pin", muted = true, style = Axf.type.labelSmall)
    }
}

@Composable
private fun FieldRow(k: String, v: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfText(k, muted = true, style = Axf.type.bodySmall, maxLines = 1)
        AxfText(v, Modifier.weight(1f), mono = true, maxLines = 2)
    }
}
