package ai.amberx.droid;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import com.getcapacitor.JSObject;
import java.security.SecureRandom;
import org.json.JSONObject;

/**
 * AmberX's AXPP link to axHub (axHub decision #108): the phone is the `amberx` device service, so Claude can drive the
 * Audio Output Recorder through axHub's MCP (`amberx.recorder_start|stop|status`).
 *
 * One background thread per process (started by the recorder plugin when AmberX opens and by {@link WatchService}, so it
 * keeps running while the watch is on): `hello` with the phone's hub session (capability `recorder@1`), then long polls
 * `/axpp/v1/next` and answers each call on `/axpp/v1/answer`. Signed out: it waits and tries again; nothing is sent
 * anywhere but the one hub ({@link HubRules#axpp}).
 *
 * Commands drive the existing recorder, never a new one:
 *  - `recorder.start` sets the session ({@link RecorderControl#sessionOf}) and opens the recorder's own consent flow
 *    ({@link OutputRecordStartActivity}: Android's capture prompt, every start) at once where Android lets it, plus a
 *    "Start recording: <session>" notification that opens it with one tap. Approval happened on axHub (Brett's Approve);
 *    Android's prompt is the phone's own second yes. The mic only joins when the start says `mic: true` (axHub's
 *    approval then reads "Playback + MIC") or, with no `mic`, when "Record my mic too" is on.
 *  - `recorder.stop` stops it the same way the notification's Stop does.
 *  - `recorder.status` answers on/off, since, session, current file, uploaded parts and the queue.
 *  - `browser.open` (capability `open-url@1`, console wake, Nov 3 2026) opens one of Brett's own pages
 *    ({@link OpenUrlRules#allowed}: https on amberxai.com only), e.g. the Dev Console with a queued console command.
 *    It follows open-url-route@1 ({@link OpenUrlRoute}, {@link #openPage}): the console tab Brett has on screen
 *    first (POST /api/console-control/navigate with the phone's console session), then the overlay's full-screen
 *    browser, then a direct browser start (AmberX in front, or exempt because Display over other apps is granted),
 *    then a full-screen notice ({@link OpenPageActivity}), and a tap-to-open notification only as the last resort.
 *    A URL carrying {@code axf-overlay=expand|collapse} is an overlay verb instead ({@link OverlayPageRules#verb}).
 *    The answer's `route`, `opened`, `reason` and `attempts` say what happened.
 */
final class AxppLink {
    private AxppLink() {}

    static final String CAPABILITY = "recorder@1";
    static final int NOTE_PROMPT = 7312;
    static final int NOTE_OPEN = 7313;
    private static final String CHANNEL_OPEN = "amberx-open-console";
    private static final String CHANNEL = "amberx-recorder-remote";
    private static final int POLL_SECONDS = 25;
    private static Thread thread;
    private static Context app;
    private static final Handler main = new Handler(Looper.getMainLooper());

    /** Starts the link once per process (safe to call often). */
    static synchronized void ensure(Context c) {
        app = c.getApplicationContext();
        if (thread != null && thread.isAlive()) return;
        thread = new Thread(AxppLink::loop, "amberx-axpp");
        thread.setDaemon(true);
        thread.start();
    }

    static String deviceId(Context c) {
        SharedPreferences p = c.getSharedPreferences(OutputRecordQueue.PREFS, Context.MODE_PRIVATE);
        String id = p.getString("axpp.deviceId", "");
        if (id != null && id.matches("[A-Za-z0-9_-]{8,64}")) return id;
        StringBuilder b = new StringBuilder("amberx-");
        SecureRandom r = new SecureRandom();
        for (int i = 0; i < 16; i++) b.append(Integer.toHexString(r.nextInt(16)));
        p.edit().putString("axpp.deviceId", b.toString()).apply();
        return b.toString();
    }

    /* ---------------------------------------------------------------- the loop */

