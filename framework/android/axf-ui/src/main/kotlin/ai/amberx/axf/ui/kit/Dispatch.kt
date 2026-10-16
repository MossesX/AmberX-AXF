package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.kernel.engine.ButtonStyle
import ai.amberx.axf.kernel.engine.ContainerStyle
import ai.amberx.axf.kernel.engine.SliderStyle
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.kit.kitFor
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/* The public component API. Each one dispatches to the active UI kit (see ai.amberx.axf.ui.kit). */

@Composable
public fun AxfButton(text: String?, onClick: () -> Unit, modifier: Modifier = Modifier, tone: ButtonTone = ButtonTone.NEUTRAL, icon: String? = null, requires: String? = null, enabled: Boolean = true, style: ButtonStyle = LocalAxfStyles.current.button, contentDescription: String? = null): Unit =
    kitFor(ComponentKind.BUTTON).Button(text, onClick, modifier, tone, icon, requires, enabled, style, contentDescription)

@Composable
public fun AxfIconButton(icon: String, contentDescription: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, requires: String? = null, tint: Color = Axf.colors.muted, size: Dp = 26.dp, iconSize: Dp = 16.dp, active: Boolean = false): Unit =
    kitFor(ComponentKind.ICON_BUTTON).IconButton(icon, contentDescription, onClick, modifier, enabled, requires, tint, size, iconSize, active)

@Composable
public fun AxfTextField(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier, label: String? = null, placeholder: String? = null, leadingIcon: String? = null, enabled: Boolean = true, singleLine: Boolean = true, minLines: Int = 1, secret: Boolean = false, monospace: Boolean = false, error: String? = null, keyboardOptions: KeyboardOptions = KeyboardOptions.Default, keyboardActions: KeyboardActions = KeyboardActions.Default): Unit =
    kitFor(if (secret) ComponentKind.PASSWORD_FIELD else ComponentKind.TEXT_FIELD).TextField(value, onValueChange, modifier, label, placeholder, leadingIcon, enabled, singleLine, minLines, secret, monospace, error, keyboardOptions, keyboardActions)

@Composable
public fun AxfSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, label: String? = null, description: String? = null, enabled: Boolean = true): Unit =
    kitFor(ComponentKind.SWITCH).Switch(checked, onCheckedChange, modifier, label, description, enabled)

@Composable
public fun AxfCheckbox(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, label: String? = null, enabled: Boolean = true): Unit =
    kitFor(ComponentKind.CHECKBOX).Checkbox(checked, onCheckedChange, modifier, label, enabled)

@Composable
public fun AxfChip(text: String, modifier: Modifier = Modifier, tone: String? = null, icon: String? = null, selected: Boolean = false, onClick: (() -> Unit)? = null): Unit =
    kitFor(ComponentKind.CHIP).Chip(text, modifier, tone, icon, selected, onClick)

@Composable
public fun AxfBadge(text: String, modifier: Modifier = Modifier, tone: String = "accent"): Unit = kitFor(ComponentKind.BADGE).Badge(text, modifier, tone)

@Composable
public fun AxfSlider(label: String, value: Float, onChange: (Float) -> Unit, modifier: Modifier = Modifier, min: Float = 0f, max: Float = 100f, step: Float = 1f, unit: String = "", enabled: Boolean = true, style: SliderStyle = LocalAxfStyles.current.slider): Unit =
    kitFor(ComponentKind.SLIDER).Slider(label, value, onChange, modifier, min, max, step, unit, enabled, style)

@Composable
public fun AxfContainer(modifier: Modifier = Modifier, title: String? = null, icon: String? = null, actions: (@Composable RowScope.() -> Unit)? = null, style: ContainerStyle = LocalAxfStyles.current.container, ctxTarget: String? = null, ctxPayload: String? = null, initiallyOpen: Boolean = true, content: @Composable ColumnScope.() -> Unit): Unit =
    kitFor(ComponentKind.CARD).Container(modifier, title, icon, actions, style, ctxTarget, ctxPayload, initiallyOpen, content)

@Composable
public fun AxfListItem(title: String, modifier: Modifier = Modifier, subtitle: String? = null, icon: String? = null, onClick: (() -> Unit)? = null, selected: Boolean = false, enabled: Boolean = true, trailing: (@Composable RowScope.() -> Unit)? = null): Unit =
    kitFor(ComponentKind.LIST_ITEM).ListItem(title, modifier, subtitle, icon, onClick, selected, enabled, trailing)

@Composable
public fun AxfSectionHeader(text: String, modifier: Modifier = Modifier, accent: Boolean = false): Unit = kitFor(ComponentKind.SECTION_HEADER).SectionHeader(text, modifier, accent)

@Composable
public fun AxfDivider(modifier: Modifier = Modifier): Unit = kitFor(ComponentKind.DIVIDER).Divider(modifier)
