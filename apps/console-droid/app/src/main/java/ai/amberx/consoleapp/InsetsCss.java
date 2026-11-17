package ai.amberx.consoleapp;

/**
 * The script that hands the safe area to the page: the --fx-safe-* tokens on {@code <html>} (framework/ui/axf.css reads
 * them for the frame, the bottom nav, sheets and toasts) and {@code data-axf-shell="android"}. Pure, so the exact text
 * is tested ({@code InsetsCssTest}).
 */
final class InsetsCss {
    private InsetsCss() {}

    static final String[] TOKENS = { "--fx-safe-top", "--fx-safe-right", "--fx-safe-bottom", "--fx-safe-left" };

    /** CSS px, never negative. */
    static String script(int top, int right, int bottom, int left) {
        int[] v = { top, right, bottom, left };
        StringBuilder b = new StringBuilder("(function(){var s=document.documentElement.style;");
        for (int k = 0; k < 4; k++) b.append("s.setProperty('").append(TOKENS[k]).append("','").append(Math.max(0, v[k])).append("px');");
        return b.append("document.documentElement.setAttribute('data-axf-shell','android');})()").toString();
    }
}