    private static void loop() {
        boolean welcomed = false;
        int failures = 0;
        while (true) {
            long wait = 0;
            try {
                String cookie = CookieManager.getInstance().getCookie(HubRules.HUB);
                if (cookie == null || cookie.isEmpty()) { welcomed = false; wait = 60_000; }
                else {
                    String id = deviceId(app);
                    if (!welcomed) {
                        HubRules.Reply r = HubRules.axpp("hello", hello(id).toString(), cookie, 15_000);
                        if (r.status == 200) { welcomed = true; failures = 0; }
                        else wait = r.status == 401 || r.status == 403 ? 60_000 : backoff(++failures);
                    }
                    if (welcomed) {
                        JSONObject ask = new JSONObject().put("deviceId", id).put("wait", POLL_SECONDS);
                        HubRules.Reply r = HubRules.axpp("next", ask.toString(), cookie, (POLL_SECONDS + 15) * 1000);
                        if (r.status == 200) { failures = 0; answer(id, new JSONObject(r.body), cookie); }
                        else if (r.status == 204) failures = 0;
                        else { welcomed = false; wait = r.status == 401 || r.status == 403 ? 60_000 : backoff(++failures); } // 404 = the hub restarted: hello again
                    }
                }
            } catch (Exception e) {
                welcomed = false;
                wait = backoff(++failures);
            }
            if (wait > 0) {
                try { Thread.sleep(wait); } catch (InterruptedException e) { return; }
            }
        }
    }

    private static long backoff(int failures) {
        long[] steps = { 5_000, 15_000, 30_000, 60_000 };
        return steps[Math.min(failures, steps.length) - 1];
    }

    private static JSONObject hello(String id) throws Exception {
        JSONObject state = new JSONObject().put(CAPABILITY, status(app));
        JSONObject p = new JSONObject()
            .put("deviceId", id)
            .put("name", (Build.MANUFACTURER + " " + Build.MODEL).trim())
            .put("app", "amberx-droid")
            .put("capabilities", new org.json.JSONArray().put(CAPABILITY).put(OpenUrlRules.CAPABILITY))
            .put("state", state);
        return envelope("hello", null, p);
    }

    private static JSONObject envelope(String kind, String correlationId, JSONObject payload) throws Exception {
        JSONObject e = new JSONObject().put("protocol", "axpp@1").put("kind", kind).put("id", java.util.UUID.randomUUID().toString()).put("payload", payload);
        if (correlationId != null) e.put("correlationId", correlationId);
        return e;
    }

    /** Runs one call and posts its result (or error) back. */
    private static void answer(String deviceId, JSONObject call, String cookie) throws Exception {
        String callId = call.optString("id");
        JSONObject p = call.optJSONObject("payload");
        String tool = p == null ? "" : p.optString("tool");
        JSONObject args = p == null ? new JSONObject() : p.optJSONObject("arguments");
        JSONObject reply;
        try {
            if (!"call".equals(call.optString("kind")) || !(RecorderControl.known(tool) || OpenUrlRules.known(tool))) throw new IllegalArgumentException("AmberX doesn't know \"" + tool + "\".");
            JSONObject data = run(tool, args == null ? new JSONObject() : args);
            reply = envelope("result", callId, new JSONObject().put("data", data).put("state", new JSONObject().put(CAPABILITY, status(app))));
        } catch (Exception e) {
            reply = envelope("error", callId, new JSONObject().put("code", "unavailable").put("message", String.valueOf(e.getMessage())));
        }
        HubRules.axpp("answer", new JSONObject().put("deviceId", deviceId).put("envelope", reply).toString(), cookie, 15_000);
    }

    /* ---------------------------------------------------------------- the commands */

