package ai.amberx.axf.platform

import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebView
import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.ui.AxfRoot
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.fragment.app.FragmentActivity

/**
 * The single activity of an AXF app. Enables edge-to-edge, binds the permission host, keeps the
 * runtime's window width in sync (AxfRoot measures it) and renders [Content] inside [AxfRoot].
 * A FragmentActivity (still a ComponentActivity), so libraries can host BiometricPrompt and other
 * fragment-based system sheets.
 *
 *   class MainActivity : AxfActivity() {
 *       @Composable override fun Content() { AppShell(views = myViews) }
 *   }
 *
 * Apps holding secrets turn on [secureWindow] (override it, or set `android.secureWindow: true` in axf.manifest.json):
 * the window gets FLAG_SECURE (no screenshots, screen recording or recents preview) and WebView debugging is
 * switched off before any WebView exists.
 */
public abstract class AxfActivity : FragmentActivity() {
    public val app: AxfApplication get() = application as AxfApplication
    public val kernel: AxfKernel get() = app.kernel
    public lateinit var permissionHost: PermissionHost
        private set

    /**
     * Secure window: FLAG_SECURE on this activity's window and WebView remote debugging off. Default: the manifest's
     * `android.secureWindow` (false when absent). An app setting it in code overrides this.
     */
    protected open val secureWindow: Boolean get() = kernel.manifest.android?.secureWindow == true

    /** The app's shell, rendered inside [AxfRoot] (theme, locals and overlays are already provided). */
    @Composable
    protected abstract fun Content()

    /** Developer apps: the hub sign-in UI the waiting screen shows on "Sign in on the hub" (null = no button). */
    protected open val hubSignIn: (@Composable (done: () -> Unit) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        if (secureWindow) {
            // Before the first frame, so nothing is ever captured.
            window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
            runCatching { WebView.setWebContentsDebuggingEnabled(false) }
        }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        permissionHost = app.permissions.bind(this)
        // Deep links (axf://<appId>/<path>) are handed to the router when axf-nav is installed.
        intent?.dataString?.let { kernel.runtime.dispatch("deeplink", it) }
        setContent {
            AxfRoot(kernel = kernel, hubSignIn = hubSignIn) { Content() }
        }
    }

    /** Developer apps re-read their settings from the hub on every resume (UI-editor rule: fresh on focus). */
    override fun onResume() {
        super.onResume()
        if (kernel.runtime.hasAppearanceSource()) kernel.runtime.refreshFromSaved()
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        intent.dataString?.let { kernel.runtime.dispatch("deeplink", it) }
    }

    override fun onDestroy() {
        app.permissions.unbind()
        super.onDestroy()
    }
}
