package ai.amberx.consoleapp;

import android.content.Context;
import android.graphics.Color;
import android.util.TypedValue;

/**
 * The native pieces' look (floating toolbar, approval bar) comes from the console's active skin: the page reads its
 * own --fx-* tokens and hands them over with {@code axfNative.theme({...})} on load and on every skin change, so the
 * toolbar follows the hot-swappable asset system like the web console does. Until the page has said anything (first
 * start, offline) the values come from res/values/shell_tokens.xml, a copy of the framework's engine defaults (framework/ui/axf.css :root).
 */
final class ShellTheme {
    private ShellTheme() {}

    static int bg, fg, accent, onAccent, muted;
    /** --fx-radius-md and --fx-space in dp. */
    static float radiusDp, gapDp;
    /** --fx-font-size in sp. */
    static float textSp;
    private static boolean loaded;

    static void init(Context c) {
        if (loaded) return;
        loaded = true;
        bg = c.getColor(R.color.fx_surface);
        fg = c.getColor(R.color.fx_text);
        accent = c.getColor(R.color.fx_accent);
        onAccent = c.getColor(R.color.fx_accent_text);
        muted = c.getColor(R.color.fx_muted);
        float d = c.getResources().getDisplayMetrics().density;
        radiusDp = c.getResources().getDimension(R.dimen.fx_radius_md) / d;
        gapDp = c.getResources().getDimension(R.dimen.fx_space) / d;
        textSp = c.getResources().getDimension(R.dimen.fx_font_size) / d;
    }

    /** The tokens the shell asks the page for (getComputedStyle on :root). */
    static final String[] TOKENS = { "--fx-surface", "--fx-text", "--fx-accent", "--fx-accent-text", "--fx-muted", "--fx-radius-md", "--fx-space", "--fx-font-size" };

    /** Applies the tokens the page sent ({"--fx-surface":"#101418", "--fx-radius-md":"10px", …}); unknown or bad values are skipped. */
    static void apply(java.util.Map<String, String> tokens) {
        bg = color(tokens.get("--fx-surface"), bg);
        fg = color(tokens.get("--fx-text"), fg);
        accent = color(tokens.get("--fx-accent"), accent);
        onAccent = color(tokens.get("--fx-accent-text"), onAccent);
        muted = color(tokens.get("--fx-muted"), muted);
        radiusDp = px(tokens.get("--fx-radius-md"), radiusDp);
        gapDp = px(tokens.get("--fx-space"), gapDp);
        textSp = px(tokens.get("--fx-font-size"), textSp);
    }

    static int color(String css, int keep) {
        if (css == null) return keep;
        String s = css.trim();
        try {
            if (s.startsWith("#")) {
                if (s.length() == 4) s = "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
                if (s.length() == 9) s = "#" + s.substring(7, 9) + s.substring(1, 7); // #rrggbbaa → #aarrggbb
                return Color.parseColor(s);
            }
            if (s.startsWith("rgb")) {
                String[] p = s.substring(s.indexOf('(') + 1, s.indexOf(')')).split("[,/ ]+");
                int a = p.length > 3 ? Math.round(Math.min(1f, Float.parseFloat(p[3].trim())) * 255) : 255; // rgba(r g b / 0.5)
                return Color.argb(a, Integer.parseInt(p[0].trim()), Integer.parseInt(p[1].trim()), Integer.parseInt(p[2].trim()));
            }
        } catch (RuntimeException ignored) { /* keep */ }
        return keep;
    }

    /** "10px" / "0.625rem" (16px root) / "10" → 10. CSS px are dp on Android. */
    static float px(String css, float keep) {
        if (css == null) return keep;
        String s = css.trim();
        try {
            if (s.endsWith("rem")) return Float.parseFloat(s.substring(0, s.length() - 3)) * 16f;
            if (s.endsWith("px")) return Float.parseFloat(s.substring(0, s.length() - 2));
            return Float.parseFloat(s);
        } catch (RuntimeException e) { return keep; }
    }

    static int dp(Context c, float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, c.getResources().getDisplayMetrics()));
    }
}
