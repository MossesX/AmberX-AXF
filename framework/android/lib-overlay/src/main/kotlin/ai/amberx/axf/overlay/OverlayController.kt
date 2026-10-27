package ai.amberx.axf.overlay

import ai.amberx.axf.kernel.engine.OverlayData
import ai.amberx.axf.kernel.engine.OverlayEngine
import ai.amberx.axf.kernel.engine.OverlayPoint
import ai.amberx.axf.kernel.engine.OverlayScreen
import ai.amberx.axf.kernel.engine.OverlaySize
import ai.amberx.axf.kernel.platform.KeyValueStore
import androidx.compose.runtime.Composable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The overlay's state machine: everything [OverlayHost] does, minus Android. The service and the Compose pill read
 * [state] and call the geometry methods; the module wires [onVisibility] (start / stop the service), [canDrawCheck] and
 * [permissionRequest] (system settings) and [dispatch] (the action bus). Position (px) and mini size (dp) persist in the
 * KV store under the engine's `axf.overlay.position` / `axf.overlay.size` keys. Unit-tested on the JVM (OverlayControllerTest).
 */
public class OverlayController(
    private val configProvider: () -> OverlayData,
    private val kv: KeyValueStore?,
    private val now: () -> Long = { System.currentTimeMillis() },
    /** The `overlay` slot is hidden (hide engine): the pill and strip stay off screen while it says so. */
    private val hiddenProvider: () -> Boolean = { false },
) : OverlayHost {
    private val _state = MutableStateFlow(initial(configProvider(), kv, hiddenProvider()))
    override val state: StateFlow<OverlayState> get() = _state.asStateFlow()
    override val log: OverlayLog = OverlayLog({ _state.value.config.log.maxLines }, now)

    private val _miniContent = MutableStateFlow<(@Composable () -> Unit)?>(null)
    public val miniContent: StateFlow<(@Composable () -> Unit)?> get() = _miniContent.asStateFlow()
    private val _card = MutableStateFlow<(@Composable (dismiss: () -> Unit) -> Unit)?>(null)
    public val card: StateFlow<(@Composable (dismiss: () -> Unit) -> Unit)?> get() = _card.asStateFlow()

    private var quickAction: ((String) -> Unit)? = null
    /** Set by the module: start / stop the service when `visible` changes. */
    public var onVisibility: ((Boolean) -> Unit)? = null
    /** Set by the module: Settings.canDrawOverlays. Without it the controller assumes yes. */
    public var canDrawCheck: (() -> Boolean)? = null
    public var permissionRequest: (() -> Unit)? = null
    /** Set by the module: runs an action spec (the asset's quick action when the app set no handler). */
    public var dispatch: ((String) -> Unit)? = null

    public val current: OverlayState get() = _state.value

    /* ---------- config ---------- */

    /** Re-reads the asset + settings (after a swap, a settings change or a screen change) and re-clamps everything. */
    public fun refreshConfig() {
        val c = configProvider()
        _state.update { s ->
            val screenDp = screenDp(s.screen, s.density)
            val mini = OverlayEngine.miniSize(c, s.miniSize, screenDp)
            s.copy(config = c, hidden = hiddenProvider(), miniSize = mini, logOpen = if (s.config.log.show == c.log.show) s.logOpen else c.log.show)
        }
        log.trim()
        clampAll()
    }

    /** The service reports the screen it draws on (px) and its density; sizes are kept in dp, positions in px. */
    public fun attachScreen(widthPx: Int, heightPx: Int, density: Float) {
        _state.update { it.copy(screen = OverlayScreen(widthPx, heightPx), density = if (density > 0f) density else 1f) }
        clampAll()
    }

    /** The pill measured itself (px): positions are clamped against it so the window never leaves the screen. */
    public fun reportWindowSize(widthPx: Int, heightPx: Int) {
        val s = _state.value
        if (s.windowSize.width == widthPx && s.windowSize.height == heightPx) return
        _state.update { it.copy(windowSize = OverlaySize(widthPx, heightPx)) }
        clampAll()
    }

    /* ---------- visibility ---------- */

    override fun show() { setVisible(true) }
    override fun hide() { setVisible(false) }
    override fun toggle() { setVisible(!_state.value.visible) }
    private fun setVisible(v: Boolean) {
        if (_state.value.visible == v) return
        _state.update { it.copy(visible = v, shown = if (v) it.shown else false, cardShown = if (v) it.cardShown else false) }
        if (!v) _card.value = null
        onVisibility?.invoke(v)
    }
    /** The service says the window is (not) on screen. */
    public fun setShown(shown: Boolean) { _state.update { if (it.shown == shown) it else it.copy(shown = shown) } }
    override fun canDraw(): Boolean = canDrawCheck?.invoke() ?: true
    override fun requestPermission() { permissionRequest?.invoke() }

    /* ---------- chips / title / quick action ---------- */

    override fun setChips(chips: List<Chip>?) {
        val engine = chips?.map { it.toEngine() }?.distinctBy { it.id }?.take(OverlayEngine.Limits.CHIPS_MAX)
        _state.update { it.copy(chips = engine) }
    }
    override fun setChip(id: String, on: Boolean) { _state.update { it.copy(chipStates = OverlayEngine.setChip(it.chipStates, id, on)) } }
    override fun setTitle(title: String?) { _state.update { it.copy(title = title?.take(40)) } }
    override fun onQuickAction(handler: ((String) -> Unit)?) { quickAction = handler }
    /** The pill's action button was tapped: the app's handler, else the asset's spec on the action bus. */
    public fun quickActionTapped() {
        val spec = _state.value.config.pill.quickAction
        val h = quickAction
        if (h != null) h(spec) else if (spec.isNotEmpty()) dispatch?.invoke(spec)
    }

    /* ---------- mini / log / card ---------- */

    override fun setMiniContent(content: (@Composable () -> Unit)?) { _miniContent.value = content }
    override fun openMini(open: Boolean) { _state.update { if (it.miniOpen == open) it else it.copy(miniOpen = open) } }
    override fun toggleMini() { openMini(!_state.value.miniOpen) }
    override fun openLog(open: Boolean) { _state.update { if (it.logOpen == open) it else it.copy(logOpen = open) } }
    override fun setCard(content: (@Composable (dismiss: () -> Unit) -> Unit)?) { _card.value = content; _state.update { it.copy(cardShown = content != null) } }
    public fun dismissCard() { setCard(null) }

    /* ---------- geometry ---------- */

    /** Dragged by (dx, dy) px: moves inside the screen (nothing while the position is locked). */
    public fun moveBy(dxPx: Float, dyPx: Float) {
        val s = _state.value
        if (!s.canDrag) return
        moveTo(s.position.x + dxPx, s.position.y + dyPx)
    }
    public fun moveTo(xPx: Float, yPx: Float) {
        val s = _state.value
        // before the service attached a screen nothing is known to clamp against: keep the point, the clamp comes with the screen
        val p = if (s.screen.width > 0 && s.screen.height > 0) OverlayEngine.clampPosition(xPx.toDouble(), yPx.toDouble(), s.windowSize, s.screen)
            else OverlayPoint(Math.round(xPx), Math.round(yPx))
        if (p == s.position) return
        _state.update { it.copy(position = p) }
        kv?.put(OverlayEngine.Settings.POSITION, OverlayEngine.serializePosition(p))
    }

    /** The resize corner was dragged by (dw, dh) px: the mini screen grows or shrinks inside its range and the screen. */
    public fun resizeBy(dwPx: Float, dhPx: Float) {
        val s = _state.value
        val d = s.density
        resizeTo(s.miniSize.width + dwPx / d, s.miniSize.height + dhPx / d)
    }
    public fun resizeTo(widthDp: Float, heightDp: Float) {
        val s = _state.value
        // dragged past zero = as small as it goes (the engine reads a non-positive size as junk and would reset to the defaults)
        val size = OverlayEngine.miniSize(s.config, widthDp.coerceAtLeast(1f).toDouble(), heightDp.coerceAtLeast(1f).toDouble(), screenDp(s.screen, s.density))
        if (size == s.miniSize) return
        _state.update { it.copy(miniSize = size) }
        kv?.put(OverlayEngine.Settings.SIZE, OverlayEngine.serializeSize(size))
    }

    override fun resetGeometry() {
        kv?.remove(OverlayEngine.Settings.POSITION)
        kv?.remove(OverlayEngine.Settings.SIZE)
        _state.update { s -> s.copy(position = OverlayPoint(0, 0), miniSize = OverlayEngine.miniSize(s.config, null as OverlaySize?, screenDp(s.screen, s.density))) }
        clampAll()
    }

    private fun clampAll() {
        _state.update { s ->
            val screenDp = screenDp(s.screen, s.density)
            s.copy(
                miniSize = OverlayEngine.miniSize(s.config, s.miniSize, screenDp),
                position = if (s.screen.width > 0 && s.screen.height > 0) OverlayEngine.clampPosition(s.position, s.windowSize, s.screen) else s.position,
            )
        }
    }

    public companion object {
        internal fun screenDp(screenPx: OverlayScreen, density: Float): OverlayScreen {
            val d = if (density > 0f) density else 1f
            // an unknown screen (0×0 before the service attached one) clamps nothing: the engine's own limits still apply
            return if (screenPx.width <= 0 || screenPx.height <= 0) OverlayScreen(OverlayEngine.Limits.WIDTH_MAX, OverlayEngine.Limits.HEIGHT_MAX) else OverlayScreen((screenPx.width / d).toInt(), (screenPx.height / d).toInt())
        }

        /** The saved position / size (if any) over the config's defaults; junk in the store is ignored. */
        internal fun initial(config: OverlayData, kv: KeyValueStore?, hidden: Boolean = false): OverlayState {
            val pos = OverlayEngine.parsePosition(kv?.get(OverlayEngine.Settings.POSITION))?.let { OverlayPoint(Math.round(it.first).toInt(), Math.round(it.second).toInt()) } ?: OverlayPoint(0, 0)
            val size = OverlayEngine.parseSize(kv?.get(OverlayEngine.Settings.SIZE))
            val unbounded = OverlayScreen(OverlayEngine.Limits.WIDTH_MAX, OverlayEngine.Limits.HEIGHT_MAX)
            val mini = OverlayEngine.miniSize(config, size?.first, size?.second, unbounded)
            return OverlayState(config = config, miniOpen = config.mini.defaultOpen, logOpen = config.log.show, position = pos, miniSize = mini, hidden = hidden)
        }
    }
}
