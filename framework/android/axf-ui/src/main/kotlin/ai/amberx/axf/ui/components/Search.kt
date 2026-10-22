package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.contract.WindowManager
import ai.amberx.axf.kernel.engine.SearchBarConfig
import ai.amberx.axf.kernel.engine.SearchEngine
import ai.amberx.axf.kernel.engine.SearchEntry
import ai.amberx.axf.kernel.engine.SearchHit
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.DialogContribution
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.icons.AxfIcon
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties

/*
 * Live search (search-bar widget, or a toolbar's `search.live`). Reads the kernel's SearchIndex (SearchEngine.kt),
 * which [AxfSearchHost] feeds with this shell's views, dialogs and open windows (the kernel adds actions and assets;
 * lib-settings adds its tabs / groups / settings), and installs the focuser that brings a picked result onto the screen.
 * Web twin: react/components/Search.tsx. Theme tokens only.
 */

/** Registry the shell fills: the views it can show (id → title, icon, keywords), the dialogs, and the focuser. */
public class AxfSearchHost(private val runtime: AxfRuntime, private val kernel: AxfKernel?) {
    private var removers: List<() -> Unit> = emptyList()
    private var viewIds: Set<String> = emptySet()

    public fun install(views: Map<String, String>, viewIcons: Map<String, String> = emptyMap(), viewKeywords: Map<String, List<String>> = emptyMap(), dialogs: Map<String, DialogContribution> = emptyMap()) {
        uninstall()
        viewIds = views.keys
        val wm = kernel?.services?.get<WindowManager>()
        removers = listOf(
            runtime.search.add("axf.views") {
                views.map { (id, title) -> SearchEntry("view:$id", "view", title, detail = "Page", icon = viewIcons[id] ?: "layout", keywords = listOf(id) + (viewKeywords[id] ?: emptyList()), focus = mapOf("kind" to "view", "view" to id)) }
            },
            runtime.search.add("axf.dialogs") {
                dialogs.values.filter { it.searchable }.map { d -> SearchEntry("dialog:${d.id}", "dialog", d.title, detail = "Dialog", icon = d.icon ?: "box", keywords = listOf(d.id), focus = mapOf("kind" to "dialog", "id" to d.id)) }
            },
            runtime.search.add("axf.windows") {
                wm?.state?.value?.windows?.filter { it.type != ai.amberx.axf.kernel.contract.WindowType.MAIN }?.map { w ->
                    SearchEntry("window:${w.id}", "window", w.title, detail = if (w.minimized != null) "Window (minimized)" else "Window", icon = "monitor", focus = mapOf("kind" to "window", "id" to w.id))
                } ?: emptyList()
            },
        )
        runtime.search.setFocuser(ai.amberx.axf.kernel.engine.SearchFocuser { e -> focusEntry(e, wm) })
    }

    public fun uninstall() { removers.forEach { it() }; removers = emptyList(); runtime.search.setFocuser(null) }

    /** Bring an entry onto the screen: the UI focuser first (windows, asset gallery), then the runtime fallback. */
    public fun focus(entry: SearchEntry): Boolean = runtime.focusSearch(entry)

    private fun focusEntry(e: SearchEntry, wm: WindowManager?): Boolean {
        val f = e.focus
        return when (f["kind"]) {
            "window" -> { val id = f["id"] ?: return false; wm?.restore(id); wm != null }
            // An asset result opens the asset gallery when the app has one (the web does the same); else the runtime swaps it in.
            "asset" -> if ("assets" in viewIds) { runtime.navigate("assets"); true } else false
            else -> false
        }
    }
}

/** The search host of this tree (null until AppShell installs one). */
public val LocalAxfSearchHost: androidx.compose.runtime.ProvidableCompositionLocal<AxfSearchHost?> = androidx.compose.runtime.staticCompositionLocalOf { null }

/**
 * The live search box: results update on every keystroke in a popover under the box; Enter or a tap focuses the pick.
 * `compact` draws the banner variant (shorter, no border glow). Hardware keyboards: Ctrl/Cmd+K or "/" focus it when
 * `config.shortcut` is on (phones have no global key hook; the box is always one tap away in the banner).
 */
