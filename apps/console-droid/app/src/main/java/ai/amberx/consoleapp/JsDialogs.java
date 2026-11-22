package ai.amberx.consoleapp;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.ContextWrapper;
import android.view.ContextThemeWrapper;
import android.view.WindowManager;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebView;
import android.widget.EditText;

/**
 * Draws a page's {@code alert()}, {@code confirm()} and {@code prompt()} when the WebView can't: in the expanded
 * overlay, as a system dialog in an overlay window ({@link DialogRules}). While an activity shows the page the
 * WebView's own dialog is used. Every path answers the page exactly once, so its script never hangs.
 */
final class JsDialogs {
    private JsDialogs() {}

    static final int ALERT = 0, CONFIRM = 1, PROMPT = 2;

    /** True when the shell took the dialog (answered or will answer {@code result}); false leaves it to the WebView. */
    static boolean ask(WebView view, int kind, String url, String message, String defaultValue, JsResult result) {
        Context c = view.getContext();
        Activity a = activityOf(c);
        String where = DialogRules.where(a != null && !a.isFinishing() && !a.isDestroyed(), view.isAttachedToWindow(), Perms.has(c, Perms.OVERLAY));
        if (DialogRules.ACTIVITY.equals(where)) return false;
        if (DialogRules.NONE.equals(where)) { result.cancel(); return true; }
        final boolean[] answered = { false };
        try {
            Context themed = new ContextThemeWrapper(c.getApplicationContext(), android.R.style.Theme_DeviceDefault_Dialog_Alert);
            AlertDialog.Builder b = new AlertDialog.Builder(themed).setTitle(DialogRules.title(url)).setMessage(message);
            final EditText input = kind == PROMPT ? new EditText(themed) : null;
            if (input != null) { input.setText(defaultValue == null ? "" : defaultValue); b.setView(input); }
            b.setPositiveButton(DialogRules.OK, (d, w) -> {
                answered[0] = true;
                if (input != null && result instanceof JsPromptResult) ((JsPromptResult) result).confirm(input.getText().toString());
                else result.confirm();
            });
            if (kind != ALERT) b.setNegativeButton(DialogRules.CANCEL, (d, w) -> { answered[0] = true; result.cancel(); });
            // back, a tap outside or the window going away: the page hears "no" (an alert just ends)
            b.setOnDismissListener(d -> { if (!answered[0]) { answered[0] = true; result.cancel(); } });
            AlertDialog dialog = b.create();
            if (dialog.getWindow() != null) dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY);
            dialog.show();
        } catch (RuntimeException e) {
            if (!answered[0]) { answered[0] = true; result.cancel(); }
        }
        return true;
    }

    private static Activity activityOf(Context c) {
        for (Context x = c; x instanceof ContextWrapper; x = ((ContextWrapper) x).getBaseContext()) if (x instanceof Activity) return (Activity) x;
        return null;
    }
}
