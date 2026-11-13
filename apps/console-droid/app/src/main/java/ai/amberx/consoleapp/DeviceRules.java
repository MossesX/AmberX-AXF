package ai.amberx.consoleapp;

import java.util.regex.Pattern;

/**
 * The pure rules behind {@link DeviceTools} (console app part 3, s3): where a page opens, which page a console wake
 * opens, notification ids. No Android imports: JUnit {@code DeviceRulesTest}.
 */
final class DeviceRules {
    private DeviceRules() {}

    static final String APP = "app";
    static final String BROWSER = "browser";
    static final String OPEN_NOTE = "axf-open-url";
    static final String WAKE_NOTE = "axf-console-wake";
    /** A console-control@1 address or action id: {@code settings}, {@code panel:phone-app}, {@code plugin:notes/open}. */
    private static final Pattern TARGET = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,199}$");
    private static final Pattern NOTE_ID = Pattern.compile("^[A-Za-z0-9_.:-]{1,64}$");

    /** {@code where}: {@code browser} (the phone's browser) or the console app itself (anything else). */
    static String where(String raw) {
        return raw != null && BROWSER.equals(raw.trim().toLowerCase(java.util.Locale.ROOT)) ? BROWSER : APP;
    }

    static boolean validTarget(String t) { return t != null && TARGET.matcher(t).matches(); }

    /**
     * The page a wake opens: the console at {@code ?axf-open=<target>} for a console-control address, else {@code url}
     * when it is one of Brett's pages, else the console's home.
     */
    static String wakeUrl(String target, String url) {
        String t = target == null ? "" : target.trim();
        if (!t.isEmpty()) {
            if (!validTarget(t)) throw new IllegalArgumentException("target isn't a console address: " + t);
            return ShellRules.HOME + "?" + ShellRules.OPEN_PARAM + "=" + ShellRules.encode(t);
        }
        return url == null || url.trim().isEmpty() ? ShellRules.HOME : ShellRules.linkOr(url.trim(), ShellRules.HOME);
    }

    /** A notification's id: the caller's when it is a sane one, else one derived from the title (same title replaces). */
    static String noteId(String raw, String title) {
        String id = raw == null ? "" : raw.trim();
        if (NOTE_ID.matcher(id).matches()) return id;
        return "note-" + Integer.toHexString((title == null ? "" : title).hashCode());
    }
}