    static JSONObject run(String tool, JSONObject args) throws Exception {
        Context c = app;
        switch (tool) {
            case OpenUrlRules.OPEN: {
                String url = OpenUrlRules.allowed(args.optString("url", ""));
                String verb = OverlayPageRules.verb(url);
                boolean ready = WatchService.overlayPagesReady(c);
                // overlay.collapse / overlay.expand from the console, MCP, the CLI or voice, through the same hub tool.
                if (OverlayPageRules.COLLAPSE.equals(verb)) {
                    boolean ok = ready && WatchService.approvalOverlayCommand(c, "collapse", null);
                    return new JSONObject().put("url", url).put("verb", verb).put("opened", false).put("collapsed", ok)
                        .put("notified", false).put("overlay", ready).put("where", "overlay");
                }
                if (OverlayPageRules.EXPAND.equals(verb) && ready && WatchService.approvalOverlayCommand(c, "expand", null)) {
                    return new JSONObject().put("url", url).put("verb", verb).put("browser", "overlay").put("opened", true)
                        .put("notified", false).put("overlay", true).put("where", "overlay");
                }
                return openPage(c, url, OpenUrlRules.browserOf(args), args.optString("where", "auto"));
            }
            case OpenUrlRules.PAGES_STATE: {
                OpenUrlRoute.Phone p = phoneNow(c, "auto");
                JSONObject last = last(c);
                return new JSONObject().put("$axf", OpenUrlRoute.SCHEMA).put("overlay", p.overlay).put("fullScreenIntent", p.fullScreenIntent)
                    .put("notifications", p.notifications).put("consoleSignedIn", p.consoleSignedIn).put("overlayReady", p.overlayReady)
                    .put("locked", p.locked).put("order", new org.json.JSONArray(OpenUrlRoute.order(p))).put("last", last == null ? JSONObject.NULL : last)
                    .put("deepLink", "amberx://settings/open-pages");
            }
            case OpenUrlRules.PAGES_TEST:
                return openPage(c, OpenUrlRules.allowed(args.optString("url", OverlayPageRules.HOME)), OpenUrlRules.browserOf(args), args.optString("where", "auto"));
            case RecorderControl.START: {
                RecorderControl.Session s = RecorderControl.sessionOf(args);
                if (OutputRecordService.running) {
                    // already recording: the parts from now on carry this session's name and group
                    OutputRecordQueue.setSession(c, s);
                    OutputRecordQueue.sessionStarted(c, System.currentTimeMillis());
                    return status(c).put("alreadyRunning", true);
                }
                OutputRecordQueue.setSession(c, s);
                askToStart(c, s);
                return status(c).put("awaitingConsent", true);
            }
            case RecorderControl.STOP: {
                boolean was = OutputRecordService.running;
                if (was) c.startService(new Intent(c, OutputRecordService.class).setAction(OutputRecordService.ACTION_STOP).putExtra(OutputRecordService.EXTRA_REASON, "Stopped from axHub."));
                else OutputRecordQueue.clearSession(c);
                cancelPrompt(c);
                return status(c).put("running", false).put("wasRunning", was);
            }
            default:
                return status(c);
        }
    }

    /** What `recorder_status` shows: on/off, since, session, current file, uploaded parts, the queue, the mic. */
    static JSONObject status(Context c) throws Exception {
        JSObject up = OutputRecordUploader.status(c);
        JSObject rec = OutputRecordService.status();
        JSONObject s = OutputRecordQueue.session(c);
        JSONObject o = new JSONObject()
            .put("running", OutputRecordService.running)
            .put("since", rec.has("startedAt") && !rec.isNull("startedAt") ? rec.getString("startedAt") : JSONObject.NULL)
            .put("currentFile", OutputRecordService.running && OutputRecordService.currentName != null ? OutputRecordService.currentName : JSONObject.NULL)
            .put("mic", OutputRecordService.running && OutputRecordService.micOn)
            .put("micBusy", OutputRecordService.running && OutputRecordService.micBusy != null ? OutputRecordService.micBusy : JSONObject.NULL)
            // the hub's approval title reads this when a start leaves `mic` out ("Record my mic too" on the phone)
            .put("micDefault", OutputRecordQueue.settings(c).mic)
            .put("queue", new JSONObject()
                .put("waiting", up.getInteger("waiting", 0))
                .put("waitingBytes", up.optLong("waitingBytes"))
                .put("upload", up.getString("upload", "idle"))
                .put("message", up.getString("message", ""))
                .put("lastUploadAt", up.getString("lastUploadAt", "")));
        if (s != null) {
            o.put("session", s.optString("name")).put("group", s.optString("group")).put("parts", s.optInt("parts")).put("uploaded", s.optInt("uploaded"));
            if (!s.optString("note").isEmpty()) o.put("note", s.optString("note"));
        } else {
            o.put("session", JSONObject.NULL).put("uploaded", 0);
        }
        return o;
    }

