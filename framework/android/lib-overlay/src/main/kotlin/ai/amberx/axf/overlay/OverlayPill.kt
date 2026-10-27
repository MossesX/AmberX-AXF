package ai.amberx.axf.overlay

import ai.amberx.axf.kernel.engine.OverlayEngine
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEyebrow
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp

/**
 * The pill (overlay@1 `pill` + `mini` + `log`), all from theme tokens: a header you drag (grip, title, chips, quick action,
 * mini toggle, hide), the mini screen any app fills (resize corner at its bottom-right), the tappable log panel, and the
 * card slot under it all. Nothing here knows what the chips or lines mean: the app does, through [OverlayHost].
 * Ported from the detection overlay's custom-drawn View (drag strip on top, resize corner, tap-to-tune log) into Compose.
 */
@Composable
internal fun OverlayPill(c: OverlayController) {
    val s by c.state.collectAsState()
    val lines by c.log.lines.collectAsState()
    val mini by c.miniContent.collectAsState()
    val card by c.card.collectAsState()
    val colors = Axf.colors
    val space = Axf.space
    val shape = Axf.shapes.lgShape
    val widthMod = if (s.miniOpen && mini != null) Modifier.width(s.miniSize.width.dp) else Modifier.widthIn(min = s.config.size.minWidth.dp, max = s.config.size.maxWidth.dp)

    Column(Modifier.onSizeChanged { c.reportWindowSize(it.width, it.height) }.then(widthMod)) {
        Column(Modifier.fillMaxWidth().clip(shape).background(colors.surface).border(space.borderWidth, colors.border, shape)) {
            /* header: the drag handle */
            Row(
                Modifier.fillMaxWidth()
                    .pointerInput(s.canDrag) { if (s.canDrag) detectDragGestures { change, drag -> change.consume(); c.moveBy(drag.x, drag.y) } }
                    .padding(horizontal = space.one, vertical = space.half),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(space.half),
            ) {
                AxfIcon(if (s.canDrag) "more-vertical" else "lock", size = 14.dp, tint = colors.muted, contentDescription = if (s.canDrag) "Drag to move" else "Position locked")
                if (s.titleText.isNotEmpty()) AxfText(s.titleText, style = Axf.type.labelMedium, maxLines = 1)
                for (chip in s.resolvedChips) {
                    val tone = chip.tone.takeIf { it != "muted" && it != "neutral" }
                    AxfChip(chip.text, tone = tone, icon = chip.icon.takeIf { it.isNotEmpty() })
                }
                Spacer(Modifier.weight(1f))
                if (s.config.pill.quickAction.isNotEmpty()) AxfIconButton("zap", "Quick action", onClick = { c.quickActionTapped() }, tint = colors.accent, size = 24.dp, iconSize = 14.dp)
                if (mini != null) AxfIconButton(if (s.miniOpen) "chevron-up" else "chevron-down", if (s.miniOpen) "Collapse" else "Expand", onClick = { c.toggleMini() }, size = 24.dp, iconSize = 14.dp)
                AxfIconButton("x", "Hide overlay", onClick = { c.hide() }, size = 24.dp, iconSize = 14.dp)
            }

            /* the mini screen: the app's own content, with the resize corner */
            val miniContent = mini
            if (s.miniOpen && miniContent != null) {
                Box(Modifier.fillMaxWidth().height(s.miniSize.height.dp).padding(horizontal = space.half).clip(Axf.shapes.mdShape).background(colors.bg)) {
                    miniContent()
                    Box(
                        Modifier.align(Alignment.BottomEnd).size(space.touchTarget)
                            .pointerInput(Unit) { detectDragGestures { change, drag -> change.consume(); c.resizeBy(drag.x, drag.y) } },
                        contentAlignment = Alignment.BottomEnd,
                    ) {
                        Box(Modifier.size(space.x(2)).clip(Axf.shapes.smShape).background(colors.accent), contentAlignment = Alignment.Center) {
                            AxfIcon("arrow-down", size = 10.dp, tint = colors.accentText, contentDescription = "Drag to resize")
                        }
                    }
                }
            }

            /* the log panel */
            if (s.logOpen && s.config.log.show) {
                Column(Modifier.fillMaxWidth().padding(horizontal = space.one, vertical = space.half), verticalArrangement = Arrangement.spacedBy(space.x(0.25))) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        AxfEyebrow("Log")
                        Spacer(Modifier.weight(1f))
                        if (lines.isNotEmpty()) AxfText("${lines.size}", style = Axf.type.labelSmall, muted = true)
                    }
                    if (lines.isEmpty()) AxfText("Nothing yet", style = Axf.type.labelSmall, muted = true)
                    val n = lines.size
                    lines.forEachIndexed { i, line ->
                        val tappable = c.log.hasTapHandler()
                        AxfText(
                            OverlayEngine.logLineText(line, s.config.log.showConfidence),
                            Modifier.fillMaxWidth().alpha(OverlayEngine.logLineFade(i, n).toFloat()).then(if (tappable) Modifier.clickable { c.log.tapped(line) } else Modifier),
                            style = Axf.type.labelSmall, mono = true, maxLines = 1,
                        )
                    }
                }
            }
        }

        /* the card slot (tap-to-tune and friends) */
        val cardContent = card
        if (cardContent != null) {
            Box(Modifier.fillMaxWidth().padding(top = space.half).clip(shape).background(colors.surface2).border(space.borderWidth, colors.accent, shape).padding(space.one)) {
                cardContent { c.dismissCard() }
            }
        }
    }
}
