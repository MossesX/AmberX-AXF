package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.asset.Backdrop
import ai.amberx.axf.kernel.asset.DialogAnim
import ai.amberx.axf.kernel.asset.DialogVariant
import ai.amberx.axf.kernel.asset.HeaderStyle
import ai.amberx.axf.kernel.asset.PopupPosition
import ai.amberx.axf.kernel.asset.PopupVariant
import ai.amberx.axf.kernel.engine.DialogStyle
import ai.amberx.axf.kernel.engine.PopupStyle
import ai.amberx.axf.kernel.engine.WindowClass
import ai.amberx.axf.kernel.runtime.Toast
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.DialogContribution
import ai.amberx.axf.ui.LocalAxfLayout
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.runtime.key
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import kotlinx.coroutines.delay

/* ---------------- DialogHost (dialog asset) ---------------- */

/**
 * Renders `state.dialog` through the registered [DialogContribution]s, styled by the active `dialog`
 * asset: modal (centered, max width), drawer (right edge, full height), sheet (bottom); backdrop
 * dim / blur / none; animation scale / slide / fade; header plain / accent-bar / filled / divided.
 * Unknown dialog ids close themselves with a toast, like the web host.
 */
@Composable
public fun AxfDialogHost(dialogs: Map<String, DialogContribution>, style: DialogStyle = LocalAxfStyles.current.dialog) {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val open = state.dialog ?: return
    val def = dialogs[open.id]
    if (def == null) {
        LaunchedEffect(open.id) { runtime.closeDialog(); runtime.toast("No dialog is registered as \"${open.id}\".", ToastKind.WARNING) }
        return
    }
    val theme = Axf.theme
    val c = theme.colors
    val compact = LocalAxfLayout.current.windowClass == WindowClass.COMPACT
    val variant = if (compact && style.variant == DialogVariant.DRAWER) DialogVariant.SHEET else style.variant
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(open.id) { visible = true }
    val close: () -> Unit = { runtime.closeDialog() }

    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = true, dismissOnClickOutside = style.closeOnBackdrop, decorFitsSystemWindows = false)) {
        val backdropColor = when (style.backdrop) { Backdrop.DIM -> c.scrim; Backdrop.BLUR -> c.bg.copy(alpha = 0.4f); Backdrop.NONE -> c.scrim.copy(alpha = 0f) }
        Box(
            Modifier.fillMaxSize().background(backdropColor)
                .then(if (style.closeOnBackdrop) Modifier.pointerInput(Unit) { detectTapGestures { close() } } else Modifier),
            contentAlignment = when (variant) { DialogVariant.MODAL -> Alignment.Center; DialogVariant.DRAWER -> Alignment.CenterEnd; DialogVariant.SHEET -> Alignment.BottomCenter },
        ) {
            val dur = theme.motion.overlay
            val enter = when (variant) {
                DialogVariant.DRAWER -> slideInHorizontally(tween(dur, easing = theme.motion.easing)) { it / 2 } + fadeIn(tween(dur))
                DialogVariant.SHEET -> slideInVertically(tween(dur, easing = theme.motion.easing)) { it / 2 } + fadeIn(tween(dur))
                DialogVariant.MODAL -> when (style.animation) {
                    DialogAnim.SCALE -> scaleIn(tween(dur), initialScale = 0.94f) + fadeIn(tween(dur))
                    DialogAnim.SLIDE -> slideInVertically(tween(dur)) { 40 } + fadeIn(tween(dur))
                    DialogAnim.FADE -> fadeIn(tween(dur))
                }
            }
            val exit = when (variant) {
                DialogVariant.DRAWER -> slideOutHorizontally(tween(dur)) { it / 2 } + fadeOut(tween(dur))
                DialogVariant.SHEET -> slideOutVertically(tween(dur)) { it / 2 } + fadeOut(tween(dur))
                DialogVariant.MODAL -> if (style.animation == DialogAnim.SCALE) scaleOut(tween(dur), targetScale = 0.94f) + fadeOut(tween(dur)) else fadeOut(tween(dur))
            }
            AnimatedVisibility(visible, enter = enter, exit = exit) {
                val r = theme.shapes.lg
                val shape: Shape = when (variant) {
                    DialogVariant.MODAL -> RoundedCornerShape(r)
                    DialogVariant.DRAWER -> RoundedCornerShape(topStart = r, bottomStart = r)
                    DialogVariant.SHEET -> RoundedCornerShape(topStart = r, topEnd = r)
                }
                val width = style.width.toFloat().dp
                Column(
                    Modifier
                        .then(when (variant) {
                            DialogVariant.MODAL -> Modifier.padding(16.dp).widthIn(max = width).fillMaxWidth().heightIn(max = 760.dp)
                            DialogVariant.DRAWER -> Modifier.widthIn(max = width).fillMaxWidth(if (compact) 1f else 0.5f).fillMaxHeight()
                            DialogVariant.SHEET -> Modifier.widthIn(max = width).fillMaxWidth().heightIn(max = 760.dp)
                        })
                        .pointerInput(Unit) { detectTapGestures { } } // swallow taps so the backdrop handler does not close
                        .shadow(theme.elevation(5), shape, ambientColor = c.shadow, spotColor = c.shadow)
                        .clip(shape)
                        .background(c.surface, shape)
                        .border(theme.spacing.borderWidth, c.border, shape)
                        .then(if (style.header == HeaderStyle.ACCENT_BAR) Modifier.drawBehind { drawRect(c.accent, size = Size(size.width, 4.dp.toPx())) }.padding(top = 4.dp) else Modifier)
                        .then(if (variant == DialogVariant.SHEET) Modifier.navigationBarsPadding() else if (variant == DialogVariant.DRAWER) Modifier.statusBarsPadding().navigationBarsPadding() else Modifier)
                        .semantics { paneTitle = def.title },
                ) {
                    val filled = style.header == HeaderStyle.FILLED
                    val headFg = if (filled) c.accentText else c.text
                    Row(
                        Modifier.fillMaxWidth()
                            .then(if (filled) Modifier.background(c.accent) else Modifier)
                            .padding(horizontal = theme.spacing.two, vertical = theme.spacing.x(1.6))
                            .then(if (!filled) Modifier.drawBottomBorder(c.border, theme.spacing.borderWidth) else Modifier),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        if (def.icon != null) AxfIcon(def.icon, size = 18.dp, tint = if (filled) c.accentText else c.accent, contentDescription = null)
                        Text(def.title, style = theme.typography.titleSmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 1.1f), color = headFg, modifier = Modifier.weight(1f))
                        AxfIconButton("x", "Close dialog", onClick = close, tint = if (filled) c.accentText else c.muted)
                    }
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(theme.spacing.two)) { def.content(open) }
                }
            }
        }
    }
}

