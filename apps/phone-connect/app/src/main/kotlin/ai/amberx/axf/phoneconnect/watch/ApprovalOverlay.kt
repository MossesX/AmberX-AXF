package ai.amberx.axf.phoneconnect.watch

import android.app.KeyguardManager
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.ui.graphics.toArgb
import ai.amberx.axf.phoneconnect.link.LinkRules
import ai.amberx.axf.phoneconnect.link.PhoneStore
import ai.amberx.axf.platform.AxfApplication
import ai.amberx.axf.ui.theme.AxfTheme

/**
 * A held approval on top of whatever is on screen: one card per approval with Approve and Deny (and Shelve on a
 * countdown that offers it) right on it, so nothing has to be opened first. Needs "display over other apps"; without
 * it the approval notification, which is always posted too, is the only prompt.
 *
 * A tap on a button is Brett's decision and takes the same road as a tap on the notification's action
 * ([WatchService.decideIntent]: personOnly, a fresh tap id over the device token). The app never decides by itself:
 * - Android does not draw this window over the lock screen, and a tap while the phone is locked is ignored;
 * - a tap that reaches a button through another app's window is dropped (filterTouchesWhenObscured).
 *
 * A plain View window (a service has no Compose host); every colour, size, radius and border is read from the
 * compiled theme tokens ([AxfTheme]), so the card follows the look like the rest of the app.
 */
object ApprovalOverlay {
    private val ui = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private val cards = LinkedHashMap<String, Card>()

    private class Card(val view: LinearLayout, val body: TextView, val buttons: LinearLayout)

    fun allowed(ctx: Context): Boolean = Settings.canDrawOverlays(ctx)

    private fun theme(ctx: Context): AxfTheme? =
        runCatching { AxfTheme.from((ctx.applicationContext as AxfApplication).kernel.runtime.compiled.value.theme) }.getOrNull()

    /**
     * Shows (or replaces) the card for [approvalId]. False when it can't be shown (no permission, no theme yet): the
     * notification carries the prompt alone. [seconds] > 0 takes the card away when the countdown is over.
     */
    fun show(ctx: Context, commandId: String, approvalId: String, title: String, text: String, actions: List<String>, seconds: Int): Boolean {
        val app = ctx.applicationContext
        if (!allowed(app) || !LinkRules.isUuid(commandId) || !LinkRules.isUuid(approvalId)) return false
        val t = theme(app) ?: return false
        ui.post { runCatching { render(app, t, commandId, approvalId, title, text, actions, seconds) } }
        return true
    }

    /** What the card says once Brett tapped, here or on the notification: "Sending…", then the outcome. It leaves by itself once done. */
    fun outcome(approvalId: String, text: String, done: Boolean) {
        ui.post {
            val c = cards[approvalId] ?: return@post
            c.body.text = text
            c.buttons.visibility = View.GONE
            if (done) ui.postDelayed({ remove(approvalId) }, LinkRules.OUTCOME_SHOWN_MS)
        }
    }

    fun dismiss(approvalId: String) { ui.post { remove(approvalId) } }

    private fun px(ctx: Context, dp: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, dp, ctx.resources.displayMetrics).toInt()

    private fun label(ctx: Context, text: String, sizeSp: Float, color: Int, bold: Boolean = false): TextView = TextView(ctx).apply {
        this.text = text
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun box(color: Int, radius: Int, border: Int = 0, borderColor: Int = 0): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius.toFloat()
        if (border > 0) setStroke(border, borderColor)
    }

    private fun render(ctx: Context, t: AxfTheme, commandId: String, approvalId: String, title: String, text: String, actions: List<String>, seconds: Int) {
        val wm = ctx.getSystemService(WindowManager::class.java) ?: return
        val one = px(ctx, t.spacing.one.value)
        val two = px(ctx, t.spacing.two.value)
        val host = root ?: LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(one, one + topInset(wm), one, one)
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT,
            ).apply { gravity = Gravity.TOP }
            wm.addView(this, lp)
            root = this
        }
        cards.remove(approvalId)?.let { host.removeView(it.view) } // a prompt sent again replaces the first

        val body = label(ctx, text, t.typography.bodyMedium.fontSize.value, t.colors.muted.toArgb())
        val buttons = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        val card = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            background = box(t.colors.surface.toArgb(), px(ctx, t.shapes.lg.value), px(ctx, t.spacing.borderWidth.value).coerceAtLeast(1), t.colors.border.toArgb())
            elevation = px(ctx, t.elevation(3).value).toFloat()
            setPadding(two, two, two, two)
            addView(label(ctx, title, t.typography.titleMedium.fontSize.value, t.colors.text.toArgb(), bold = true))
            addView(body, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = one / 2 })
            addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = one })
            // the detail: a tap on the words opens that approval in the console
            setOnClickListener {
                LinkRules.consoleApproval(PhoneStore(ctx).origin, approvalId)?.let { page -> Pages.open(ctx, page, chrome = true) }
            }
        }
        val touch = px(ctx, t.spacing.touchTarget.value)
        fun button(caption: String, bg: Int, fg: Int, onTap: () -> Unit) {
            val b = label(ctx, caption, t.typography.labelLarge.fontSize.value, fg, bold = true).apply {
                gravity = Gravity.CENTER
                minHeight = touch
                background = box(bg, px(ctx, t.shapes.md.value))
                setPadding(two, 0, two, 0)
                filterTouchesWhenObscured = true // a tap through another app's window is never a decision
                setOnClickListener { onTap() }
            }
            buttons.addView(b, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { if (buttons.childCount > 0) marginStart = one })
        }
        for (decision in LinkRules.DECISIONS) {
            if (decision !in actions) continue
            val (bg, fg) = when (decision) {
                "approve" -> t.colors.accent to t.colors.accentText
                "deny" -> t.colors.danger to t.colors.onDanger
                else -> t.colors.surface3 to t.colors.text
            }
            button(LinkRules.decisionLabel(decision), bg.toArgb(), fg.toArgb()) { tapped(ctx, commandId, approvalId, decision) }
        }
        // hides the card only: the approval still waits, on the notification and in the console
        button("Hide", t.colors.surface2.toArgb(), t.colors.muted.toArgb()) { remove(approvalId) }

        host.addView(card, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = one })
        cards[approvalId] = Card(card, body, buttons)
        // once the countdown is over the hub has run it: the prompt goes by itself
        if (seconds > 0) ui.postDelayed({ if (cards[approvalId]?.view === card) remove(approvalId) }, seconds * 1000L)
    }

    /** Brett's tap on Approve / Deny / Shelve. Ignored while the phone is locked: a decision needs it unlocked. */
    private fun tapped(ctx: Context, commandId: String, approvalId: String, decision: String) {
        if (ctx.getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true) return
        outcome(approvalId, "Sending your answer…", done = false)
        WatchService.decide(ctx, commandId, approvalId, decision)
    }

    private fun remove(approvalId: String) {
        val c = cards.remove(approvalId) ?: return
        val host = root ?: return
        host.removeView(c.view)
        if (cards.isEmpty()) {
            runCatching { host.context.getSystemService(WindowManager::class.java)?.removeView(host) }
            root = null
        }
    }

    /** The status bar / cutout height, so the card sits below them. */
    private fun topInset(wm: WindowManager): Int =
        if (Build.VERSION.SDK_INT >= 30) wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars() or WindowInsets.Type.displayCutout()).top
        else 0
}
