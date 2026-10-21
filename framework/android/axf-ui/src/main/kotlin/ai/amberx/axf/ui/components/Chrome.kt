package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.AxfVersion
import ai.amberx.axf.kernel.asset.Align
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.asset.NavItem
import ai.amberx.axf.kernel.asset.NavMenu
import ai.amberx.axf.kernel.asset.NavStyle
import ai.amberx.axf.kernel.asset.ToolbarVariant
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.kernel.engine.Orientation
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties

/* ---------------- Menubar / TopBar (app-menu asset) ---------------- */

/**
 * Web `.fx-menubar`: brand mark + app name, one button per menu (dropdown of UAC-filtered items), role chip.
 * On phones the menus collapse into one "menu" button that lists every menu as an expandable section.
 */
@Composable
public fun AxfMenubar(modifier: Modifier = Modifier, compact: Boolean = false, onRoleChip: (() -> Unit)? = null) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val state = LocalAxfState.current
    val theme = Axf.theme
    val c = theme.colors
    var open by remember { mutableStateOf<String?>(null) }
    val role = compiled.policy.role(state.role)
    val rowH = theme.spacing.rowHeight + 4.dp

    Row(
        modifier.fillMaxWidth().heightIn(min = rowH).background(c.surface).drawBottomBorder(c.border, theme.spacing.borderWidth).padding(horizontal = theme.spacing.oneHalf),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.oneHalf),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AxfBrandMark()
            if (!compact) Text(runtime.manifest.appName, style = theme.typography.titleSmall.copy(fontWeight = FontWeight.Bold, fontSize = theme.typography.bodyMedium.fontSize), color = c.text, maxLines = 1)
        }
        if (compact) {
            Box {
                AxfIconButton("menu", "Application menu", onClick = { open = if (open == "*") null else "*" }, active = open == "*")
                if (open == "*") AxfDropdown(onDismiss = { open = null }) {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        for (m in compiled.appMenu.menus) {
                            AxfSectionHeader(m.label)
                            AxfMenuList(m.items, onDone = { open = null })
                        }
                    }
                }
            }
        } else {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                for (m in compiled.appMenu.menus) {
                    Box {
                        val isOpen = open == m.id
                        Text(
                            m.label, style = theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.93f), color = if (isOpen) c.text else c.muted, maxLines = 1,
                            modifier = Modifier.clip(theme.shapes.smShape).then(if (isOpen) Modifier.background(c.surface3) else Modifier)
                                .clickable(role = Role.Button) { open = if (isOpen) null else m.id }.padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                        if (isOpen) AxfDropdown(onDismiss = { open = null }) { AxfMenuList(m.items, onDone = { open = null }) }
                    }
                }
            }
        }
        if (compact) Spacer(Modifier.weight(1f))
        Row(
            Modifier.clip(theme.shapes.full).background(c.surface2).border(theme.spacing.borderWidth, c.border, theme.shapes.full)
                .clickable(role = Role.Button, onClick = onRoleChip ?: { runtime.navigate("account") })
                .heightIn(min = 28.dp).padding(horizontal = 10.dp, vertical = 3.dp)
                .semantics { contentDescription = "User account control: ${role?.label ?: state.role}" },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            AxfIcon("shield", size = 13.dp, tint = c.muted, contentDescription = null)
            Text(role?.label ?: state.role, style = theme.typography.bodySmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.82f), color = c.muted, maxLines = 1)
        }
    }
}

/** Web `.fx-brand__mark`: 18dp rounded square with a conic accent → info gradient and an inset surface ring. */
@Composable
public fun AxfBrandMark(modifier: Modifier = Modifier) {
    val theme = Axf.theme
    val c = theme.colors
    val shape = RoundedCornerShape(theme.shapes.sm + 1.dp)
    Box(modifier.size(18.dp).clip(shape).background(Brush.sweepGradient(listOf(c.accent, c.info, c.accent)), shape).padding(4.dp).background(c.surface, shape).padding(1.dp).background(c.accent, shape))
}

/** Anchored dropdown under a menubar button: popover with the menu list. */
@Composable
public fun AxfDropdown(onDismiss: () -> Unit, content: @Composable () -> Unit) {
    Popup(onDismissRequest = onDismiss, properties = PopupProperties(focusable = true, dismissOnBackPress = true, dismissOnClickOutside = true), offset = androidx.compose.ui.unit.IntOffset(0, 4)) {
        AxfPopover(Modifier.padding(top = 32.dp)) { content() }
    }
}

/* ---------------- Toolbar (toolbar asset) ---------------- */

/**
 * Web `.fx-toolbar`: widgets at the start (`toolbar.widgets` + runtime.attachToToolbar), groups separated by a border,
 * icon / icon+label / label buttons (UAC-gated), align start / center / spread, widgets at the end, then the search:
 * the live search (`data.search.live`, reads the kernel index) or the classic box that jumps to a view / swaps an asset.
 */
