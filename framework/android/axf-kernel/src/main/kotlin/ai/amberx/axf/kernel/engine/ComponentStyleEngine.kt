package ai.amberx.axf.kernel.engine

import ai.amberx.axf.kernel.asset.AppMenu
import ai.amberx.axf.kernel.asset.Button
import ai.amberx.axf.kernel.asset.ChromeDensity
import ai.amberx.axf.kernel.asset.ChromeSurface
import ai.amberx.axf.kernel.asset.NavIndicator
import ai.amberx.axf.kernel.asset.NavMenu
import ai.amberx.axf.kernel.asset.NavStyle
import ai.amberx.axf.kernel.asset.Toolbar
import ai.amberx.axf.kernel.asset.ToolbarVariant
import ai.amberx.axf.kernel.asset.Container
import ai.amberx.axf.kernel.asset.ContextMenu
import ai.amberx.axf.kernel.asset.Dialog
import ai.amberx.axf.kernel.asset.Popup
import ai.amberx.axf.kernel.asset.Shape
import ai.amberx.axf.kernel.asset.Size
import ai.amberx.axf.kernel.asset.Slider
import ai.amberx.axf.kernel.asset.Thumb

/** Resolved numbers for one component kind. Mirrors components.ts; axf-ui reads these, never the asset directly. */
public data class ButtonStyle(val radius: Double, val weight: Int, val paddingY: Double, val paddingX: Double, val elevated: Boolean, val uppercase: Boolean, val tracking: Double, val fill: ai.amberx.axf.kernel.asset.Fill, val minHeight: Double)
public data class SliderStyle(val track: Double, val thumb: Double, val thumbWidth: Double, val thumbRadiusPercent: Double, val fill: ai.amberx.axf.kernel.asset.Fill, val ticks: Boolean, val showValue: ai.amberx.axf.kernel.asset.ShowValue)
public data class ContainerStyle(val padding: Double, val elevation: Int, val variant: ai.amberx.axf.kernel.asset.ContainerVariant, val header: ai.amberx.axf.kernel.asset.HeaderStyle, val collapsible: Boolean)
public data class DialogStyle(val width: Double, val variant: ai.amberx.axf.kernel.asset.DialogVariant, val backdrop: ai.amberx.axf.kernel.asset.Backdrop, val animation: ai.amberx.axf.kernel.asset.DialogAnim, val header: ai.amberx.axf.kernel.asset.HeaderStyle, val closeOnBackdrop: Boolean)
public data class PopupStyle(val position: ai.amberx.axf.kernel.asset.PopupPosition, val variant: ai.amberx.axf.kernel.asset.PopupVariant, val durationMs: Int, val showIcon: Boolean, val maxVisible: Int)
public data class ContextMenuStyle(val variant: ai.amberx.axf.kernel.asset.ContextVariant, val showIcons: Boolean, val showShortcuts: Boolean, val rowHeight: Double, val minWidth: Double)
public data class ToolbarStyle(val variant: ToolbarVariant, val density: ChromeDensity, val surface: ChromeSurface, val divider: Boolean, val paddingY: Double, val buttonHeight: Double, val collapsible: Boolean = false)
public data class NavMenuStyle(val style: NavStyle, val density: ChromeDensity, val indicator: NavIndicator, val showIcons: Boolean, val itemPaddingY: Double)
public data class AppMenuStyle(val density: ChromeDensity, val surface: ChromeSurface, val height: Double)

public data class ComponentStyles(
    val button: ButtonStyle, val slider: SliderStyle, val container: ContainerStyle, val dialog: DialogStyle, val popup: PopupStyle, val contextMenu: ContextMenuStyle,
    val toolbar: ToolbarStyle, val navMenu: NavMenuStyle, val appMenu: AppMenuStyle,
) {
    /** Root data-attributes identical to the web port (data-fx-btn, data-fx-card, …) for WebView hosts and devtools. */
    public val attrs: Map<String, String> get() = mapOf(
        "data-fx-btn" to button.fill.name.lowercase(), "data-fx-slider" to slider.fill.name.lowercase(),
        "data-fx-card" to container.variant.name.lowercase(), "data-fx-card-header" to container.header.name.lowercase().replace('_', '-'),
        "data-fx-dialog" to dialog.variant.name.lowercase(), "data-fx-backdrop" to dialog.backdrop.name.lowercase(),
        "data-fx-dialog-anim" to dialog.animation.name.lowercase(), "data-fx-dialog-header" to dialog.header.name.lowercase().replace('_', '-'),
        "data-fx-toast-pos" to popup.position.name.lowercase().replace('_', '-'), "data-fx-toast" to popup.variant.name.lowercase(),
        "data-fx-ctx" to contextMenu.variant.name.lowercase(),
        "data-fx-toolbar" to toolbar.variant.name.lowercase().replace('_', '-'), "data-fx-toolbar-surface" to toolbar.surface.name.lowercase(),
        "data-fx-toolbar-divider" to if (toolbar.divider) "on" else "off",
        "data-fx-nav" to navMenu.style.name.lowercase(), "data-fx-nav-indicator" to navMenu.indicator.name.lowercase(),
        "data-fx-nav-icons" to if (navMenu.showIcons) "on" else "off",
        "data-fx-menubar" to appMenu.surface.name.lowercase(),
    )
}

