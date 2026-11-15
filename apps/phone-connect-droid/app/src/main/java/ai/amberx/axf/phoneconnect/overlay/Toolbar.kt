package ai.amberx.axf.phoneconnect.overlay

import ai.amberx.axf.ui.components.M3Badge
import ai.amberx.axf.ui.components.M3IconButton
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** The collapsed overlay: a small draggable button with the badge count. Tap expands it; drag moves it. */
@Composable
fun FloatingButton(config: OverlayConfig, badge: Int, onTap: () -> Unit, onDrag: (dx: Float, dy: Float) -> Unit, onDragEnd: () -> Unit) {
    val shape = when (config.buttonShape) { "square" -> Axf.shapes.smShape; "rounded" -> Axf.shapes.lgShape; else -> Axf.shapes.full }
    Box(
        Modifier
            .size(config.buttonSize.dp)
            .alpha(config.toolbarOpacity)
            .clip(shape)
            .background(Axf.colors.accent, shape)
            .border(Axf.space.borderWidth, Axf.colors.border, shape)
            .pointerInput(Unit) { detectDragGestures(onDragEnd = onDragEnd) { change, d -> change.consume(); onDrag(d.x, d.y) } }
            .clickable(onClick = onTap)
            .semantics { contentDescription = if (badge > 0) "Phone Connect, $badge waiting" else "Phone Connect" },
        contentAlignment = Alignment.Center,
    ) {
        AxfIcon("smartphone", tint = Axf.colors.accentText, size = Axf.space.iconSize)
        if (badge > 0) M3Badge(if (badge > 99) "99+" else badge.toString(), Modifier.align(Alignment.TopEnd), tone = "danger")
    }
}

/** The expanded overlay: the configured buttons and widgets in one row, and collapse. */
@Composable
fun FloatingToolbar(config: OverlayConfig, badge: Int, buildStatus: String, onAction: (String) -> Unit) {
    Row(
        Modifier
            .alpha(config.toolbarOpacity)
            .clip(Axf.shapes.lgShape)
            .background(Axf.colors.surface, Axf.shapes.lgShape)
            .border(Axf.space.borderWidth, Axf.colors.border, Axf.shapes.lgShape)
            .padding(Axf.space.half)
            .semantics { contentDescription = "Phone Connect toolbar" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (item in config.items) {
            Box {
                M3IconButton(item.icon, item.label, onClick = { onAction(item.action) }, tint = if (item.action == "approvals" && badge > 0) Axf.colors.accent else Axf.colors.text)
                if (item.action == "approvals" && badge > 0) M3Badge(badge.toString(), Modifier.align(Alignment.TopEnd), tone = "danger")
                if (item.kind == "widget" && item.action == "build-status" && buildStatus.isNotEmpty()) M3Badge(buildStatus, Modifier.align(Alignment.BottomCenter), tone = if (buildStatus == "red") "danger" else "success")
            }
        }
        M3IconButton("minimize", "Collapse", onClick = { onAction("collapse") })
    }
}