    /* ---------------------------------------------------------------- the phone's own yes (Android's capture prompt) */

    /**
     * Opens the recorder's consent flow now (Android allows it while AmberX is on screen or may draw over other apps)
     * and posts a "Start recording: <session>" notification that opens it with one tap, in case Android held it back.
     */
    private static void askToStart(Context c, RecorderControl.Session s) {
        main.post(() -> {
            startInForeground(c, OutputRecordStartActivity.intent(c)); // refused or dropped: the notification does it
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Recording asked from axHub", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("A session recording approved on axHub, waiting for Android's capture prompt");
                nm.createNotificationChannel(ch);
            }
            PendingIntent open = PendingIntent.getActivity(c, 3, OutputRecordStartActivity.intent(c), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Start recording: " + s.name + (OutputRecordQueue.micWanted(c) ? " (Playback + MIC)" : ""))
                .setContentText(OutputRecordQueue.micWanted(c)
                    ? "Approved on axHub. Tap to allow Android's capture prompt (phone audio + your mic)."
                    : "Approved on axHub. Tap to allow Android's capture prompt (phone audio only, mic off).")
                .setContentIntent(open)
                .setAutoCancel(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(10 * 60_000L);
            nm.notify(NOTE_PROMPT, b.build());
        });
    }

    /* ---------------------------------------------------------------- console wake: open one of Brett's pages */

    static final String CHANNEL_PAGE = "open-page";
    static final int NOTE_PAGE = 0x0A11;

    /** True when Android lets AmberX use full-screen notices (Android 14+ asks; older phones grant it with the manifest). */
    static boolean canFullScreen(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !nm.areNotificationsEnabled()) return false;
        return Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent();
    }

