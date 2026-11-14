package ai.amberx.consoleapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The axHub device link (console app part 3, s3): AmberX's {@code AxppLink}, moved to the console app. One background
 * thread per process: {@code hello} with the hub session from the WebView's cookies, long poll {@code /axpp/v1/next},
 * run each call through {@link DeviceBridge#run} and post the reply to {@code /axpp/v1/answer}. Signed out: it waits a
 * minute and tries again. It talks to {@link HubLinkRules#HUB} only. Calls arrive while the console app is open (the
 * bridge lives with its WebView); with no bridge the hub gets {@code unavailable}.
 *
 * Wiring: {@code HubLink.ensure(this)} in {@code ConsoleActivity.onCreate}, after {@code DeviceBridge.attach}.
 */
final class HubLink {
    private HubLink() {}

    static final String PREFS = "console-droid";
    private static final String KEY_DEVICE = "axpp.deviceId";
    private static Thread thread;
    private static Context app;
    /** Whether the hub has welcomed this device (for {@code bridge.info} and the {@code link} event). */
    static volatile boolean up;

    /** Starts the link once per process (safe to call often). */
    static synchronized void ensure(Context c) {
        app = c.getApplicationContext();
        if (thread != null && thread.isAlive()) return;
        thread = new Thread(HubLink::loop, "console-droid-axpp");
        thread.setDaemon(true);
        thread.start();
    }

    static String deviceId(Context c) {
        SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = p.getString(KEY_DEVICE, "");
        if (HubLinkRules.validDeviceId(id)) return id;
        String fresh = HubLinkRules.newDeviceId(new SecureRandom());
        p.edit().putString(KEY_DEVICE, fresh).apply();
        return fresh;
    }

    private static void setUp(boolean now) {
        if (up == now) return;
        up = now;
        DeviceBridge b = DeviceBridge.current;
        if (b == null) return;
        try { b.emit(BridgeContract.EV_LINK, new JSONObject().put("up", now)); } catch (Exception ignored) { /* the page is gone */ }
    }

    private static void loop() {
        boolean welcomed = false;
        int failures = 0;
        while (true) {
            long wait = 0;
            try {
                String cookie = CookieManager.getInstance().getCookie(HubLinkRules.HUB);
                if (cookie == null || cookie.isEmpty()) { welcomed = false; wait = 60_000; }
                else {
                    String id = deviceId(app);
                    if (!welcomed) {
                        int s = post("hello", hello(id).toString(), cookie, 15_000).status;
                        if (s == 200) { welcomed = true; failures = 0; }
                        else wait = HubLinkRules.waitAfter(s, ++failures);
                    }
                    if (welcomed) {
                        Reply r = post("next", HubLinkRules.next(id).toString(), cookie, (HubLinkRules.POLL_SECONDS + 15) * 1000);
                        if (r.status == 200) { failures = 0; answer(id, new JSONObject(r.body), cookie); }
                        else if (r.status == 204) failures = 0;
                        else { welcomed = false; wait = HubLinkRules.waitAfter(r.status, ++failures); } // 404: the hub restarted, hello again
                    }
                }
            } catch (Exception e) {
                welcomed = false;
                wait = HubLinkRules.backoff(++failures);
            }
            setUp(welcomed);
            if (wait > 0) {
                try { Thread.sleep(wait); } catch (InterruptedException e) { return; }
            }
        }
    }

    private static JSONObject hello(String id) throws Exception {
        DeviceBridge b = DeviceBridge.current;
        JSONArray caps = b == null ? new JSONArray() : b.capabilities().optJSONArray("capabilities");
        return HubLinkRules.hello(id, (Build.MANUFACTURER + " " + Build.MODEL).trim(), BuildConfigInfo.version(app), caps, state());
    }

    /** What the hub keeps about the device between calls: the bridge's own status answers. */
    private static JSONObject state() {
        JSONObject s = new JSONObject();
        DeviceBridge b = DeviceBridge.current;
        if (b == null) return s;
        try {
            s.put("permissions", DeviceBridge.permissions(app));
            if (b.has(BridgeContract.NOTIFY_STATUS)) s.put(BridgeContract.CAP_NOTIFY, runNow(b, BridgeContract.NOTIFY_STATUS, new JSONObject()).optJSONObject("data"));
            if (b.has(BridgeContract.REC_STATUS)) s.put(BridgeContract.CAP_RECORDER, runNow(b, BridgeContract.REC_STATUS, new JSONObject()).optJSONObject("data"));
        } catch (Exception ignored) { /* state is best effort */ }
        return s;
    }

    /** Runs one tool on the bridge (main thread) and waits for its answer here, on the link's thread. */
    private static JSONObject runNow(DeviceBridge b, String name, JSONObject args) throws InterruptedException {
        AtomicReference<JSONObject> out = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        b.run(name, args, m -> { out.set(m); done.countDown(); });
        if (!done.await(20, TimeUnit.SECONDS)) return BridgeContract.error(null, name, BridgeContract.E_UNAVAILABLE, "The console app didn't answer in time.");
        return out.get();
    }

    private static void answer(String deviceId, JSONObject envelope, String cookie) throws Exception {
        JSONObject reply;
        try {
            HubLinkRules.HubCall call = HubLinkRules.callOf(envelope);
            DeviceBridge b = DeviceBridge.current;
            JSONObject a = b == null
                ? BridgeContract.error(null, call.name, BridgeContract.E_UNAVAILABLE, "The console app isn't open on the phone.")
                : runNow(b, call.name, call.args);
            reply = HubLinkRules.reply(call.id, a, state());
        } catch (IllegalArgumentException e) {
            reply = HubLinkRules.reply(envelope.optString("id", null), BridgeContract.error(null, null, BridgeContract.E_BAD_ARGS, e.getMessage()), null);
        }
        post("answer", HubLinkRules.answerBody(deviceId, reply).toString(), cookie, 15_000);
    }

    /* ---------------------------------------------------------------- HTTP, the one hub only */

    static final class Reply {
        final int status;
        final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
    }

    private static Reply post(String route, String body, String cookie, int readTimeoutMs) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(HubLinkRules.url(route)).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(15_000);
            c.setReadTimeout(readTimeoutMs);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Origin", HubLinkRules.HUB);
            c.setRequestProperty("Cookie", cookie);
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = "";
            if (in != null) {
                try (InputStream i = in) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] chunk = new byte[8192];
                    for (int n; (n = i.read(chunk)) > 0; ) buf.write(chunk, 0, n);
                    text = buf.toString("UTF-8");
                }
            }
            return new Reply(status, text);
        } finally {
            c.disconnect();
        }
    }
}
