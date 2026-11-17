package ai.amberx.consoleapp;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The console app as axHub's {@code amberx} device service (moved from AmberX's {@code AxppLink}; rules in
 * {@link DeviceRules}). One background thread per process: {@code hello} with the phone's hub session (the WebView's
 * axhub.amberxai.com cookie, so signing in to the hub inside the app is all it needs), then long polls
 * {@code /axpp/v1/next} and answers each call on {@code /axpp/v1/answer}. Nothing goes anywhere but the one hub.
 *
 * {@code browser.open}: a URL with {@code axf-overlay=expand|collapse} is an overlay verb; any other page of Brett's
 * own sites opens in the console WebView and the floating toolbar expands to show it (with the overlay off or not
 * allowed, the app comes to the front). {@code where: "browser"} sends it to the phone's browser instead.
 */
final class DeviceLink {
    private DeviceLink() {}

    static final String HUB = "https://axhub.amberxai.com";
    private static final String PATH = "/axpp/v1/";
    private static final int MAX_BYTES = 256 * 1024;
    private static Thread thread;
    private static Context app;
    private static final Handler ui = new Handler(Looper.getMainLooper());
    /** For panel:phone-app's state: signed-out | connecting | linked | error. */
    static volatile String status = "off";
    static volatile String lastCall = "";

    /** Starts the link once per process (safe to call often). */
    static synchronized void ensure(Context c) {
        app = c.getApplicationContext();
        if (thread != null && thread.isAlive()) return;
        thread = new Thread(DeviceLink::loop, "axf-console-axpp");
        thread.setDaemon(true);
        thread.start();
    }

    static String stateJson() {
        return "{\"status\":" + JSONObject.quote(status) + ",\"capabilities\":[\"" + String.join("\",\"", DeviceRules.CAPABILITIES)
            + "\"],\"lastCall\":" + JSONObject.quote(lastCall) + "}";
    }

    static String deviceId(Context c) {
        SharedPreferences p = c.getSharedPreferences("device", Context.MODE_PRIVATE);
        String id = p.getString("axpp.deviceId", "");
        if (id != null && id.matches("[A-Za-z0-9_-]{8,64}")) return id;
        StringBuilder b = new StringBuilder("console-");
        SecureRandom r = new SecureRandom();
        for (int i = 0; i < 16; i++) b.append(Integer.toHexString(r.nextInt(16)));
        p.edit().putString("axpp.deviceId", b.toString()).apply();
        return b.toString();
    }

    private static void loop() {
        boolean welcomed = false;
        int failures = 0;
        while (true) {
            long wait = 0;
            try {
                String cookie = CookieManager.getInstance().getCookie(HUB);
                if (cookie == null || cookie.isEmpty()) { welcomed = false; status = "signed-out"; wait = DeviceRules.SIGNED_OUT_MS; }
                else {
                    String id = deviceId(app);
                    if (!welcomed) {
                        status = "connecting";
                        int code = post("hello", hello(id).toString(), cookie, 15_000).status;
                        if (code == 200) { welcomed = true; failures = 0; status = "linked"; }
                        else { status = code == 401 || code == 403 ? "signed-out" : "error"; wait = DeviceRules.afterStatus(code, ++failures); }
                    }
                    if (welcomed) {
                        JSONObject ask = new JSONObject().put("deviceId", id).put("wait", DeviceRules.POLL_SECONDS);
                        Reply r = post("next", ask.toString(), cookie, (DeviceRules.POLL_SECONDS + 15) * 1000);
                        if (r.status == 200) { failures = 0; answer(id, new JSONObject(r.body), cookie); }
                        else if (r.status == 204) failures = 0;
                        else { welcomed = false; wait = DeviceRules.afterStatus(r.status, ++failures); } // 404: the hub restarted, hello again
                    }
                }
            } catch (Exception e) {
                welcomed = false;
                status = "error";
                wait = DeviceRules.backoff(++failures);
            }
            if (wait > 0) {
                try { Thread.sleep(wait); } catch (InterruptedException e) { return; }
            }
        }
    }

    private static JSONObject hello(String id) throws Exception {
        JSONArray caps = new JSONArray();
        for (String c : DeviceRules.CAPABILITIES) caps.put(c);
        JSONObject p = new JSONObject().put("deviceId", id).put("name", (Build.MANUFACTURER + " " + Build.MODEL).trim())
            .put("app", DeviceRules.APP).put("capabilities", caps).put("state", new JSONObject());
        return envelope("hello", null, p);
    }