    /**
     * open-url-route@1 `full-screen-intent`: a high-priority notice whose full-screen intent is {@link OpenPageActivity},
     * the trampoline that fires the browser on the page and finishes. Its tap opens the page too, so when Android only
     * shows it as a banner (phone unlocked and in use) it is already the last-resort notification. → true when posted.
     */
    static boolean postFullScreen(Context c, String url, String browser) {
        if (!canFullScreen(c)) return false;
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_PAGE) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_PAGE, "Pages Amber opens", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Opens a page Amber asked for, over the lock screen when the phone is locked");
                nm.createNotificationChannel(ch);
            }
            Intent tramp = OpenPageActivity.intent(c, url, browser, NOTE_PAGE);
            PendingIntent full = PendingIntent.getActivity(c, 5, tramp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(c, CHANNEL_PAGE) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("Opening a page for you")
                .setContentText(url)
                .setContentIntent(full)
                .setFullScreenIntent(full, true)
                .setCategory(Notification.CATEGORY_REMINDER)
                .setPriority(Notification.PRIORITY_MAX)
                .setAutoCancel(true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(10 * 60_000L);
            nm.notify(NOTE_PAGE, b.build());
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** What the phone knows right now for open-url-route@1 (the console session, the permissions, the screen). */
    static OpenUrlRoute.Phone phoneNow(Context c, String where) {
        OpenUrlRoute.Phone p = new OpenUrlRoute.Phone();
        p.where = where == null || where.isEmpty() ? "auto" : where;
        String cookie;
        try { cookie = CookieManager.getInstance().getCookie(HubRules.CONSOLE); } catch (RuntimeException e) { cookie = null; }
        p.consoleSignedIn = cookie != null && !cookie.isEmpty();
        p.inFront = WatchService.inApp;
        p.overlay = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || android.provider.Settings.canDrawOverlays(c);
        p.overlayReady = WatchService.overlayPagesReady(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        p.notifications = nm != null && (Build.VERSION.SDK_INT < Build.VERSION_CODES.N || nm.areNotificationsEnabled());
        p.fullScreenIntent = canFullScreen(c);
        android.app.KeyguardManager km = (android.app.KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
        p.locked = km != null && km.isKeyguardLocked();
        return p;
    }

    /**
     * open-url-route@1 on the phone: every route in order (OpenUrlRoute.order), each attempt recorded, the first that
     * lands wins. console-tab → overlay (the toolbar's full-screen browser) → direct (AmberX in front, or exempt from
     * Android's background-start rule because Display over other apps is granted) → full-screen intent → notification.
     * The answer is today's AXPP fields (url, browser, opened, notified, overlay, where) plus the open-url-result@1
     * (route, reason, tried, attempts).
     */
    static JSONObject openPage(Context c, String url, String browser, String where) throws Exception {
        OpenUrlRoute.Phone p = phoneNow(c, where);
        java.util.List<OpenUrlRoute.Attempt> attempts = new java.util.ArrayList<>();
        String won = null;
        for (String route : OpenUrlRoute.order(p)) {
            OpenUrlRoute.Attempt a = attempt(c, route, url, browser, where);
            if (a == null) continue;
            attempts.add(a);
            if (a.ok) { won = route; break; }
        }
        JSONObject result = OpenUrlRoute.settle(url, p, attempts);
        if (won != null && !OpenUrlRoute.FULL_SCREEN.equals(won)) cancelNote(c, NOTE_PAGE);
        String placed = won == null ? "browser" : OpenUrlRoute.CONSOLE_TAB.equals(won) ? "console" : OpenUrlRoute.OVERLAY.equals(won) ? "overlay" : "browser";
        JSONObject out = new JSONObject().put("url", url)
            .put("browser", OpenUrlRoute.CONSOLE_TAB.equals(won) ? "console" : OpenUrlRoute.OVERLAY.equals(won) ? "overlay" : browserIntent(c, url, browser).getPackage() == null ? "default" : "chrome")
            .put("verb", OverlayPageRules.OPEN)
            .put("opened", result.optBoolean("opened")).put("notified", result.optBoolean("notified"))
            .put("overlay", p.overlay).put("where", placed)
            .put("route", result.optString("route")).put("reason", result.optString("reason"))
            .put("tried", result.optJSONArray("tried")).put("attempts", result.optJSONArray("attempts")).put("result", result);
        remember(c, new JSONObject(out.toString()));
        return out;
    }

    /** One route tried. → its attempt, or null when it turned out not to apply after all (e.g. signed out of the console). */
    static OpenUrlRoute.Attempt attempt(Context c, String route, String url, String browser, String where) {
        switch (route) {
            case OpenUrlRoute.CONSOLE_TAB:
                return tryConsoleTab(url, where);
            case OpenUrlRoute.OVERLAY:
                return new OpenUrlRoute.Attempt(route, onMain(() -> WatchService.openOverlayPage(c, url)), "overlay-not-ready");
            case OpenUrlRoute.DIRECT: {
                // Display over other apps exempts AmberX from Android's background-start rule: start the page from the
                // service (in front, the start is plain). It goes through the trampoline, so a start Android dropped
                // without a word is seen as one and the next route runs.
                if (!browserResolves(c, url, browser)) return new OpenUrlRoute.Attempt(route, false, "attempt-failed");
                long before = OpenPageActivity.landedAt;
                if (!onMain(() -> startDirect(c, url, browser))) return new OpenUrlRoute.Attempt(route, false, "background-start-blocked");
                return new OpenUrlRoute.Attempt(route, landed(before, url, LANDED_WAIT_MS), "background-start-blocked");
            }
            case OpenUrlRoute.FULL_SCREEN: {
                if (!browserResolves(c, url, browser)) return new OpenUrlRoute.Attempt(route, false, "attempt-failed");
                long before = OpenPageActivity.landedAt;
                if (!onMain(() -> postFullScreen(c, url, browser))) return new OpenUrlRoute.Attempt(route, false, "no-full-screen-intent");
                // unlocked and in use, Android shows a full-screen notice as a banner only: the trampoline never runs
                boolean ok = landed(before, url, LANDED_WAIT_MS);
                if (!ok) cancelNote(c, NOTE_PAGE);
                boolean locked = phoneNow(c, where).locked;
                return new OpenUrlRoute.Attempt(route, ok, locked ? "attempt-failed" : "phone-unlocked");
            }
            case OpenUrlRoute.NOTIFICATION:
                return new OpenUrlRoute.Attempt(route, notifyToOpen(c, url, browser), "notifications-off");
            default:
                return null;
        }
    }

    /** How long a start gets to show it landed (the trampoline ran) before the next route is tried. */
    static final long LANDED_WAIT_MS = 1_800;

    /**
     * The page started straight from AmberX (allowed in front, or with Display over other apps), through
     * {@link OpenPageActivity} so the start can be seen to land. → false when Android refused it outright.
     */
    static boolean startDirect(Context c, String url, String browser) {
        try { c.startActivity(OpenPageActivity.intent(c, url, browser, 0)); return true; } catch (RuntimeException e) { return false; }
    }

    /** True when some browser on the phone takes the page (Chrome, else the default). */
    static boolean browserResolves(Context c, String url, String browser) {
        try { return browserIntent(c, url, browser).resolveActivity(c.getPackageManager()) != null; } catch (RuntimeException e) { return false; }
    }

    /** Waits up to [ms] for the trampoline to say it started the browser on [url] after [before]. */
    static boolean landed(long before, String url, long ms) {
        long until = System.currentTimeMillis() + ms;
        while (System.currentTimeMillis() < until) {
            if (OpenPageActivity.landedAt > before && url.equals(OpenPageActivity.landedUrl)) return true;
            try { Thread.sleep(100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return false; }
        }
        return OpenPageActivity.landedAt > before && url.equals(OpenPageActivity.landedUrl);
    }

    static void cancelNote(Context c, int id) {
        try { ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id); } catch (RuntimeException ignored) { /* nothing to take away */ }
    }

    static final String PREFS_OPEN = "amberx-open-pages";

    /** The last open_url result (open-url-result@1 + the AXPP fields), kept for the settings screen and the bridge. */
    static void remember(Context c, JSONObject answer) {
        try {
            c.getSharedPreferences(PREFS_OPEN, Context.MODE_PRIVATE).edit()
                .putString("last", answer.put("at", System.currentTimeMillis()).toString()).apply();
        } catch (Exception ignored) { /* the answer to axHub still goes out */ }
    }

    /** The last open_url result, or null when none was kept. */
    static JSONObject last(Context c) {
        try {
            String s = c.getSharedPreferences(PREFS_OPEN, Context.MODE_PRIVATE).getString("last", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) { return null; }
    }

    /** Runs on the main thread and waits (up to 5 s) for its answer. */
    static boolean onMain(java.util.function.BooleanSupplier f) {
        if (Looper.myLooper() == Looper.getMainLooper()) return f.getAsBoolean();
        boolean[] out = { false };
        java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
        main.post(() -> { try { out[0] = f.getAsBoolean(); } finally { done.countDown(); } });
        try { done.await(5, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        return out[0];
    }

    static final int CONSOLE_TAB_TIMEOUT_MS = 6_000;  // the console waits 2.5 s for its tab; the rest is the network

    /**
     * open-url-route@1 `console-tab`: ask the Dev Console (with the phone's console session, the same one the alerts
     * read uses) to open the page in the console tab Brett focused last. → the attempt, or null when skipped (signed
     * out of the console, or the caller asked for the overlay or the browser).
     */
    static OpenUrlRoute.Attempt tryConsoleTab(String url, String where) {
        if ("overlay".equals(where) || "browser".equals(where)) return null;
        String cookie;
        try { cookie = android.webkit.CookieManager.getInstance().getCookie(HubRules.CONSOLE); } catch (RuntimeException e) { cookie = null; }
        if (cookie == null || cookie.isEmpty()) return null;
        try {
            HubRules.Reply r = HubRules.postConsoleNavigate(OpenUrlRoute.navigateBody(url), cookie, CONSOLE_TAB_TIMEOUT_MS);
            return OpenUrlRoute.consoleAnswer(r.status, r.body);
        } catch (Exception e) {
            return new OpenUrlRoute.Attempt(OpenUrlRoute.CONSOLE_TAB, false, "console-stale");
        }
    }

    /** The browser intent for a URL: Chrome when asked for and installed, else whatever handles https. */
    static Intent browserIntent(Context c, String url, String browser) {
        Intent i = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if ("chrome".equals(browser)) {
            try {
                c.getPackageManager().getPackageInfo(OpenUrlRules.CHROME, 0);
                i.setPackage(OpenUrlRules.CHROME);
            } catch (Exception ignored) { /* no Chrome: the default browser */ }
        }
        return i;
    }

    /**
     * Starts an activity from the background the way Android allows it: with AmberX on screen, or while the overlay
     * toolbar is visible (since Android 15 holding "Display over other apps" isn't enough on its own: the app needs a
     * visible overlay window at that moment, and the always-on toolbar is that window). Otherwise Android drops the
     * start silently, so this doesn't try. → true when the start has a window behind it; only the page opening proves
     * it landed.
     */
    private static boolean startInForeground(Context c, Intent i) {
        if (!WatchService.inApp && !WatchService.overlayShown()) return false;
        try { c.startActivity(i); return true; } catch (RuntimeException e) { return false; }
    }

    /**
     * open-url-route@1 `notification`, the last resort: a high-priority "Tap to open" notification. Never "opened"
     * (only Brett's tap opens the page). → true when it went out (notifications on).
     */
    static boolean notifyToOpen(Context c, String url, String browser) {
        Intent open = browserIntent(c, url, browser);
        return onMain(() -> {
            try {
                NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !nm.areNotificationsEnabled()) return false;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL_OPEN) == null) {
                    NotificationChannel ch = new NotificationChannel(CHANNEL_OPEN, "Console opened by Amber", NotificationManager.IMPORTANCE_HIGH);
                    ch.setDescription("A page Amber asked for that Android wouldn't open by itself: tap to open it");
                    nm.createNotificationChannel(ch);
                }
                PendingIntent pi = PendingIntent.getActivity(c, 4, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
                Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? new Notification.Builder(c, CHANNEL_OPEN) : new Notification.Builder(c);
                b.setSmallIcon(android.R.drawable.ic_menu_view)
                    .setContentTitle("Tap to open the page")
                    .setContentText(url)
                    .setContentIntent(pi)
                    .setCategory(Notification.CATEGORY_REMINDER)
                    .setPriority(Notification.PRIORITY_HIGH)
                    .setAutoCancel(true);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) b.setTimeoutAfter(10 * 60_000L);
                nm.notify(NOTE_OPEN, b.build());
                return true;
            } catch (RuntimeException e) {
                return false;
            }
        });
    }

    static void cancelPrompt(Context c) {
        ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).cancel(NOTE_PROMPT);
    }

    /** Android's prompt was refused or failed: the ask is over (the session was cleared by the caller). */
    static void consentRefused(Context c, String message) {
        cancelPrompt(c);
    }
}
