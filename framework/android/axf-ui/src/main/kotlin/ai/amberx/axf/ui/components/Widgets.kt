package ai.amberx.axf.ui.components

import ai.amberx.axf.kernel.engine.BannerEngine
import ai.amberx.axf.kernel.engine.ClockData
import ai.amberx.axf.kernel.engine.ClockParts
import ai.amberx.axf.kernel.engine.PlacedAttachment
import ai.amberx.axf.kernel.engine.WidgetEngine
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import java.util.Calendar
import java.util.TimeZone

/*
 * Widgets (asset types with "widget": true: clock, search bar, and the widget kinds in WidgetKinds.kt) drawn on their hosts (banner, toolbar). Placement is the
 * kernel's (WidgetEngine); this draws one placed widget. Renderers are an open registry (`WidgetRenderers`): a library
 * adds a new widget type by registering its renderer, no shell change. Web twin: react/components/Widgets.tsx.
 */

/** What a widget renderer gets: the asset's data, its id and the host drawing it (`banner`, `toolbar`). */
public data class WidgetRenderScope(val data: JsonObject, val id: String, val host: String)

/** Open registry of widget renderers by asset type. */
public object WidgetRenderers {
    private val map = LinkedHashMap<String, @Composable (WidgetRenderScope) -> Unit>()
    init {
        register("clock") { s -> AxfClock(ClockData.fromJson(s.data), host = s.host) }
        register("search-bar") { s -> AxfSearchBar(WidgetEngine.searchBarConfig(s.data), host = s.host) }
        registerWidgetKinds { type, r -> register(type, r) }
    }
    /** Register (or replace) the renderer for a widget type. Returns an unregister function. */
    public fun register(type: String, r: @Composable (WidgetRenderScope) -> Unit): () -> Unit { map[type] = r; return { if (map[type] === r) map.remove(type) } }
    public fun get(type: String): (@Composable (WidgetRenderScope) -> Unit)? = map[type]
}

/** Draw a placed widget by type + id (nothing if it's gone or no renderer is registered for its type). */
@Composable
public fun AxfWidget(a: PlacedAttachment, host: String) {
    val runtime = LocalAxfRuntime.current
    LocalAxfState.current
    val asset = runtime.registry.get(a.type, a.id) ?: return
    val r = WidgetRenderers.get(a.type) ?: return
    r(WidgetRenderScope(asset.data, a.id, host))
}

/* ---------------- clock ---------------- */

internal fun clockParts(tz: String?, now: Long = System.currentTimeMillis()): ClockParts {
    val zone = tz?.takeIf { it.isNotBlank() }?.let { id -> TimeZone.getTimeZone(id).takeIf { it.id == id || it.rawOffset != 0 || id == "UTC" || id == "GMT" } } ?: TimeZone.getDefault()
    val c = Calendar.getInstance(zone).apply { timeInMillis = now }
    return ClockParts(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH), c.get(Calendar.DAY_OF_WEEK) - 1, c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE), c.get(Calendar.SECOND))
}

/** A clock widget. Ticks every second with seconds shown, else exactly on the minute. Text = BannerEngine.formatClock, same as the web. */
@Composable
public fun AxfClock(data: ClockData, modifier: Modifier = Modifier, host: String = "banner") {
    val theme = Axf.theme
    val c = theme.colors
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(data.seconds) {
        val step = BannerEngine.clockTickMs(data)
        while (true) { delay(step - (System.currentTimeMillis() % step)); now = System.currentTimeMillis() }
    }
    val text = BannerEngine.formatClock(data, clockParts(data.timezone, now))
    val base = if (host == "banner") theme.typography.bodyMedium.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.88f) else theme.typography.bodySmall.copy(fontSize = theme.typography.bodyMedium.fontSize * 0.82f)
    Text(
        text, maxLines = 1, overflow = TextOverflow.Clip,
        style = if (data.mono) base.copy(fontFamily = FontFamily.Monospace) else base,
        color = if (host == "banner") LocalBannerForeground.current ?: c.text else c.muted,
        modifier = modifier.semantics { contentDescription = "Time $text" },
    )
}

/* ---------------- search bar ---------------- */

/** A search bar widget: the app-wide live search (views, settings, actions, assets, windows, dialogs, module providers). */
@Composable
public fun AxfSearchBar(config: ai.amberx.axf.kernel.engine.SearchBarConfig, modifier: Modifier = Modifier, host: String = "banner") {
    val theme = Axf.theme
    // Width = multiples of the space token, as on the web (`calc(var(--fx-space) * n)`), capped so phones keep the logo + clock.
    Box(modifier.widthIn(min = 96.dp, max = theme.spacing.x(config.width))) {
        AxfLiveSearch(config, compact = host == "banner")
    }
}