    private static JSONObject envelope(String kind, String correlationId, JSONObject payload) throws Exception {
        JSONObject e = new JSONObject().put("protocol", DeviceRules.PROTOCOL).put("kind", kind).put("id", UUID.randomUUID().toString()).put("payload", payload);
        if (correlationId != null) e.put("correlationId", correlationId);
        return e;
    }

    private static void answer(String deviceId, JSONObject call, String cookie) throws Exception {
        String callId = call.optString("id");
        JSONObject p = call.optJSONObject("payload");
        String tool = p == null ? "" : p.optString("tool");
        JSONObject args = p == null ? null : p.optJSONObject("arguments");
        lastCall = tool;
        JSONObject reply;
        try {
            if (!"call".equals(call.optString("kind")) || !DeviceRules.known(tool)) throw new IllegalArgumentException("The console app doesn't know \"" + tool + "\".");
            reply = envelope("result", callId, new JSONObject().put("data", open(args == null ? new JSONObject() : args)).put("state", new JSONObject()));
        } catch (Exception e) {
            reply = envelope("error", callId, new JSONObject().put("code", "unavailable").put("message", String.valueOf(e.getMessage())));
        }
        post("answer", new JSONObject().put("deviceId", deviceId).put("envelope", reply).toString(), cookie, 15_000);
    }

    /** {@code browser.open}: an overlay verb, a page in the app (its overlay when up), or the phone's browser. */
    static JSONObject open(JSONObject args) throws Exception {
        String url = ShellRules.allowed(args.optString("url", ""));
        String verb = DeviceRules.verb(url);
        JSONObject out = new JSONObject().put("url", url).put("verb", verb).put("notified", false);
        if (DeviceRules.COLLAPSE.equals(verb)) {
            boolean up = onUi(() -> { boolean r = OverlayService.running != null; OverlayService.verb(app, "collapse"); return r; });
            return out.put("opened", false).put("collapsed", up).put("overlay", up).put("where", "overlay");
        }
        if ("browser".equals(DeviceRules.where(args.optString("where", "")))) {
            onUi(() -> { WebHost.openOutside(app, Uri.parse(url)); return true; });
            return out.put("opened", true).put("browser", "default").put("where", "browser");
        }
        // expand, or a page: the page loads in the one console WebView and the toolbar expands over whatever is on screen
        boolean overlay = onUi(() -> {
            if (DeviceRules.PAGE.equals(verb)) WebHost.open(app, url);
            OverlayService.verb(app, "expand"); // no overlay: this brings the app itself to the front
            return OverlayService.running != null;
        });
        return out.put("opened", true).put("browser", overlay ? "overlay" : "app").put("overlay", overlay).put("where", overlay ? "overlay" : "app");
    }

    private interface UiCall { boolean run(); }

    /** Runs on the main thread and waits for its answer (at most 5 s; false when it didn't finish). */
    private static boolean onUi(UiCall f) throws InterruptedException {
        boolean[] r = { false };
        CountDownLatch done = new CountDownLatch(1);
        ui.post(() -> { try { r[0] = f.run(); } finally { done.countDown(); } });
        return done.await(5, TimeUnit.SECONDS) && r[0];
    }

    private static final class Reply {
        final int status; final String body;
        Reply(int status, String body) { this.status = status; this.body = body; }
    }

    /** POST to {@code /axpp/v1/hello|next|answer} on the one hub (the hub as Origin, X-AXPP, no redirects). */
    private static Reply post(String route, String body, String cookie, int readTimeoutMs) throws IOException {
        if (!route.matches("hello|next|answer")) throw new IOException("not an AXPP route");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_BYTES) throw new IOException("message too large");
        HttpURLConnection c = (HttpURLConnection) new URL(HUB + PATH + route).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10_000); c.setReadTimeout(readTimeoutMs); c.setUseCaches(false);
            c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Origin", HUB);
            c.setRequestProperty("X-AXPP", DeviceRules.PROTOCOL);
            c.setRequestProperty("Cookie", cookie);
            c.getOutputStream().write(bytes);
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : code == 204 ? null : c.getInputStream();
            return new Reply(code, in == null ? "" : read(in));
        } finally {
            c.disconnect();
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) {
                if (out.size() + n > MAX_BYTES) throw new IOException("reply too large");
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        }
    }
}
