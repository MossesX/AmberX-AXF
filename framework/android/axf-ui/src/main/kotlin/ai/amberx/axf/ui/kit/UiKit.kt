package ai.amberx.axf.ui.kit

import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.asset.strMap
import ai.amberx.axf.kernel.asset.strOrNull
import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.kernel.contract.UiKitSpec
import ai.amberx.axf.kernel.engine.ButtonStyle
import ai.amberx.axf.kernel.engine.ContainerStyle
import ai.amberx.axf.kernel.engine.SliderStyle
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfStyles
import ai.amberx.axf.ui.components.ButtonTone
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp

/*
 * UI-kit switching. Every public AXF composable (AxfButton, AxfSlider, …) is a dispatcher: it asks the
 * active kit (selected by the hot-swappable `ui-kit` asset) for the implementation of its ComponentKind
 * and falls back to the Material 3 kit for kinds the active kit does not cover. A third-party widget
 * library becomes a kit by implementing [AxfComponents] (subclass [DefaultComponents] to override only
 * some kinds), contributing an [AxfUiKit] to `ExtensionPoints.UI_KITS`, and shipping a `ui-kit` asset.
 */

/** One composable per abstract component kind. Parameter lists are the public API of the matching Axf* composable. */
public interface AxfComponents {
    @Composable public fun Button(text: String?, onClick: () -> Unit, modifier: Modifier, tone: ButtonTone, icon: String?, requires: String?, enabled: Boolean, style: ButtonStyle, contentDescription: String?)
    @Composable public fun IconButton(icon: String, contentDescription: String, onClick: () -> Unit, modifier: Modifier, enabled: Boolean, requires: String?, tint: Color, size: Dp, iconSize: Dp, active: Boolean)
    @Composable public fun TextField(value: String, onValueChange: (String) -> Unit, modifier: Modifier, label: String?, placeholder: String?, leadingIcon: String?, enabled: Boolean, singleLine: Boolean, minLines: Int, secret: Boolean, monospace: Boolean, error: String?, keyboardOptions: KeyboardOptions, keyboardActions: KeyboardActions)
    @Composable public fun Switch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier, label: String?, description: String?, enabled: Boolean)
    @Composable public fun Checkbox(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier, label: String?, enabled: Boolean)
    @Composable public fun Chip(text: String, modifier: Modifier, tone: String?, icon: String?, selected: Boolean, onClick: (() -> Unit)?)
    @Composable public fun Badge(text: String, modifier: Modifier, tone: String)
    @Composable public fun Slider(label: String, value: Float, onChange: (Float) -> Unit, modifier: Modifier, min: Float, max: Float, step: Float, unit: String, enabled: Boolean, style: SliderStyle)
    @Composable public fun Container(modifier: Modifier, title: String?, icon: String?, actions: (@Composable RowScope.() -> Unit)?, style: ContainerStyle, ctxTarget: String?, ctxPayload: String?, initiallyOpen: Boolean, content: @Composable ColumnScope.() -> Unit)
    @Composable public fun ListItem(title: String, modifier: Modifier, subtitle: String?, icon: String?, onClick: (() -> Unit)?, selected: Boolean, enabled: Boolean, trailing: (@Composable RowScope.() -> Unit)?)
    @Composable public fun SectionHeader(text: String, modifier: Modifier, accent: Boolean)
    @Composable public fun Divider(modifier: Modifier)
}

/** A registered kit: identity for the kernel/console + the implementation table. */
public interface AxfUiKit {
    public val spec: UiKitSpec
    public val components: AxfComponents
}

