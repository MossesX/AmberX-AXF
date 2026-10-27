package ai.amberx.axf.overlay

import ai.amberx.axf.kernel.engine.OverlayEngine
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import kotlinx.coroutines.delay

/**
 * The collapsed strip (overlay@1 `strip`): while the pill is hidden, the last `maxLines` log lines, each for `lineMs`, in
 * the top-left corner; never touchable. Which lines show and when the next one goes is the engine's call
 * (`stripLines` / `nextStripExpiry`); this only draws and sets the timer. Ported from the detection overlay's mini log.
 */
@Composable
internal fun OverlayStrip(c: OverlayController, now: () -> Long = { System.currentTimeMillis() }) {
    val s by c.state.collectAsState()
    val lines by c.log.lines.collectAsState()
    var tick by remember { mutableLongStateOf(now()) }
    val strip = s.config.strip
    val shown = remember(lines, tick, strip) { OverlayEngine.stripLines(lines, tick, strip) }
    LaunchedEffect(lines, tick, strip) {
        val next = OverlayEngine.nextStripExpiry(lines, tick, strip)
        if (next != null) { delay(next); tick = now() }
    }
    if (shown.isEmpty()) return
    val colors = Axf.colors
    val space = Axf.space
    Column(
        Modifier.padding(space.half).clip(Axf.shapes.mdShape).background(colors.surface.copy(alpha = 1f - Axf.theme.opacityTint)).padding(horizontal = space.one, vertical = space.half),
        verticalArrangement = Arrangement.spacedBy(space.x(0.25)),
    ) {
        for (line in shown) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space.half)) {
                Box(Modifier.size(space.x(0.75)).clip(CircleShape).background(colors.success))
                AxfText(line.text, style = Axf.type.labelSmall, mono = true, maxLines = 1)
            }
        }
    }
}
