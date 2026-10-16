package ai.amberx.axf.platform

import android.os.Bundle
import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.ui.AxfRoot
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable

/**
 * The single activity of an AXF app. Enables edge-to-edge, binds the permission host, keeps the
 * runtime's window width in sync (AxfRoot measures it) and renders [Content] inside [AxfRoot].
 *
 *   class MainActivity : AxfActivity() {
 *       @Composable override fun Content() { AppShell(views = myViews) }
 *   }
 */
public abstract class AxfActivity : ComponentActivity() {
    public val app: AxfApplication get() = application as AxfApplication
    public val kernel: AxfKernel get() = app.kernel
    public lateinit var permissionHost: PermissionHost
        private set

    /** The app's shell, rendered inside [AxfRoot] (theme, locals and overlays are already provided). */
    @Composable
    protected abstract fun Content()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        permissionHost = app.permissions.bind(this)
        // Deep links (axf://<appId>/<path>) are handed to the router when axf-nav is installed.
        intent?.dataString?.let { kernel.runtime.dispatch("deeplink", it) }
        setContent {
            AxfRoot(kernel = kernel) { Content() }
        }
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
