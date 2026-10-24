package ai.amberx.axf.selection

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle

/**
 * Base for an entry in Android's text selection menu (the floating toolbar with Copy / Select all / … that every app
 * shows). Declare a subclass (or activity-aliases of one, one alias per entry) in the plugin's manifest with
 *
 *   <intent-filter><action android:name="android.intent.action.PROCESS_TEXT" />
 *       <category android:name="android.intent.category.DEFAULT" /><data android:mimeType="text/plain" /></intent-filter>
 *
 * and the entry's label as `android:label`. Use a translucent, no-history theme so nothing flashes. [onSelectedText]
 * gets the cleaned text; call [replaceSelection] to hand text back (editable fields only) or just return and the
 * activity finishes by itself unless [keepOpen] was called.
 */
public abstract class ProcessTextActivity : Activity() {
    private var keep = false
    private var answered = false

    /** Selections longer than this are cut (override per plugin, e.g. from a setting). */
    protected open fun maxChars(): Int = SelectionRules.DEFAULT_MAX_CHARS

    /** The entry tapped: the alias' simple class name when the entry is an activity-alias, else the activity's. */
    protected val entry: String get() = (intent?.component?.className ?: javaClass.name).substringAfterLast('.')

    protected abstract fun onSelectedText(selection: SelectedText)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val raw = intent?.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT)
        val readOnly = intent?.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true) ?: true
        val sel = SelectionRules.clean(raw, entry, readOnly, maxChars())
        runCatching { onSelectedText(sel) }
        if (!keep && !isFinishing) finishQuietly()
    }

    /** Stay open after [onSelectedText] (a dialog, a confirm step); call [finishQuietly] when done. */
    protected fun keepOpen() { keep = true }

    /** Hands [text] back to the app the selection came from; ignored for read-only selections. */
    protected fun replaceSelection(text: String) {
        if (intent?.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true) == false) {
            setResult(RESULT_OK, Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, text)); answered = true
        }
        finishQuietly()
    }

    protected fun finishQuietly() {
        if (!answered) setResult(RESULT_CANCELED)
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }
}

/**
 * Switches selection-menu entries on and off at run time. Android builds the menu from enabled components, so an
 * entry the user turns off in Settings disappears from every app's menu (no restart; some apps cache the menu until
 * their next selection). [className] = the activity or activity-alias, fully qualified or relative to the package.
 */
public object SelectionMenuEntries {
    private fun component(context: Context, className: String): ComponentName =
        ComponentName(context.packageName, if (className.startsWith(".")) context.packageName + className else className)

    public fun setEnabled(context: Context, className: String, on: Boolean) {
        val pm = context.packageManager
        val c = component(context, className)
        val want = if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        if (runCatching { pm.getComponentEnabledSetting(c) }.getOrNull() == want) return
        runCatching { pm.setComponentEnabledSetting(c, want, PackageManager.DONT_KILL_APP) }
    }

    /** True when the entry shows: enabled at run time, or left at its manifest default and declared enabled there. */
    public fun isEnabled(context: Context, className: String, manifestDefault: Boolean = true): Boolean =
        when (runCatching { context.packageManager.getComponentEnabledSetting(component(context, className)) }.getOrNull()) {
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED -> false
            else -> manifestDefault
        }

    /** Applies a whole set at once: every class in [all] is on exactly when it's in [on]. */
    public fun apply(context: Context, all: Collection<String>, on: Set<String>) { for (c in all) setEnabled(context, c, c in on) }
}
