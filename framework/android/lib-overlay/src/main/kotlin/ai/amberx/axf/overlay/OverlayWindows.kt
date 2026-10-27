package ai.amberx.axf.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistry
import androidx.savedstate.SavedStateRegistryController
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner

/**
 * A Compose tree inside a window-manager window (no Activity): the window is its own lifecycle + saved-state owner, which
 * `ComposeView` needs before it composes. One per window (pill, strip). The detection overlay this comes from drew with a
 * custom View for that reason; owning the lifecycle here is what lets the pill be plain Compose on AXF theme tokens.
 */
internal class OverlayWindowOwner : LifecycleOwner, SavedStateRegistryOwner {
    private val registry = LifecycleRegistry(this)
    private val savedState = SavedStateRegistryController.create(this)
    override val lifecycle: Lifecycle get() = registry
    override val savedStateRegistry: SavedStateRegistry get() = savedState.savedStateRegistry

    fun create() { savedState.performRestore(null); registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE) }
    fun resume() { registry.handleLifecycleEvent(Lifecycle.Event.ON_START); registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME) }
    fun pause() { registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE); registry.handleLifecycleEvent(Lifecycle.Event.ON_STOP) }
    fun destroy() { if (registry.currentState != Lifecycle.State.DESTROYED) registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY) }

    fun attach(view: View) { view.setViewTreeLifecycleOwner(this); view.setViewTreeSavedStateRegistryOwner(this) }
}

/** One overlay window: a ComposeView with its owner, added to and removed from the WindowManager. */
internal class OverlayWindow(private val context: Context, private val wm: WindowManager, private val params: WindowManager.LayoutParams) {
    private val owner = OverlayWindowOwner()
    val view: ComposeView = ComposeView(context)
    var added: Boolean = false
        private set

    fun setContent(content: @Composable () -> Unit) {
        owner.create()
        owner.attach(view)
        view.setContent(content)
    }

    /** Adds the window; false when Android refused (no permission, bad token). */
    fun show(): Boolean {
        if (added) return true
        return try { wm.addView(view, params); owner.resume(); added = true; true } catch (e: Exception) { false }
    }

    fun update(change: WindowManager.LayoutParams.() -> Unit) {
        params.change()
        if (added) runCatching { wm.updateViewLayout(view, params) }
    }

    fun hide() {
        if (!added) return
        owner.pause()
        runCatching { wm.removeView(view) }
        added = false
    }

    fun destroy() { hide(); owner.destroy() }

    companion object {
        /** minSdk 26: the overlay type every app may use once the user grants SYSTEM_ALERT_WINDOW. */
        private fun type(): Int = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY

        /** The pill: wraps its content, top-left anchored at (x, y), touchable, never takes focus (keys keep going to the app below). */
        fun pillParams(x: Int, y: Int, alpha: Float): WindowManager.LayoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START; this.x = x; this.y = y; this.alpha = alpha }

        /** The collapsed strip: top-left, never touchable, so taps go through to whatever is under it. */
        fun stripParams(alpha: Float): WindowManager.LayoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT, type(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        ).apply { gravity = Gravity.TOP or Gravity.START; x = 0; y = 0; this.alpha = alpha }
    }
}
