package ai.amberx.axf.phoneconnect.overlay

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.ComposeView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.savedstate.SavedStateRegistryOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner

/** Always-on-top windows ("display over other apps") holding Compose content, owned by the overlay service. */
class OverlayWindows(private val context: Context, private val owner: LifecycleOwner, private val saved: SavedStateRegistryOwner) {
    private val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val views = mutableMapOf<String, Pair<View, WindowManager.LayoutParams>>()

    fun params(gravity: Int, x: Int = 0, y: Int = 0, focusable: Boolean = false): WindowManager.LayoutParams = WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
        if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE,
        (if (focusable) 0 else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).also { it.gravity = gravity; it.x = x; it.y = y }

    fun show(id: String, lp: WindowManager.LayoutParams, content: @Composable () -> Unit) {
        hide(id)
        val v = ComposeView(context).apply {
            setViewTreeLifecycleOwner(owner)
            setViewTreeSavedStateRegistryOwner(saved)
            setContent { OverlayTheme(context) { content() } }
        }
        wm.addView(v, lp)
        views[id] = v to lp
    }

    fun move(id: String, x: Int, y: Int) {
        val (v, lp) = views[id] ?: return
        lp.x = x; lp.y = y
        wm.updateViewLayout(v, lp)
    }

    fun position(id: String): Pair<Int, Int>? = views[id]?.second?.let { it.x to it.y }

    fun hide(id: String) { views.remove(id)?.let { (v, _) -> runCatching { wm.removeView(v) } } }
    fun hideAll() { views.keys.toList().forEach(::hide) }

    companion object {
        fun gravityOf(position: String): Int = when (position) {
            "bottom" -> Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            "center", "from-button" -> Gravity.CENTER
            "top-left" -> Gravity.TOP or Gravity.START
            "top-right" -> Gravity.TOP or Gravity.END
            "bottom-left" -> Gravity.BOTTOM or Gravity.START
            "bottom-right" -> Gravity.BOTTOM or Gravity.END
            else -> Gravity.TOP or Gravity.CENTER_HORIZONTAL
        }
    }
}
