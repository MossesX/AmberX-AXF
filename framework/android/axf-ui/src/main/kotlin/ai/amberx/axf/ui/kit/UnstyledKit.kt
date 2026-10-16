package ai.amberx.axf.ui.kit

import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.kernel.contract.UiKitSpec
import ai.amberx.axf.kernel.engine.ButtonStyle
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * A second, deliberately minimal kit built on Compose foundation only (no material3), proving that
 * switching the `ui-kit` asset changes which library renders the components. Covers a subset; the
 * rest falls back to Material 3 through [AxfUiKits.kitFor].
 */
public object UnstyledKit : AxfUiKit {
    override val spec: UiKitSpec = UiKitSpec(
        "unstyled", "Unstyled (foundation)", "androidx.compose.foundation",
        covers = setOf(ComponentKind.BUTTON, ComponentKind.ICON_BUTTON, ComponentKind.SWITCH, ComponentKind.CHECKBOX, ComponentKind.CHIP, ComponentKind.BADGE, ComponentKind.SECTION_HEADER, ComponentKind.DIVIDER),
    )
    override val components: AxfComponents = object : DefaultComponents() {
        @Composable override fun Button(text: String?, onClick: () -> Unit, modifier: Modifier, tone: ButtonTone, icon: String?, requires: String?, enabled: Boolean, style: ButtonStyle, contentDescription: String?) {
            val c = Axf.colors
            val gate = LocalAxfUac.current.gate(requires)
            if (gate == Gate.HIDE) return
            val on = enabled && gate == Gate.ALLOW
            val bg = when (tone) { ButtonTone.PRIMARY -> c.accent; ButtonTone.DANGER -> c.danger; ButtonTone.GHOST -> Color.Transparent; ButtonTone.NEUTRAL -> c.surface2 }
            val fg = when (tone) { ButtonTone.PRIMARY -> c.accentText; ButtonTone.DANGER -> c.onDanger; else -> c.text }
            Row(
                modifier.clip(RoundedCornerShape(style.radius.dp)).background(bg).border(1.dp, c.border, RoundedCornerShape(style.radius.dp)).clickable(enabled = on, onClick = onClick).alpha(if (on) 1f else 0.5f).padding(horizontal = style.paddingX.dp, vertical = style.paddingY.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (icon != null) AxfIcon(icon, size = 16.dp, tint = fg, contentDescription = null)
                if (text != null) BasicText(if (style.uppercase) text.uppercase() else text, style = TextStyle(color = fg, fontWeight = FontWeight(style.weight), fontSize = Axf.type.bodyMedium.fontSize))
            }
        }
        @Composable override fun IconButton(icon: String, contentDescription: String, onClick: () -> Unit, modifier: Modifier, enabled: Boolean, requires: String?, tint: Color, size: Dp, iconSize: Dp, active: Boolean) {
            val gate = LocalAxfUac.current.gate(requires); if (gate == Gate.HIDE) return
            Box(modifier.size(size).clip(RoundedCornerShape(4.dp)).background(if (active) Axf.colors.accentSoft else Color.Transparent).clickable(enabled = enabled && gate == Gate.ALLOW, onClick = onClick), contentAlignment = Alignment.Center) { AxfIcon(icon, size = iconSize, tint = tint, contentDescription = contentDescription) }
        }
        @Composable override fun Switch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier, label: String?, description: String?, enabled: Boolean) {
            val c = Axf.colors
            Row(modifier.fillMaxWidth().clickable(enabled = enabled) { onCheckedChange(!checked) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                if (label != null) BasicText(label, style = Axf.type.bodyMedium.copy(color = c.text), modifier = Modifier.weight(1f))
                Box(Modifier.size(width = 36.dp, height = 20.dp).clip(RoundedCornerShape(10.dp)).background(if (checked) c.accent else c.surface3).border(1.dp, c.border, RoundedCornerShape(10.dp)), contentAlignment = if (checked) Alignment.CenterEnd else Alignment.CenterStart) {
                    Box(Modifier.padding(2.dp).size(16.dp).clip(RoundedCornerShape(8.dp)).background(if (checked) c.accentText else c.muted))
                }
            }
        }
        @Composable override fun Checkbox(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier, label: String?, enabled: Boolean) {
            val c = Axf.colors
            Row(modifier.clickable(enabled = enabled) { onCheckedChange(!checked) }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(18.dp).clip(RoundedCornerShape(3.dp)).background(if (checked) c.accent else c.surface).border(1.dp, if (checked) c.accent else c.border, RoundedCornerShape(3.dp)), contentAlignment = Alignment.Center) { if (checked) AxfIcon("check", size = 14.dp, tint = c.accentText, contentDescription = null) }
                if (label != null) BasicText(label, style = Axf.type.bodyMedium.copy(color = c.text))
            }
        }
        @Composable override fun Chip(text: String, modifier: Modifier, tone: String?, icon: String?, selected: Boolean, onClick: (() -> Unit)?) {
            val c = Axf.colors
            val bg = if (selected) c.accent else if (tone != null) c.toneSoft(tone) else c.surface2
            val fg = if (selected) c.accentText else if (tone != null) c.tone(tone) else c.text
            Row(modifier.clip(RoundedCornerShape(999.dp)).background(bg).then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (icon != null) AxfIcon(icon, size = 12.dp, tint = fg, contentDescription = null)
                BasicText(text, style = Axf.type.labelMedium.copy(color = fg))
            }
        }
        @Composable override fun Badge(text: String, modifier: Modifier, tone: String) {
            val c = Axf.colors
            Box(modifier.clip(RoundedCornerShape(999.dp)).background(c.tone(tone)).padding(horizontal = 6.dp, vertical = 1.dp)) { BasicText(text, style = Axf.type.labelSmall.copy(color = if (tone == "accent") c.accentText else c.inverseText)) }
        }
        @Composable override fun SectionHeader(text: String, modifier: Modifier, accent: Boolean) {
            BasicText(text.uppercase(), modifier = modifier.padding(vertical = 6.dp), style = Axf.type.labelSmall.copy(color = if (accent) Axf.colors.accent else Axf.colors.muted, letterSpacing = androidx.compose.ui.unit.TextUnit(0.08f, androidx.compose.ui.unit.TextUnitType.Em)))
        }
        @Composable override fun Divider(modifier: Modifier) { Box(modifier.fillMaxWidth().height(1.dp).background(Axf.colors.border)) }
    }
}
