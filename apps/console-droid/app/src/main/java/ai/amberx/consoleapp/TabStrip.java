package ai.amberx.consoleapp;

import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.List;

/**
 * The tab strip under the console page: one small row of tabs, + to add one, tap to switch, x to close
 * ({@link TabRules}). Native, because each tab is a whole WebView and the strip has to be there while a page loads or
 * is offline. It only draws and reports taps: {@link WebHost} owns the tabs.
 *
 * Look: every colour and size is the console's own token ({@link ShellTheme}: surface, text, muted, accent,
 * accent-text, radius-md, space, font-size), so it follows the active skin like the floating toolbar does. Attached
 * things never overlap: the tabs size to their labels, the row scrolls sideways when it is full, and + keeps its place
 * at the end.
 */
final class TabStrip extends LinearLayout {
    /** What a tap asks for. */
    interface Taps {
        void open();
        void select(String id);
        void close(String id);
    }

    private final Taps taps;
    private final HorizontalScrollView scroll;
    private final LinearLayout row;
    private final TextView plus;
    private TabRules.State shown;
    private List<String> titles;

    TabStrip(Context c, Taps taps) {
        super(c);
        this.taps = taps;
        setOrientation(HORIZONTAL);
        setGravity(Gravity.CENTER_VERTICAL);
        setContentDescription(c.getString(R.string.tabs_strip));
        scroll = new HorizontalScrollView(c);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setFillViewport(false);
        row = new LinearLayout(c);
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        scroll.addView(row, new HorizontalScrollView.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        addView(scroll, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        plus = text(c.getString(R.string.tabs_new_glyph));
        plus.setContentDescription(c.getString(R.string.tabs_new));
        plus.setOnClickListener(v -> this.taps.open());
        addView(plus, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
    }

    private TextView text(String s) {
        TextView t = new TextView(getContext());
        t.setText(s);
        t.setSingleLine(true);
        t.setEllipsize(TextUtils.TruncateAt.END);
        t.setGravity(Gravity.CENTER);
        t.setClickable(true);
        t.setFocusable(true);
        return t;
    }

    private int dp(float v) { return ShellTheme.dp(getContext(), v); }

    /** Draws the list: one tab each (label, x), the one on screen marked, scrolled into view. */
    void show(TabRules.State s, List<String> pageTitles) {
        shown = s;
        titles = pageTitles;
        Context c = getContext();
        int gap = dp(ShellTheme.gapDp);
        row.removeAllViews();
        View onScreen = null;
        for (int k = 0; k < s.size(); k++) {
            String id = s.ids.get(k);
            boolean active = id.equals(s.active);
            String name = TabRules.label(pageTitles != null && k < pageTitles.size() ? pageTitles.get(k) : "", k + 1);
            LinearLayout tab = new LinearLayout(c);
            tab.setOrientation(HORIZONTAL);
            tab.setGravity(Gravity.CENTER_VERTICAL);
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(active ? ShellTheme.accent : ShellTheme.bg);
            bg.setCornerRadius(dp(ShellTheme.radiusDp));
            tab.setBackground(bg);
            int ink = active ? ShellTheme.onAccent : ShellTheme.fg;
            TextView label = text(name);
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, ShellTheme.textSp);
            label.setTextColor(ink);
            label.setPadding(gap, gap / 2, gap / 2, gap / 2);
            label.setSelected(active);
            label.setOnClickListener(v -> taps.select(id));
            TextView x = text(c.getString(R.string.tabs_close_glyph));
            x.setTextSize(TypedValue.COMPLEX_UNIT_SP, ShellTheme.textSp);
            x.setTextColor(active ? ShellTheme.onAccent : ShellTheme.muted);
            x.setPadding(gap / 2, gap / 2, gap, gap / 2);
            x.setContentDescription(c.getString(R.string.tabs_close, name));
            x.setOnClickListener(v -> taps.close(id));
            tab.addView(label, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
            tab.addView(x, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
            LayoutParams lp = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
            lp.setMarginEnd(gap / 2);
            row.addView(tab, lp);
            if (active) onScreen = tab;
        }
        setBackgroundColor(ShellTheme.bg);
        plus.setTextSize(TypedValue.COMPLEX_UNIT_SP, ShellTheme.textSp);
        plus.setTextColor(TabRules.full(s) ? ShellTheme.muted : ShellTheme.fg);
        plus.setPadding(gap, gap / 2, gap, gap / 2);
        pad(lastPad);
        View target = onScreen;
        if (target != null) scroll.post(() -> scroll.smoothScrollTo(Math.max(0, target.getLeft() - gap), 0));
    }

    /** The active skin changed: the same list in the new colours and sizes. */
    void restyle() {
        if (shown != null) show(shown, titles);
    }

    private int[] lastPad = new int[4];

    /** Keeps the strip clear of the bars it sits against ({@link TabRules#stripPadding}: {left, top, right, bottom} px). */
    void pad(int[] p) {
        lastPad = p == null || p.length < 4 ? new int[4] : p;
        int gap = dp(ShellTheme.gapDp) / 2;
        setPadding(lastPad[0] + gap, lastPad[1] + gap, lastPad[2] + gap, lastPad[3] + gap);
    }
}