/* ---------------- ToastHost (popup asset) ---------------- */

private fun toastIcon(kind: ToastKind): String = when (kind) { ToastKind.INFO -> "info"; ToastKind.SUCCESS -> "check-circle"; ToastKind.WARNING -> "alert"; ToastKind.DANGER -> "x-circle" }

/**
 * Renders `state.toasts` per the active `popup` asset: position (top/bottom × right/center; phones
 * always stack at the top-center like the web), variant solid / outline / minimal, icon, max visible.
 * Each toast schedules `runtime.dismissToast` after `durationMs`.
 */
@Composable
public fun AxfToastHost(style: PopupStyle = LocalAxfStyles.current.popup) {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val theme = Axf.theme
    val compact = LocalAxfLayout.current.windowClass == WindowClass.COMPACT
    val position = if (compact) PopupPosition.TOP_CENTER else style.position
    val bottom = position == PopupPosition.BOTTOM_RIGHT || position == PopupPosition.BOTTOM_CENTER
    val align = when (position) {
        PopupPosition.TOP_RIGHT -> Alignment.TopEnd; PopupPosition.BOTTOM_RIGHT -> Alignment.BottomEnd
        PopupPosition.TOP_CENTER -> Alignment.TopCenter; PopupPosition.BOTTOM_CENTER -> Alignment.BottomCenter
    }
    val toasts = state.toasts.takeLast(style.maxVisible.coerceAtLeast(1))
    Box(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(16.dp).zIndex(90f), contentAlignment = align) {
        Column(Modifier.widthIn(max = 360.dp).semantics { liveRegion = LiveRegionMode.Polite }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (t in if (bottom) toasts.reversed() else toasts) {
                key(t.id) {
                    LaunchedEffect(t.id) { delay(style.durationMs.toLong().coerceAtLeast(500)); runtime.dismissToast(t.id) }
                    AxfToast(t, style, onDismiss = { runtime.dismissToast(t.id) })
                }
            }
        }
    }
}

/** One toast card. Public so galleries can preview each variant/kind. */
@Composable
public fun AxfToast(toast: Toast, style: PopupStyle, modifier: Modifier = Modifier, onDismiss: (() -> Unit)? = null) {
    val theme = Axf.theme
    val c = theme.colors
    val tone = c.tone(toast.kind.name)
    val solid = style.variant == PopupVariant.SOLID
    val bg = if (solid) c.text else c.surface
    val fg = if (solid) c.bg else c.text
    val shape = theme.shapes.mdShape
    Row(
        modifier.fillMaxWidth()
            .shadow(theme.elevation(4), shape, ambientColor = c.shadow, spotColor = c.shadow)
            .clip(shape).background(bg, shape)
            .then(when (style.variant) {
                PopupVariant.OUTLINE -> Modifier.border(1.5.dp, tone, shape)
                PopupVariant.MINIMAL -> Modifier.border(theme.spacing.borderWidth, c.border, shape).drawStartBar(tone, 3.dp)
                PopupVariant.SOLID -> Modifier
            })
            .semantics { contentDescription = listOfNotNull(toast.title, toast.message).joinToString(": ") }
            .padding(start = 12.dp, top = 10.dp, end = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (style.showIcon) AxfIcon(toastIcon(toast.kind), size = 18.dp, tint = tone, contentDescription = null, modifier = Modifier.padding(top = 1.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            if (toast.title != null) Text(toast.title!!, style = theme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold, fontSize = theme.typography.bodyMedium.fontSize * 0.92f), color = fg)
            Text(toast.message, style = theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.92f), color = fg)
        }
        if (onDismiss != null) AxfIconButton("x", "Dismiss", onClick = onDismiss, tint = if (solid) fg.copy(alpha = 0.7f) else c.muted, size = 22.dp, iconSize = 14.dp)
    }
}

internal fun Modifier.drawStartBar(color: Color, width: Dp): Modifier = this.drawBehind {
    drawRect(color, size = Size(width.toPx(), size.height))
}
