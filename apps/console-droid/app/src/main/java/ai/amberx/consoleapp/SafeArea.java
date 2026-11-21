package ai.amberx.consoleapp;

/**
 * Where the floating toolbar and the expanded console go inside the safe area (part 2, s4). Pure (no Android imports),
 * so every side and every rotation is tested ({@code SafeAreaTest}). Insets are {top, right, bottom, left} in px: the
 * status bar and display cutout (notch, punch hole), the navigation bar and the keyboard, on whichever side Android
 * puts them (landscape moves the cutout and the navigation bar to the left or right).
 */
final class SafeArea {
    private SafeArea() {}

    static final int TOP = 0, RIGHT = 1, BOTTOM = 2, LEFT = 3;

    static int[] safe(int[] in) {
        int[] o = new int[4];
        if (in != null) for (int k = 0; k < 4 && k < in.length; k++) o[k] = Math.max(0, in[k]);
        return o;
    }

    /** The toolbar's x offset from its edge ("start" = left, "end" = right): clear of a side cutout or navigation bar. */
    static int toolbarX(String edge, int[] insets) {
        int[] i = safe(insets);
        return "start".equals(edge) ? i[LEFT] : i[RIGHT];
    }

    /**
     * The toolbar's y for the top setting (percent of the screen height), between the status bar / cutout and the
     * bottom bar: never above the clock or the camera, never under the navigation bar or the keyboard.
     */
    static int toolbarY(int topPercent, int screenH, int toolbarH, int[] insets) {
        int[] i = safe(insets);
        int want = Math.round(Math.max(0, screenH) * OverlayRules.clamp(topPercent, 0, 90) / 100f);
        return clampY(want, screenH, toolbarH, i);
    }

    /** A dragged y kept inside the same band. */
    static int clampY(int y, int screenH, int toolbarH, int[] insets) {
        int[] i = safe(insets);
        int max = Math.max(i[TOP], screenH - i[BOTTOM] - Math.max(0, toolbarH));
        return Math.max(i[TOP], Math.min(max, y));
    }

    /** The docked toolbar's margins in the expanded console, {left, top}: inside the safe area's top-left corner. */
    static int[] dock(int[] insets) {
        int[] i = safe(insets);
        return new int[] { i[LEFT], i[TOP] };
    }

    /**
     * The window root's padding {left, top, right, bottom}. While the page doesn't pad itself the shell pads all four
     * sides (and the docked toolbar's strip below the top). Once it does: nothing, except with the toolbar docked,
     * when the shell owns the whole top strip (status bar + toolbar) and the page gets the other three sides.
     */
    static int[] rootPadding(int[] insets, int dockPx, boolean pageHandles) {
        int[] i = safe(insets);
        int dock = Math.max(0, dockPx);
        if (!pageHandles) return new int[] { i[LEFT], i[TOP] + dock, i[RIGHT], i[BOTTOM] };
        if (dock > 0) return new int[] { 0, i[TOP] + dock, 0, 0 };
        return new int[4];
    }

    /** The --fx-safe-* values the page gets {top, right, bottom, left}: what the root padding doesn't already cover. */
    static int[] pageInsets(int[] insets, int dockPx, boolean pageHandles) {
        int[] i = safe(insets);
        if (!pageHandles) return new int[4];
        if (dockPx > 0) return new int[] { 0, i[RIGHT], i[BOTTOM], i[LEFT] };
        return i;
    }
}