@Composable
public fun AxfLiveSearch(config: SearchBarConfig, modifier: Modifier = Modifier, compact: Boolean = false) {
    val runtime = LocalAxfRuntime.current
    val kernel = LocalAxfKernel.current
    val state = LocalAxfState.current
    val hostLocal = LocalAxfSearchHost.current
    val host = remember(runtime, kernel, hostLocal) { hostLocal ?: AxfSearchHost(runtime, kernel) }
    val theme = Axf.theme
    val c = theme.colors
    var q by remember { mutableStateOf("") }
    var open by remember { mutableStateOf(false) }
    var active by remember { mutableStateOf(0) }
    val focus = remember { FocusRequester() }
    // `state.rev` changes with every runtime change (swaps, role, contributions…), so results stay current.
    val hits: List<SearchHit> = remember(q, state.rev, config.maxResults, config.kinds) {
        if (q.isBlank()) emptyList() else runtime.search.query(q, config.maxResults, config.kinds ?: emptyList())
    }
    if (active >= hits.size) active = 0

    fun pick(h: SearchHit?) {
        h ?: return
        if (h.locked) { runtime.toast("\"${h.entry.label}\" needs ${h.entry.requires}.", ToastKind.WARNING, "Locked"); return }
        open = false; q = ""
        host.focus(h.entry)
    }

    val h = if (compact) theme.spacing.rowHeight - 8.dp else theme.spacing.rowHeight - 6.dp
    val fg = LocalBannerForeground.current
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = h).clip(theme.shapes.full).background(c.surface).border(theme.spacing.borderWidth, c.border, theme.shapes.full).padding(horizontal = 10.dp)
                .onPreviewKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (e.key) {
                        Key.DirectionDown -> { open = true; active = (active + 1).coerceAtMost((hits.size - 1).coerceAtLeast(0)); true }
                        Key.DirectionUp -> { active = (active - 1).coerceAtLeast(0); true }
                        Key.Escape -> { if (q.isNotEmpty()) q = "" else open = false; true }
                        else -> false
                    }
                },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            AxfIcon("search", size = 14.dp, tint = fg ?: c.muted, contentDescription = null)
            BasicTextField(
                value = q, onValueChange = { q = it; open = true }, singleLine = true,
                textStyle = theme.typography.bodyMedium.copy(color = c.text, fontSize = theme.typography.bodyMedium.fontSize * 0.9f),
                cursorBrush = SolidColor(c.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = { pick(hits.getOrNull(active)) }),
                modifier = Modifier.weight(1f).focusRequester(focus).onFocusChanged { if (it.isFocused) open = true }.semantics { contentDescription = "Search everything" },
                decorationBox = { inner -> Box { if (q.isEmpty()) Text(config.placeholder, style = theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.9f), color = c.placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis); inner() } },
            )
            if (q.isNotEmpty()) AxfIconButton("x", "Clear search", { q = ""; focus.requestFocus() }, size = 20.dp, iconSize = 12.dp)
        }
        if (open && q.isNotBlank()) {
            Popup(onDismissRequest = { open = false }, properties = PopupProperties(focusable = false, dismissOnClickOutside = true), offset = IntOffset(0, with(androidx.compose.ui.platform.LocalDensity.current) { (h + 4.dp).roundToPx() })) {
                AxfPopover(Modifier.widthIn(min = 280.dp, max = 420.dp)) {
                    Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
                        if (hits.isEmpty()) Text("Nothing matches “${q.trim()}”.", style = theme.typography.bodySmall, color = c.muted, modifier = Modifier.padding(12.dp))
                        hits.forEachIndexed { i, hit -> SearchHitRow(hit, i == active, onEnter = { active = i }, onPick = { pick(hit) }) }
                    }
                }
            }
        }
    }
    // Global shortcut (hardware keyboards): the shell forwards Ctrl/Cmd+K and "/" here through the focus requester.
    DisposableEffect(config.shortcut) {
        val reg = if (config.shortcut) SearchShortcuts.register { focus.requestFocus(); open = true } else null
        onDispose { reg?.invoke() }
    }
}

/** Shortcut registry: AxfRoot forwards Ctrl/Cmd+K and "/" (hardware keyboards) to the most recently shown search bar. */
public object SearchShortcuts {
    private val targets = ArrayDeque<() -> Unit>()
    public fun register(focus: () -> Unit): () -> Unit { targets.addLast(focus); return { targets.remove(focus) } }
    /** Returns true when a search box took the key. */
    public fun trigger(): Boolean { val t = targets.lastOrNull() ?: return false; t(); return true }
    public fun handles(e: androidx.compose.ui.input.key.KeyEvent, typing: Boolean): Boolean =
        e.type == KeyEventType.KeyDown && (((e.isCtrlPressed || e.isMetaPressed) && e.key == Key.K) || (e.key == Key.Slash && !typing))
}

@Composable
private fun SearchHitRow(hit: SearchHit, active: Boolean, onEnter: () -> Unit, onPick: () -> Unit) {
    val theme = Axf.theme
    val c = theme.colors
    val e = hit.entry
    Row(
        Modifier.fillMaxWidth().then(if (active) Modifier.background(c.surface3) else Modifier)
            .clickable(role = Role.Button, onClick = { onEnter(); onPick() }).alpha(if (hit.locked) 0.55f else 1f)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        AxfIcon(if (hit.locked) "lock" else e.icon ?: "search", size = 15.dp, tint = c.muted, contentDescription = null)
        Column(Modifier.weight(1f)) {
            Text(e.label, style = theme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium), color = c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (e.detail != null) Text(e.detail!!, style = theme.typography.bodySmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.8f), color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.clip(RoundedCornerShape(50)).background(c.surface2).border(theme.spacing.borderWidth, c.border, RoundedCornerShape(50)).padding(horizontal = 7.dp, vertical = 2.dp)) {
            Text((SearchEngine.KIND_LABELS[e.kind] ?: e.kind).uppercase(), style = theme.typography.labelSmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.62f), color = c.muted, maxLines = 1)
        }
    }
}
