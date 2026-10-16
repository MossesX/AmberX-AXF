package ai.amberx.axf.ui.components

import ai.amberx.axf.ui.theme.Axf
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow

/** Body text in the theme's text color. `muted` for secondary copy, `mono` for code/ids. */
@Composable
public fun AxfText(text: String, modifier: Modifier = Modifier, style: TextStyle = Axf.type.bodyMedium, color: Color = Color.Unspecified, muted: Boolean = false, mono: Boolean = false, maxLines: Int = Int.MAX_VALUE) {
    val c = Axf.colors
    Text(text, modifier, style = if (mono) Axf.type.code else style, color = if (color != Color.Unspecified) color else if (muted) c.muted else c.text, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

/** Heading with the style theme's heading weight and tracking. `level` 1..4 → headlineMedium, titleLarge, titleMedium, titleSmall. */
@Composable
public fun AxfHeading(text: String, modifier: Modifier = Modifier, level: Int = 2) {
    val t = Axf.type
    val style = when (level) { 1 -> t.headlineMedium; 2 -> t.titleLarge; 3 -> t.titleMedium; else -> t.titleSmall }
    Text(text, modifier, style = style.copy(fontWeight = t.headingWeight, fontFamily = t.display), color = Axf.colors.text)
}

/** Small uppercase label (web `.fx-eyebrow`). */
@Composable
public fun AxfEyebrow(text: String, modifier: Modifier = Modifier, accent: Boolean = false) {
    Text(text.uppercase(), modifier, style = Axf.type.eyebrow, color = if (accent) Axf.colors.accent else Axf.colors.muted)
}