public object ComponentStyleEngine {
    private val BTN_PAD = mapOf(Size.SM to (5.0 to 10.0), Size.MD to (8.0 to 14.0), Size.LG to (11.0 to 20.0))
    private val PAD = mapOf(Size.SM to 0.75, Size.MD to 1.1, Size.LG to 1.5)

    public fun button(b: Button, st: StyleTokens): ButtonStyle {
        val (py, px) = BTN_PAD.getValue(b.size)
        val radius = when (b.shape) { Shape.PILL -> 999.0; Shape.SQUARE -> 2.0; Shape.ROUNDED -> st.radiusMd }
        val minH = when (b.size) { Size.SM -> st.controlHeight - 8; Size.MD -> st.controlHeight; Size.LG -> st.controlHeight + 8 }
        return ButtonStyle(radius, b.weight, py * st.densityK, px, b.elevation, b.uppercase, if (b.uppercase) 0.06 else 0.0, b.fill, minH)
    }
    public fun slider(s: Slider, st: StyleTokens): SliderStyle = SliderStyle(
        s.track.toDouble(), s.thumbSize.toDouble(),
        if (s.thumb == Thumb.BAR) maxOf(6.0, Math.round(s.thumbSize / 3.0).toDouble()) else s.thumbSize.toDouble(),
        when (s.thumb) { Thumb.CIRCLE -> 50.0; Thumb.BAR -> 3.0 / s.thumbSize * 100; Thumb.SQUARE -> st.radiusSm / s.thumbSize * 100 },
        s.fill, s.ticks, s.showValue,
    )
    public fun container(c: Container, st: StyleTokens): ContainerStyle = ContainerStyle(st.space * PAD.getValue(c.padding) * 2, c.elevation, c.variant, c.header, c.collapsible || st.wrapGroups)
    public fun dialog(d: Dialog): DialogStyle = DialogStyle(d.width.toDouble(), d.variant, d.backdrop, d.animation, d.header, d.closeOnBackdrop)
    public fun popup(p: Popup): PopupStyle = PopupStyle(p.position, p.variant, p.duration, p.showIcon, p.maxVisible)
    public fun contextMenu(c: ContextMenu, st: StyleTokens): ContextMenuStyle = ContextMenuStyle(c.variant, c.showIcons, c.showShortcuts,
        when (c.variant) { ai.amberx.axf.kernel.asset.ContextVariant.ROOMY -> st.rowHeight + 10; else -> st.rowHeight }, if (c.variant == ai.amberx.axf.kernel.asset.ContextVariant.ROOMY) 240.0 else 200.0)

    // Chrome: same ladders as components.ts (defaults reproduce the pre-0.2.1 look).
    private val TOOLBAR_PY = mapOf(ChromeDensity.COMPACT to 0.35, ChromeDensity.REGULAR to 0.6, ChromeDensity.ROOMY to 0.9)
    private val TOOLBTN_H = mapOf(ChromeDensity.COMPACT to -8.0, ChromeDensity.REGULAR to -4.0, ChromeDensity.ROOMY to 0.0)
    private val NAV_PY = mapOf(ChromeDensity.COMPACT to 4.0, ChromeDensity.REGULAR to 7.0, ChromeDensity.ROOMY to 10.0)
    private val MENUBAR_H = mapOf(ChromeDensity.COMPACT to 0.0, ChromeDensity.REGULAR to 4.0, ChromeDensity.ROOMY to 12.0)

    public fun toolbar(t: Toolbar, st: StyleTokens): ToolbarStyle =
        ToolbarStyle(t.variant, t.density, t.surface, t.divider, st.space * TOOLBAR_PY.getValue(t.density), st.rowHeight + TOOLBTN_H.getValue(t.density), t.collapsible)
    public fun navMenu(n: NavMenu): NavMenuStyle = NavMenuStyle(n.style, n.density, n.indicator, n.showIcons, NAV_PY.getValue(n.density))
    public fun appMenu(a: AppMenu, st: StyleTokens): AppMenuStyle = AppMenuStyle(a.density, a.surface, st.rowHeight + MENUBAR_H.getValue(a.density))

    public fun compile(b: Button, s: Slider, c: Container, d: Dialog, p: Popup, m: ContextMenu, st: StyleTokens,
                       toolbar: Toolbar, nav: NavMenu, appMenu: AppMenu): ComponentStyles =
        ComponentStyles(button(b, st), slider(s, st), container(c, st), dialog(d), popup(p), contextMenu(m, st), toolbar(toolbar, st), navMenu(nav), appMenu(appMenu, st))
}