@Composable
public fun AxfToolbar(modifier: Modifier = Modifier, viewTitles: Map<String, String> = emptyMap(), onSearch: ((String) -> Boolean)? = null) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val uac = LocalAxfUac.current
    val actions = LocalAxfActions.current
    LocalAxfState.current
    val badges by runtime.badges.collectAsState()
    val theme = Axf.theme
    val c = theme.colors
    val tb = compiled.toolbar
    val widgets = runtime.toolbarWidgets()
    var q by remember { mutableStateOf("") }
    // `collapsible` toolbars fold to a thin handle; the fold is remembered per device (runtime.toolbarCollapsed()).
    if (tb.collapsible && runtime.toolbarCollapsed()) {
        Row(modifier.fillMaxWidth().background(c.surface2).padding(horizontal = theme.spacing.oneHalf), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            ai.amberx.axf.ui.kit.AxfIconButton("chevron-down", "Unfold the toolbar", { runtime.setToolbarCollapsed(false) }, size = theme.spacing.rowHeight * 0.6f, iconSize = 14.dp)
        }
        return
    }

    fun runSearch() {
        val needle = q.trim().lowercase()
        if (needle.isEmpty()) return
        if (onSearch?.invoke(needle) == true) { q = ""; return }
        val view = viewTitles.entries.firstOrNull { (id, title) -> id == needle || title.lowercase().contains(needle) }
        if (view != null) { runtime.navigate(view.key); q = ""; return }
        for (t in AssetTypes.CORE) {
            val hit = runtime.registry.list(t).firstOrNull { it.name.lowercase().contains(needle) || it.id == needle }
            if (hit != null) {
                if (runtime.swap(t, hit.id)) runtime.toast("${runtime.registry.types.get(t)?.label ?: t} → ${hit.name}", ToastKind.SUCCESS, "Hot-swapped")
                q = ""; return
            }
        }
        runtime.toast("Nothing matches \"$q\".", ToastKind.WARNING, "Search")
    }

    Row(
        modifier.fillMaxWidth().background(c.surface2).padding(horizontal = theme.spacing.oneHalf, vertical = theme.spacing.x(0.6)).horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = when (tb.align) { Align.CENTER -> Arrangement.Center; Align.SPREAD -> Arrangement.SpaceBetween; Align.START -> Arrangement.spacedBy(theme.spacing.one) },
    ) {
        for (w in widgets["start"] ?: emptyList()) Box(Modifier.padding(end = theme.spacing.one)) { AxfWidget(w, host = "toolbar") }
        tb.groups.forEachIndexed { gi, g ->
            val last = gi == tb.groups.lastIndex && !tb.showSearch
            Row(
                Modifier.then(if (!last) Modifier.padding(end = theme.spacing.one).drawEndBorder(c.border, theme.spacing.borderWidth).padding(end = theme.spacing.one) else Modifier),
                horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                for (item in g.items) {
                    val gate = uac.gate(item.requires)
                    if (gate == Gate.HIDE) continue
                    val locked = gate == Gate.DISABLE
                    val count = item.badge?.let { badges[it] } ?: 0
                    val h = theme.spacing.rowHeight - 4.dp
                    Row(
                        Modifier.heightIn(min = h).widthIn(min = h).clip(theme.shapes.smShape)
                            .clickable(enabled = !locked, role = Role.Button) { actions.dispatch(item.action) }
                            .alpha(if (locked) 0.4f else 1f).padding(horizontal = 8.dp)
                            .semantics { contentDescription = if (locked) "${item.label} — requires ${item.requires}" else if (count > 0) "${item.label} ($count new)" else item.label },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        if (tb.variant != ToolbarVariant.LABELS) AxfIcon(if (locked) "lock" else item.icon, size = 16.dp, tint = c.muted, contentDescription = null)
                        if (tb.variant != ToolbarVariant.ICONS) Text(item.label, style = theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.88f), color = c.muted, maxLines = 1)
                        if (count > 0) Box(Modifier.clip(RoundedCornerShape(50)).background(c.accent).padding(horizontal = 5.dp)) {
                            Text(if (count > 99) "99+" else count.toString(), style = theme.typography.labelSmall.copy(fontWeight = FontWeight.Bold), color = c.accentText, maxLines = 1)
                        }
                    }
                }
            }
            if (tb.align == Align.START && gi == tb.groups.lastIndex && tb.showSearch) Spacer(Modifier.weight(1f, fill = true))
        }
        for (w in widgets["end"] ?: emptyList()) Box(Modifier.padding(start = theme.spacing.one)) { AxfWidget(w, host = "toolbar") }
        if (tb.showSearch && tb.liveSearch != null) {
            AxfLiveSearch(tb.liveSearch!!, Modifier.widthIn(min = 150.dp, max = theme.spacing.x(tb.liveSearch!!.width)))
        } else if (tb.showSearch) {
            Row(
                Modifier.widthIn(min = 150.dp, max = 260.dp).heightIn(min = theme.spacing.rowHeight - 6.dp).clip(theme.shapes.smShape).background(c.surface).border(theme.spacing.borderWidth, c.border, theme.shapes.smShape).padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                AxfIcon("search", size = 14.dp, tint = c.muted, contentDescription = null)
                androidx.compose.foundation.text.BasicTextField(
                    value = q, onValueChange = { q = it }, singleLine = true,
                    textStyle = theme.typography.bodyMedium.copy(color = c.text, fontSize = theme.typography.bodyMedium.fontSize * 0.9f),
                    cursorBrush = androidx.compose.ui.graphics.SolidColor(c.accent),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { runSearch() }),
                    modifier = Modifier.weight(1f).semantics { contentDescription = "Search views and assets" },
                    decorationBox = { inner -> Box { if (q.isEmpty()) Text("Go to view or swap asset…", style = theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.9f), color = c.placeholder, maxLines = 1); inner() } },
                )
            }
        }
        if (tb.collapsible) ai.amberx.axf.ui.kit.AxfIconButton("chevron-up", "Fold the toolbar", { runtime.setToolbarCollapsed(true) }, iconSize = 14.dp)
    }
}

