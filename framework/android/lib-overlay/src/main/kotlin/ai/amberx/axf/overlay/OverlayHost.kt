package ai.amberx.axf.overlay

import ai.amberx.axf.kernel.engine.OverlayChip
import ai.amberx.axf.kernel.engine.OverlayData
import ai.amberx.axf.kernel.engine.OverlayEngine
import ai.amberx.axf.kernel.engine.OverlayLogLine
import ai.amberx.axf.kernel.engine.OverlayPoint
import ai.amberx.axf.kernel.engine.OverlayScreen
import ai.amberx.axf.kernel.engine.OverlaySize
import ai.amberx.axf.kernel.engine.ResolvedChip
import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * A status chip a module puts on the pill at run time (the asset's own chips are the default). `label` shows while on,
 * `offLabel` while off (empty = the same label both ways); tones: neutral | success | warning | danger | accent | muted | info.
 */
public data class Chip(
    val id: String,
    val label: String,
    val offLabel: String = "",
    val tone: String = "success",
    val offTone: String = "muted",
    val icon: String = "",
    val on: Boolean = false,
) {
    internal fun toEngine(): OverlayChip = OverlayChip(id, label.take(OverlayEngine.Limits.LABEL_MAX), offLabel.take(OverlayEngine.Limits.LABEL_MAX), tone.takeIf { it in OverlayEngine.CHIP_TONES } ?: "success", offTone.takeIf { it in OverlayEngine.CHIP_TONES } ?: "muted", icon, on)
}

/**
 * The tappable log under the pill (and the source of the collapsed strip). `add` keeps the newest `maxLines` of the
 * active config (the engine trims); `onTap` is what the pill calls when a line is tapped — e.g. open a tune card for
 * the trigger named in `line.ref`. Pure: no Android, so apps can unit-test what they log.
 */
public class OverlayLog internal constructor(private val maxLines: () -> Int, private val now: () -> Long) {
    private val _lines = MutableStateFlow<List<OverlayLogLine>>(emptyList())
    public val lines: StateFlow<List<OverlayLogLine>> get() = _lines.asStateFlow()
    private var tap: ((OverlayLogLine) -> Unit)? = null

    /** Adds one line. `confidence` 0–1 (or null), `tag` a short word (fired / below / cooldown …), `ref` what produced it. */
    public fun add(line: String, confidence: Double? = null, tag: String = "", ref: String = "", at: Long = now()): OverlayLogLine {
        val l = OverlayEngine.logLine(line, confidence, tag, at, ref)
        _lines.update { OverlayEngine.addLogLine(it, l, maxLines()) }
        return l
    }
    public fun add(line: String, confidence: Float?, tag: String = "", ref: String = ""): OverlayLogLine = add(line, confidence?.toDouble(), tag, ref)
    public fun clear() { _lines.value = emptyList() }
    /** Re-trims after the config changed its `maxLines`. */
    internal fun trim() { _lines.update { OverlayEngine.trimLog(it, maxLines()) } }
    /** The handler the pill calls when a line is tapped (one at a time; null clears it). */
    public fun onTap(handler: ((OverlayLogLine) -> Unit)?) { tap = handler }
    public fun tapped(line: OverlayLogLine) { tap?.invoke(line) }
    public fun hasTapHandler(): Boolean = tap != null
}

/** Everything the pill, strip and service read. Sizes in dp, positions in px (what the window manager takes). */
public data class OverlayState(
    /** the active asset with the user's settings over it */
    val config: OverlayData,
    /** wants to be on screen (the user / the app said show) */
    val visible: Boolean = false,
    /** actually on screen right now (service running with the permission) */
    val shown: Boolean = false,
    val miniOpen: Boolean = false,
    /** the log panel open (starts from `config.log.show`) */
    val logOpen: Boolean = true,
    /** run-time chips replacing the asset's own; null = the asset's */
    val chips: List<OverlayChip>? = null,
    val chipStates: Map<String, Boolean> = emptyMap(),
    val title: String? = null,
    /** px, window-manager coordinates */
    val position: OverlayPoint = OverlayPoint(0, 0),
    /** dp */
    val miniSize: OverlaySize = OverlaySize(config.mini.width.default, config.mini.height.default),
    /** px, as last measured; 0×0 before the first layout */
    val windowSize: OverlaySize = OverlaySize(0, 0),
    /** px */
    val screen: OverlayScreen = OverlayScreen(0, 0),
    val density: Float = 1f,
    /** a card is showing under the pill (OverlayHost.setCard) */
    val cardShown: Boolean = false,
    /** the `overlay` slot is hidden (Settings → Appearance → Assets, or a host app): nothing is drawn, whatever `visible` says */
    val hidden: Boolean = false,
) {
    public val resolvedChips: List<ResolvedChip> get() = OverlayEngine.resolveChips(chips ?: config.pill.chips, chipStates)
    public val canDrag: Boolean get() = !config.positionLock
    public val titleText: String get() = title ?: config.pill.title
    /** the strip shows while the pill is off screen */
    public val stripWanted: Boolean get() = config.strip.show && !shown && !hidden
}

/**
 * The overlay every module talks to (registered as `axf.overlay` by [OverlayModule]). Show / hide the pill, put chips on it,
 * answer its quick action, log lines, fill the mini screen with any composable, show a card under the pill.
 */
public interface OverlayHost {
    public val state: StateFlow<OverlayState>
    public val log: OverlayLog

    public fun show()
    public fun hide()
    public fun toggle()
    /** The phone lets this app draw over others (SYSTEM_ALERT_WINDOW granted in system settings). */
    public fun canDraw(): Boolean
    /** Opens the system page where the user grants drawing over other apps. */
    public fun requestPermission()

    /** Replaces the chips on the pill (null = back to the asset's own). State per chip comes from [setChip]. */
    public fun setChips(chips: List<Chip>?)
    public fun setChip(id: String, on: Boolean)
    public fun setTitle(title: String?)
    /** What the pill's quick action does (the asset's `quickAction` spec is dispatched on the action bus when no handler is set). */
    public fun onQuickAction(handler: ((spec: String) -> Unit)?)

    /** Any app fills the mini screen with its own content (null empties it); [openMini] expands / collapses it. */
    public fun setMiniContent(content: (@Composable () -> Unit)?)
    public fun openMini(open: Boolean)
    public fun toggleMini()
    public fun openLog(open: Boolean)

    /** A card under the pill (the generalised tap-to-tune popup): its content gets a `dismiss`; null closes it. */
    public fun setCard(content: (@Composable (dismiss: () -> Unit) -> Unit)?)

    /** Forgets the dragged position and resized mini screen. */
    public fun resetGeometry()
}
