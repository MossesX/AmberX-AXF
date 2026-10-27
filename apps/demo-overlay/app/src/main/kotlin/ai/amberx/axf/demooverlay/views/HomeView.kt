package ai.amberx.axf.demooverlay.views

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.LifecycleResumeEffect
import ai.amberx.axf.overlay.Chip
import ai.amberx.axf.overlay.OverlayHost
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfSwitch
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.rememberService
import ai.amberx.axf.ui.theme.Axf

/**
 * lib-overlay demo: one screen that drives every part of [OverlayHost] — permission, show / hide, chips,
 * the tappable log (tap a line → a card under the pill), the mini screen and geometry reset.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeView() {
    val overlay = rememberService<OverlayHost>() ?: run { AxfEmptyState("Overlay isn't installed", icon = "layers", message = "OverlayModule is missing from App.modules()."); return }
    val state by overlay.state.collectAsState()
    val lines by overlay.log.lines.collectAsState()
    var canDraw by remember { mutableStateOf(overlay.canDraw()) }
    LifecycleResumeEffect(overlay) {
        canDraw = overlay.canDraw()
        // The demo's title, chips and log-tap handler: tapping a log line on the pill opens a card under it.
        overlay.setTitle("Overlay demo")
        overlay.setChips(DEMO_CHIPS)
        overlay.log.onTap { line ->
            overlay.setCard { dismiss ->
                Column(Modifier.padding(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
                    AxfText("You tapped", muted = true, style = Axf.type.labelMedium)
                    AxfText(line.text, style = Axf.type.titleSmall)
                    AxfText("tag: ${line.tag.ifEmpty { "none" }} · confidence: ${line.confidence?.let { "${(it * 100).toInt()} %" } ?: "n/a"}", muted = true)
                    AxfButton("Close", dismiss, tone = ButtonTone.GHOST, icon = "x")
                }
            }
        }
        onPauseOrDispose { }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfCard(Modifier.fillMaxWidth(), title = "What this shows", icon = "info") {
            AxfText("lib-overlay draws a floating pill over other apps. Any module can put status chips on it, log lines into its panel, fill its mini screen with a composable and show a card under it. Turn it on here, then leave the app: the pill stays.")
        }

        AxfCard(Modifier.fillMaxWidth(), title = "1 · Permission", icon = "shield") {
            AxfText(if (canDraw) "Drawing over other apps is allowed." else "Android needs \"Display over other apps\" once.", muted = canDraw)
            if (!canDraw) AxfButton("Allow drawing over other apps", { overlay.requestPermission() }, tone = ButtonTone.PRIMARY, icon = "external")
        }

        AxfCard(Modifier.fillMaxWidth(), title = "2 · Show the pill", icon = "layers") {
            AxfText(if (state.shown) "On screen now." else if (state.visible) "Wants to show (waiting for the permission)." else "Hidden.", muted = true)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Show", { overlay.show() }, tone = ButtonTone.PRIMARY, icon = "eye", enabled = canDraw)
                AxfButton("Hide", { overlay.hide() }, icon = "minus")
                AxfButton("Reset position", { overlay.resetGeometry() }, tone = ButtonTone.GHOST, icon = "refresh")
            }
        }

        AxfCard(Modifier.fillMaxWidth(), title = "3 · Status chips", icon = "tag") {
            AxfText("Each chip shows its on or off label. Flip them here and watch the pill.", muted = true)
            for (chip in DEMO_CHIPS) {
                AxfSwitch(state.chipStates[chip.id] ?: chip.on, { overlay.setChip(chip.id, it) }, Modifier.fillMaxWidth(), label = chip.label, description = "Off: \"${chip.offLabel}\"")
            }
        }

        LogCard(overlay, lines.size)

        AxfCard(Modifier.fillMaxWidth(), title = "5 · Mini screen", icon = "box") {
            AxfText("Any composable can fill the pill's mini screen. This one is a counter you can tap from over another app.", muted = true)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Put a counter in it", { overlay.setMiniContent { MiniCounter() }; overlay.openMini(true) }, icon = "plus")
                AxfButton(if (state.miniOpen) "Collapse" else "Expand", { overlay.toggleMini() }, tone = ButtonTone.GHOST, icon = "layout")
                AxfButton("Empty it", { overlay.setMiniContent(null) }, tone = ButtonTone.GHOST, icon = "x")
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LogCard(overlay: OverlayHost, count: Int) {
    var text by remember { mutableStateOf("swipe up") }
    var n by remember { mutableIntStateOf(0) }
    AxfCard(Modifier.fillMaxWidth(), title = "4 · Log panel", icon = "list") {
        AxfText("Lines go into the panel under the pill (and flash in the corner strip while it is hidden). Tap a line on the pill to open a card about it.", muted = true)
        AxfTextField(text, { text = it }, Modifier.fillMaxWidth(), label = "Line")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton("Add line", {
                n++
                val confidence = listOf(0.92, 0.64, 0.41)[n % 3]
                overlay.log.add(text.ifBlank { "line $n" }, confidence = confidence, tag = if (confidence >= 0.6) "fired" else "below", ref = "demo.$n")
            }, tone = ButtonTone.PRIMARY, icon = "plus")
            AxfButton("Clear", { overlay.log.clear() }, tone = ButtonTone.GHOST, icon = "trash")
        }
        AxfText("$count line(s) in the panel.", muted = true)
    }
}

/** Drawn inside the overlay window (theme tokens come from the overlay's own root). */
@Composable
private fun MiniCounter() {
    var count by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize().padding(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
        AxfText("Tapped $count time(s)", style = Axf.type.titleSmall)
        AxfButton("Tap", { count++ }, tone = ButtonTone.PRIMARY, icon = "plus")
    }
}

private val DEMO_CHIPS = listOf(
    Chip("armed", "Armed", "Idle", tone = "success", icon = "zap"),
    Chip("mic", "Mic on", "Mic off", tone = "info", icon = "mic"),
)