/** Everything delegates to the Material 3 implementations; a kit overrides what it wants to replace. */
public open class DefaultComponents : AxfComponents {
    @Composable override fun Button(text: String?, onClick: () -> Unit, modifier: Modifier, tone: ButtonTone, icon: String?, requires: String?, enabled: Boolean, style: ButtonStyle, contentDescription: String?): Unit = ai.amberx.axf.ui.components.M3Button(text, onClick, modifier, tone, icon, requires, enabled, style, contentDescription)
    @Composable override fun IconButton(icon: String, contentDescription: String, onClick: () -> Unit, modifier: Modifier, enabled: Boolean, requires: String?, tint: Color, size: Dp, iconSize: Dp, active: Boolean): Unit = ai.amberx.axf.ui.components.M3IconButton(icon, contentDescription, onClick, modifier, enabled, requires, tint, size, iconSize, active)
    @Composable override fun TextField(value: String, onValueChange: (String) -> Unit, modifier: Modifier, label: String?, placeholder: String?, leadingIcon: String?, enabled: Boolean, singleLine: Boolean, minLines: Int, secret: Boolean, monospace: Boolean, error: String?, keyboardOptions: KeyboardOptions, keyboardActions: KeyboardActions): Unit = ai.amberx.axf.ui.components.M3TextField(value, onValueChange, modifier, label, placeholder, leadingIcon, enabled, singleLine, minLines, secret, monospace, error, keyboardOptions, keyboardActions)
    @Composable override fun Switch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier, label: String?, description: String?, enabled: Boolean): Unit = ai.amberx.axf.ui.components.M3Switch(checked, onCheckedChange, modifier, label, description, enabled)
    @Composable override fun Checkbox(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier, label: String?, enabled: Boolean): Unit = ai.amberx.axf.ui.components.M3Checkbox(checked, onCheckedChange, modifier, label, enabled)
    @Composable override fun Chip(text: String, modifier: Modifier, tone: String?, icon: String?, selected: Boolean, onClick: (() -> Unit)?): Unit = ai.amberx.axf.ui.components.M3Chip(text, modifier, tone, icon, selected, onClick)
    @Composable override fun Badge(text: String, modifier: Modifier, tone: String): Unit = ai.amberx.axf.ui.components.M3Badge(text, modifier, tone)
    @Composable override fun Slider(label: String, value: Float, onChange: (Float) -> Unit, modifier: Modifier, min: Float, max: Float, step: Float, unit: String, enabled: Boolean, style: SliderStyle): Unit = ai.amberx.axf.ui.components.M3Slider(label, value, onChange, modifier, min, max, step, unit, enabled, style)
    @Composable override fun Container(modifier: Modifier, title: String?, icon: String?, actions: (@Composable RowScope.() -> Unit)?, style: ContainerStyle, ctxTarget: String?, ctxPayload: String?, initiallyOpen: Boolean, content: @Composable ColumnScope.() -> Unit): Unit = ai.amberx.axf.ui.components.M3Container(modifier, title, icon, actions, style, ctxTarget, ctxPayload, initiallyOpen, content)
    @Composable override fun ListItem(title: String, modifier: Modifier, subtitle: String?, icon: String?, onClick: (() -> Unit)?, selected: Boolean, enabled: Boolean, trailing: (@Composable RowScope.() -> Unit)?): Unit = ai.amberx.axf.ui.components.M3ListItem(title, modifier, subtitle, icon, onClick, selected, enabled, trailing)
    @Composable override fun SectionHeader(text: String, modifier: Modifier, accent: Boolean): Unit = ai.amberx.axf.ui.components.M3SectionHeader(text, modifier, accent)
    @Composable override fun Divider(modifier: Modifier): Unit = ai.amberx.axf.ui.components.M3Divider(modifier)
}

/** The Android port's built-in kit. */
public object Material3Kit : AxfUiKit {
    override val spec: UiKitSpec = UiKitSpec("material3", "Material 3", "androidx.compose.material3", isDefault = true)
    override val components: AxfComponents = DefaultComponents()
}

/** Resolved kit table for the current composition: active kit id + overrides from the `ui-kit` asset, kits from the extension point. */
public class AxfUiKits(public val kits: List<AxfUiKit>, public val activeId: String?, public val overrides: Map<String, String>) {
    private val default = kits.firstOrNull { it.spec.isDefault } ?: Material3Kit
    public fun kitFor(kind: ComponentKind): AxfUiKit {
        val id = overrides[kind.name] ?: overrides[kind.name.lowercase()] ?: activeId
        val k = kits.firstOrNull { it.spec.id == id }
        return if (k != null && k.spec.covers(kind)) k else default
    }
    public fun components(kind: ComponentKind): AxfComponents = kitFor(kind).components
    public companion object { public val DEFAULT: AxfUiKits = AxfUiKits(listOf(Material3Kit), null, emptyMap()) }
}

public val LocalAxfUiKits: ProvidableCompositionLocal<AxfUiKits> = compositionLocalOf { AxfUiKits.DEFAULT }

/** Builds the kit table from the kernel's extension point and the active `ui-kit` asset. Called by AxfRoot. */
@Composable
public fun rememberAxfUiKits(): AxfUiKits {
    val kernel = LocalAxfKernel.current
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    return remember(kernel, compiled.rev) {
        val contributed = kernel?.extensions?.get(ExtensionPoints.UI_KITS)?.filterIsInstance<AxfUiKit>() ?: emptyList()
        val kits = (listOf(Material3Kit) + contributed).distinctBy { it.spec.id }
        val asset = runtime.asset(AssetTypes.UI_KIT)
        AxfUiKits(kits, asset?.data?.strOrNull("kit"), asset?.data?.strMap("overrides") ?: emptyMap())
    }
}

@Composable
public fun kitFor(kind: ComponentKind): AxfComponents = LocalAxfUiKits.current.components(kind)

/** Unused-parameter guard so kits that ignore `style` still read the active styles once (keeps recomposition keyed on swaps). */
@Composable
internal fun styles(): ai.amberx.axf.kernel.engine.ComponentStyles = LocalAxfStyles.current