/* ---------------- Nav (nav-menu asset) ---------------- */

/**
 * Web `.fx-nav`: the nav-menu asset in list / pills / rail style. `orientation` VERTICAL for side navs,
 * HORIZONTAL for top navs; `bottomTabs` renders the phone variant (every item a column of icon+label).
 * Items whose view is not in `views` are dropped (like the web); UAC HIDE drops, DISABLE locks.
 */
@Composable
public fun AxfNav(
    modifier: Modifier = Modifier,
    views: Set<String>,
    orientation: Orientation = Orientation.VERTICAL,
    bottomTabs: Boolean = false,
    rail: Boolean = false,
    onNavigate: ((String) -> Unit)? = null,
) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val state = LocalAxfState.current
    val uac = LocalAxfUac.current
    val theme = Axf.theme
    val c = theme.colors
    val nav: NavMenu = compiled.navMenu
    val style = if (rail) NavStyle.RAIL else nav.style
    val navigate: (String) -> Unit = onNavigate ?: { runtime.navigate(it) }
    val horizontal = bottomTabs || orientation == Orientation.HORIZONTAL

    @Composable
    fun Item(item: NavItem, itemModifier: Modifier) {
        val gate = uac.gate(item.requires)
        if (gate == Gate.HIDE) return
        val locked = gate == Gate.DISABLE
        val active = state.view == item.view
        val stacked = bottomTabs || style == NavStyle.RAIL && !horizontal
        val shape = when { style == NavStyle.PILLS && !stacked -> theme.shapes.full; stacked -> theme.shapes.mdShape; else -> theme.shapes.smShape }
        val bg = when {
            !active -> androidx.compose.ui.graphics.Color.Transparent
            style == NavStyle.PILLS && !stacked -> c.accent
            style == NavStyle.RAIL || stacked -> c.accentSoft
            else -> c.surface3
        }
        val fg = when {
            !active -> c.muted
            style == NavStyle.PILLS && !stacked -> c.accentText
            style == NavStyle.RAIL || stacked -> c.accent
            else -> c.text
        }
        val base = itemModifier
            .then(if (stacked && !bottomTabs) Modifier.fillMaxWidth() else if (horizontal) Modifier else Modifier.fillMaxWidth())
            .heightIn(min = theme.spacing.touchTarget * (if (stacked) 1f else 0.8f))
            .then(if (style == NavStyle.LIST && active && !horizontal && !stacked) Modifier.drawBehind { drawRoundRect(c.accent, topLeft = Offset(-8.dp.toPx(), 6.dp.toPx()), size = Size(3.dp.toPx(), size.height - 12.dp.toPx()), cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx())) } else Modifier)
            .then(if (style == NavStyle.LIST && active && horizontal && !bottomTabs) Modifier.drawBottomBorder(c.accent, 2.dp) else Modifier)
            .clip(shape).background(bg, shape)
            .axfContextMenu("nav-item", item.view)
            .clickable(enabled = !locked, role = Role.Tab) { navigate(item.view) }
            .alpha(if (locked) 0.4f else 1f)
            .semantics { selected = active; contentDescription = item.label }
        val padH = when { stacked -> 4.dp; style == NavStyle.PILLS -> 14.dp; else -> 10.dp }
        val padV = when { stacked -> 6.dp; style == NavStyle.PILLS -> 7.dp; else -> 7.dp }
        if (stacked) {
            Box(base.padding(horizontal = padH, vertical = padV), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    AxfIcon(if (locked) "lock" else item.icon, size = 20.dp, tint = fg, contentDescription = null)
                    Text(item.label, style = theme.typography.labelSmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.68f), color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (item.badge != null) AxfBadge(item.badge!!, Modifier.align(Alignment.TopEnd))
            }
        } else {
            Row(base.padding(horizontal = padH, vertical = padV), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AxfIcon(if (locked) "lock" else item.icon, size = 17.dp, tint = fg, contentDescription = null)
                Text(item.label, style = theme.typography.bodyMedium, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = if (horizontal) Modifier else Modifier.weight(1f))
                if (item.badge != null) AxfBadge(item.badge!!)
            }
        }
    }

    if (bottomTabs) {
        Row(modifier.fillMaxWidth().background(c.surface).drawTopBorder(c.border, theme.spacing.borderWidth).padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            for (sec in nav.sections) for (item in sec.items) if (item.view in views) Item(item, Modifier.weight(1f))
        }
    } else if (horizontal) {
        Row(modifier.fillMaxWidth().background(c.surface).padding(horizontal = theme.spacing.oneHalf, vertical = 6.dp).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(theme.spacing.one)) {
            for (sec in nav.sections) for (item in sec.items) if (item.view in views) Item(item, Modifier)
        }
    } else {
        Column(
            modifier.fillMaxHeight().background(c.surface).verticalScroll(rememberScrollState()).padding(horizontal = if (style == NavStyle.RAIL) 6.dp else theme.spacing.one, vertical = theme.spacing.oneHalf),
            verticalArrangement = Arrangement.spacedBy(theme.spacing.oneHalf),
        ) {
            if (nav.header != null && style != NavStyle.RAIL) Text(nav.header!!.uppercase(), style = theme.typography.eyebrow.copy(letterSpacing = 0.12f.em, fontSize = theme.typography.bodyMedium.fontSize * 0.8f), color = c.muted, modifier = Modifier.padding(horizontal = 8.dp))
            for (sec in nav.sections) {
                val items = sec.items.filter { it.view in views }
                if (items.isEmpty()) continue
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    if (sec.label != null && style != NavStyle.RAIL) AxfSectionHeader(sec.label!!)
                    for (item in items) Item(item, Modifier)
                }
            }
        }
    }
}

