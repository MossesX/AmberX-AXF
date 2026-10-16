package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.asset.Fill
import ai.amberx.axf.kernel.asset.ShowValue
import ai.amberx.axf.kernel.engine.SliderStyle
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.roundToInt

/**
 * Slider styled by the active `slider` asset: track height, thumb shape (circle / square / bar), fill
 * (solid / gradient / none), ticks and value visibility. Drawn on a Canvas so every number maps exactly
 * to the web's CSS (`--fx-slider-*`). `showValue=HOVER` shows the value while dragging on touch.
 */
@Composable
public fun M3Slider(
    label: String,
    value: Float,
    onChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    min: Float = 0f,
    max: Float = 100f,
    step: Float = 1f,
    unit: String = "",
    enabled: Boolean = true,
    style: SliderStyle = LocalAxfStyles.current.slider,
) {
    val theme = Axf.theme
    val colors = theme.colors
    val density = LocalDensity.current
    var dragging by remember { mutableStateOf(false) }
    val range = (max - min).takeIf { it > 0f } ?: 1f
    val fraction = ((value - min) / range).coerceIn(0f, 1f)
    val thumbH = style.thumb.toFloat().dp
    val thumbW = style.thumbWidth.toFloat().dp
    val trackH = style.track.toFloat().dp
    val canvasH = maxOf(thumbH, 20.dp) + 4.dp
    val valueText = formatSliderValue(value, step) + unit
    val showValue = style.showValue != ShowValue.NEVER
    val valueVisible = style.showValue == ShowValue.ALWAYS || dragging

    fun snap(f: Float): Float {
        val raw = min + f.coerceIn(0f, 1f) * range
        if (step <= 0f) return raw
        return (min + ((raw - min) / step).roundToInt() * step).coerceIn(min, max)
    }

    Column(modifier.alpha(if (enabled) 1f else theme.opacityDisabled), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(label, style = theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.9f), color = colors.text)
            if (showValue) {
                Box(
                    Modifier.alpha(if (valueVisible) 1f else 0f)
                        .background(colors.accentSoft, theme.shapes.smShape)
                        .padding(horizontal = 7.dp, vertical = 1.dp),
                ) { Text(valueText, style = theme.typography.code.copy(fontSize = theme.typography.code.fontSize * 0.98f), color = colors.accent) }
            }
        }
        Canvas(
            Modifier.fillMaxWidth().height(canvasH)
                .semantics {
                    contentDescription = "$label $valueText"
                    progressBarRangeInfo = ProgressBarRangeInfo(value, min..max)
                    setProgress { v -> onChange(snap((v - min) / range)); true }
                }
                .pointerInput(enabled, min, max, step) {
                    if (!enabled) return@pointerInput
                    val tw = with(density) { thumbW.toPx() }
                    detectTapGestures(onPress = { pos -> dragging = true; onChange(snap((pos.x - tw / 2) / (size.width - tw))); tryAwaitRelease(); dragging = false })
                }
                .pointerInput(enabled, min, max, step) {
                    if (!enabled) return@pointerInput
                    val tw = with(density) { thumbW.toPx() }
                    detectDragGestures(onDragStart = { dragging = true }, onDragEnd = { dragging = false }, onDragCancel = { dragging = false }) { change, _ ->
                        change.consume()
                        onChange(snap((change.position.x - tw / 2) / (size.width - tw)))
                    }
                },
        ) {
            val tw = thumbW.toPx(); val th = thumbH.toPx(); val trk = trackH.toPx()
            val usable = size.width - tw
            val cy = size.height / 2
            val x = tw / 2 + usable * fraction
            // track
            drawRoundRect(colors.surface3, topLeft = Offset(0f, cy - trk / 2), size = Size(size.width, trk), cornerRadius = CornerRadius(trk))
            when (style.fill) {
                Fill.GRADIENT -> drawRoundRect(Brush.horizontalGradient(listOf(colors.info, colors.accent), endX = size.width), topLeft = Offset(0f, cy - trk / 2), size = Size(x, trk), cornerRadius = CornerRadius(trk))
                Fill.NONE -> Unit
                else -> drawRoundRect(colors.accent, topLeft = Offset(0f, cy - trk / 2), size = Size(x, trk), cornerRadius = CornerRadius(trk))
            }
            // ticks
            if (style.ticks) {
                for (i in 0..10) {
                    val tx = tw / 2 + usable * (i / 10f)
                    val tall = i % 5 == 0
                    drawLine(if (tall) colors.muted else colors.border, Offset(tx, cy + th / 2 + 1.dp.toPx()), Offset(tx, cy + th / 2 + (if (tall) 8 else 5).dp.toPx()), strokeWidth = 1.dp.toPx())
                }
            }
            // thumb: web uses border-radius % — circle 50%, square radiusSm, bar ~3px
            val scale = if (dragging) 1.15f else 1f
            val w = tw * scale; val h = th * scale
            val r = (style.thumbRadiusPercent / 100.0 * h).toFloat()
            val top = Offset(x - w / 2, cy - h / 2)
            drawRoundRect(colors.shadow.copy(alpha = colors.shadow.alpha * 0.6f), topLeft = top + Offset(0f, 1.dp.toPx()), size = Size(w, h), cornerRadius = CornerRadius(r))
            drawRoundRect(colors.surface, topLeft = top, size = Size(w, h), cornerRadius = CornerRadius(r))
            drawRoundRect(colors.accent, topLeft = top, size = Size(w, h), cornerRadius = CornerRadius(r), style = Stroke(2.dp.toPx()))
        }
    }
}

internal fun formatSliderValue(v: Float, step: Float): String =
    if (step >= 1f || v == v.roundToInt().toFloat()) v.roundToInt().toString() else String.format(java.util.Locale.US, "%.2f", v).trimEnd('0').trimEnd('.')
