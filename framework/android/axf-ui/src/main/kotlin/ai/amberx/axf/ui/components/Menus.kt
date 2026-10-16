package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.asset.ContextVariant
import ai.amberx.axf.kernel.asset.MenuItem
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlin.math.roundToInt

/**
 * Shared renderer for dropdown and context menus (web MenuList): UAC-filtered through the runtime, nested
 * submenus expand inline (the phone behaviour of the web CSS), separators, icons, shortcut hints.
 * `rowHeight`/`compact` come from the context-menu style when used by the context host.
 */
@Composable
public fun AxfMenuList(
    items: List<MenuItem>,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
    payload: String? = null,
    showIcons: Boolean = true,
    showShortcuts: Boolean = true,
    rowHeight: Dp? = null,
    dense: Boolean = false,
    depth: Int = 0,
) {
    val runtime = LocalAxfRuntime.current
    val uac = LocalAxfUac.current
    val actions = LocalAxfActions.current
    val theme = Axf.theme
    val c = theme.colors
    LocalAxfState.current // subscribe so gating recomposes on role change
    val visible = remember(items, uac.role) { runtime.filterMenu(items) }
    var openSub by remember { mutableStateOf<String?>(null) }
    val padV = if (dense) 4.dp else 6.dp
    val fontScale = if (dense) 0.88f else 0.93f

    Column(modifier.padding(start = (18 * depth).dp)) {
        for (item in visible) {
            if (item.separator) { Box(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp).height(theme.spacing.borderWidth).background(c.border)); continue }
            val locked = uac.gate(item.requires) == Gate.DISABLE
            val hasSub = item.items.isNotEmpty()
            Row(
                Modifier.fillMaxWidth().then(if (rowHeight != null) Modifier.heightIn(min = rowHeight) else Modifier.heightIn(min = theme.spacing.touchTarget * 0.8f))
                    .clip(theme.shapes.of((theme.shapes.md.value - 3).toDouble().coerceAtLeast(0.0)))
                    .clickable(enabled = !locked, role = Role.Button) {
                        if (hasSub) openSub = if (openSub == item.id) null else item.id
                        else { onDone(); item.action?.let { actions.dispatch(it, payload) } }
                    }
                    .alpha(if (locked) 0.45f else 1f)
                    .padding(horizontal = 8.dp, vertical = padV),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (showIcons) Box(Modifier.width(16.dp), contentAlignment = Alignment.Center) { AxfIcon(if (locked) "lock" else item.icon, size = if (locked) 14.dp else 15.dp, tint = c.muted, contentDescription = null) }
                Text(item.label ?: item.id, style = theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * fontScale), color = c.text, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (showShortcuts && item.shortcut != null) AxfKbd(item.shortcut!!)
                if (hasSub) AxfIcon(if (openSub == item.id) "chevron-down" else "chevron-right", size = 14.dp, tint = c.muted, contentDescription = null)
            }
            if (hasSub && openSub == item.id) {
                AxfMenuList(item.items, onDone, Modifier, payload, showIcons, showShortcuts, rowHeight, dense, depth + 1)
            }
        }
    }
}

/** Web `.fx-popover`: surface, border, md radius, lg shadow. */
@Composable
public fun AxfPopover(modifier: Modifier = Modifier, glass: Boolean = false, minWidth: Dp = 230.dp, content: @Composable () -> Unit) {
    val theme = Axf.theme
    val c = theme.colors
    Box(
        modifier.widthIn(min = minWidth, max = 360.dp)
            .shadow(theme.elevation(4), theme.shapes.mdShape, ambientColor = c.shadow, spotColor = c.shadow)
            .clip(theme.shapes.mdShape)
            .background(if (glass) c.surface.copy(alpha = 0.62f) else c.surface, theme.shapes.mdShape)
            .border(theme.spacing.borderWidth, c.border, theme.shapes.mdShape)
            .padding(4.dp),
    ) { content() }
}

/**
 * Makes any composable a context-menu host (web `data-fx-ctx-target`): a long-press opens the active
 * context-menu asset's items for `target` with `{payload}` substituted. The popup itself is rendered
 * by [AxfContextMenuHost], which AxfRoot installs once.
 */
public fun Modifier.axfContextMenu(target: String, payload: String? = null): Modifier = composed {
    val runtime = LocalAxfRuntime.current
    var origin by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
    this.onGloballyPositioned { origin = it.positionInRoot() }
        .pointerInput(target, payload) {
            detectTapGestures(onLongPress = { pos -> runtime.openContext(origin.x + pos.x, origin.y + pos.y, target, payload) })
        }
}

/**
 * Renders `runtime.state.context` as a popup at the press position, styled by the context-menu asset
 * (compact / roomy / glass; icons; shortcuts). Clamped inside the window; tapping outside or picking an item closes it.
 */
@Composable
public fun AxfContextMenuHost() {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val ctx = state.context ?: return
    val style = LocalAxfStyles.current.contextMenu
    val theme = Axf.theme
    val density = LocalDensity.current
    val items = remember(ctx, state.role) { runtime.contextItems(ctx.target, ctx.payload) }
    val scale by animateFloatAsState(1f, tween(theme.motion.fast), label = "ctx")
    val margin = with(density) { 8.dp.roundToPx() }
    val provider = remember(ctx, margin) {
        object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset {
                val x = (anchorBounds.left + ctx.x.roundToInt()).coerceIn(margin, (windowSize.width - popupContentSize.width - margin).coerceAtLeast(margin))
                val y = (anchorBounds.top + ctx.y.roundToInt()).coerceIn(margin, (windowSize.height - popupContentSize.height - margin).coerceAtLeast(margin))
                return IntOffset(x, y)
            }
        }
    }

    Popup(
        popupPositionProvider = provider,
        onDismissRequest = { runtime.closeContext() },
        properties = PopupProperties(focusable = true, dismissOnBackPress = true, dismissOnClickOutside = true),
    ) {
        Box(Modifier.graphicsLayer { scaleX = scale; scaleY = scale; transformOrigin = TransformOrigin(0f, 0f) }) {
            AxfPopover(glass = style.variant == ContextVariant.GLASS, minWidth = style.minWidth.toFloat().dp) {
                Column(Modifier.verticalScroll(rememberScrollState()).padding(if (style.variant == ContextVariant.ROOMY) 2.dp else 0.dp)) {
                    if (items.isEmpty()) Text("No actions here", style = theme.typography.bodySmall, color = theme.colors.muted, modifier = Modifier.padding(10.dp))
                    else AxfMenuList(items, onDone = { runtime.closeContext() }, payload = ctx.payload, showIcons = style.showIcons, showShortcuts = style.showShortcuts, rowHeight = style.rowHeight.toFloat().dp, dense = style.variant == ContextVariant.COMPACT)
                }
            }
        }
    }
}
