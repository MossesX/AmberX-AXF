package ai.amberx.droid;

import android.content.Context;
import android.content.SharedPreferences;
import java.net.URLEncoder;
import java.util.Locale;

/**
 * Which server the phone app talks to (build move-amberx-web-app-into-the-console-amberx-andr, s12 / s13; contract
 * docs/contracts/amberx-console-api.md). Brett, Nov 12 2026: "I want to get rid of the AmberX app and make a console app."
 *
 * The app is the Dev Console: it loads https://console.amberxai.com and its native side (alerts, open_url, recorder
 * uploads) talks to the console. The backend switch (`amberx.backend`, `console` by default, or `amberx-web`) brings back
 * the old AmberX web app without a new APK if a console deploy goes wrong; it is read once at start, so a change takes
 * effect the next time the app opens. Sign-in stays axHub's (the one hub session covers both hosts).
 *
 * Everything here but {@link #get} / {@link #set} is pure, so the JVM unit tests (ConsoleBackendTest) run it.
 */
final class ConsoleBackend {
    private ConsoleBackend() {}

    static final String CONSOLE = "console";
    static final String AMBERX_WEB = "amberx-web";
    static final String CONSOLE_URL = HubRules.CONSOLE;
    static final String AMBERX_URL = "https://amberx.amberxai.com";
    static final String HUB_HOST = "axhub.amberxai.com";
    /** The hub-settings@1 key the console and the web side write (Settings → Plugins → AmberX, `backend`). */
    static final String SETTING = "amberx.backend";
    static final String PREFS = "amberx.backend";

    /** `console` unless the value is exactly `amberx-web` (anything unknown falls back to the console). */
    static String normalize(String raw) {
        String s = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        return AMBERX_WEB.equals(s) ? AMBERX_WEB : CONSOLE;
    }

    /** The site the app shows. */
    static String siteUrl(String backend) {
        return AMBERX_WEB.equals(normalize(backend)) ? AMBERX_URL : CONSOLE_URL;
    }

    /** Hosts the WebView may navigate to: the site picked, the other one (the switch back and forth), the hub. */
    static String[] allowNavigation(String backend) {
        return AMBERX_WEB.equals(normalize(backend))
            ? new String[] { "amberx.amberxai.com", "console.amberxai.com", HUB_HOST }
            : new String[] { "console.amberxai.com", "amberx.amberxai.com", HUB_HOST };
    }

    /** True when the native side talks to the console (alerts with the device's history, open_url, recordings). */
    static boolean console(String backend) { return CONSOLE.equals(normalize(backend)); }

    static String enc(String s) {
        try { return URLEncoder.encode(s == null ? "" : s, "UTF-8"); } catch (java.io.UnsupportedEncodingException e) { return ""; }
    }

    /** The alerts feed for this phone (C33): the phone's view, recorded in the device's notification history (C35b). */
    static String alertsUrl(String device) {
        String d = device == null ? "" : device.trim();
        return CONSOLE_URL + HubRules.ALERTS_PATH + "?view=phone" + (d.isEmpty() ? "" : "&device=" + enc(d));
    }

    /** A tap on a console alert (C35b tappedAt). */
    static String alertTappedUrl() { return CONSOLE_URL + HubRules.ALERTS_PATH + "/tapped"; }

    /** Pages queued for this phone to open (C31, console-commands open-url). */
    static String openUrlPendingUrl(String device) {
        return CONSOLE_URL + "/api/plugins/console-commands/open-url/pending?device=" + enc(device);
    }

    /** The phone's answer for one queued page. */
    static String openUrlAnswerUrl(String id) {
        return CONSOLE_URL + "/api/plugins/console-commands/open-url/" + enc(id) + "/answer";
    }

    /** One audio part of a recording on the console (C25). */
    static String recordingPartUrl(String id, int n) {
        return CONSOLE_URL + "/api/plugins/output-recorder/recordings/" + enc(id) + "/parts/" + n;
    }

    /** A recording's index on the console (C26): the answer's `confirmed` says when the phone may delete its copy. */
    static String recordingIndexUrl(String id) {
        return CONSOLE_URL + "/api/plugins/output-recorder/recordings/" + enc(id);
    }

    /** The recorder's state as the phone publishes it (C30 device/status). */
    static String recorderStatusUrl() { return CONSOLE_URL + "/api/plugins/output-recorder/device/status"; }

    /** The console's `backend` setting (amberx-settings plugin, s13): the switch the console, MCP, CLI and voice change. */
    static String backendSettingUrl() { return CONSOLE_URL + "/api/plugins/amberx-settings/settings/backend"; }

    /** The backend in the console's answer for {@link #backendSettingUrl}, or null when the answer isn't one. */
    static String backendOf(int status, String body) {
        if (status != 200 || body == null) return null;
        try {
            org.json.JSONObject s = new org.json.JSONObject(body).optJSONObject("setting");
            return s == null || !s.has("value") ? null : normalize(s.optString("value", ""));
        } catch (Exception e) {
            return null;
        }
    }

    /** The backend saved on this phone (console when never set). */
    static String get(Context c) {
        return normalize(c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("backend", CONSOLE));
    }

    /** Saves the backend; true when it changed (the app shows it from the next start). */
    static boolean set(Context c, String backend) {
        String want = normalize(backend);
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (want.equals(normalize(p.getString("backend", CONSOLE)))) return false;
        p.edit().putString("backend", want).apply();
        return true;
    }
}