/* ---------------- Status bar ---------------- */

/** Web `.fx-status`: framework version, active theme/style/layout names, asset + swap counts. `extras` come from SHELL_REGIONS. */
@Composable
public fun AxfStatusBar(modifier: Modifier = Modifier, extras: List<@Composable () -> Unit> = emptyList()) {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    LocalAxfCompiled.current
    val theme = Axf.theme
    val c = theme.colors
    val small = theme.typography.bodySmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.78f)
    fun name(t: String): String = runtime.asset(t)?.name ?: "—"
    Row(
        modifier.fillMaxWidth().height(26.dp).background(c.surface).drawTopBorder(c.border, theme.spacing.borderWidth).padding(horizontal = 12.dp).horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(13.dp).background(c.success.copy(alpha = 0.25f), theme.shapes.full).padding(3.dp).background(c.success, theme.shapes.full))
        Text("AmberX AXF ${AxfVersion.FRAMEWORK}", style = small, color = c.muted, maxLines = 1)
        Box(Modifier.width(1.dp).height(12.dp).background(c.border))
        Text(name(AssetTypes.COLOR_THEME), style = small, color = c.muted, maxLines = 1)
        Text(name(AssetTypes.STYLE_THEME), style = small, color = c.muted, maxLines = 1)
        Text(name(AssetTypes.LAYOUT), style = small, color = c.muted, maxLines = 1)
        for (e in extras) e()
        Spacer(Modifier.weight(1f))
        Text("${runtime.registry.count()} assets", style = small, color = c.muted, maxLines = 1)
        Text("${state.swaps} swaps", style = small, color = c.muted, maxLines = 1)
    }
}

internal fun Modifier.drawTopBorder(color: androidx.compose.ui.graphics.Color, width: androidx.compose.ui.unit.Dp): Modifier = this.drawBehind { drawRect(color, size = Size(size.width, width.toPx())) }
internal fun Modifier.drawEndBorder(color: androidx.compose.ui.graphics.Color, width: androidx.compose.ui.unit.Dp): Modifier = this.drawBehind { val w = width.toPx(); drawRect(color, topLeft = Offset(size.width - w, 0f), size = Size(w, size.height)) }
internal fun Modifier.drawStartBorder(color: androidx.compose.ui.graphics.Color, width: androidx.compose.ui.unit.Dp): Modifier = this.drawBehind { drawRect(color, size = Size(width.toPx(), size.height)) }
