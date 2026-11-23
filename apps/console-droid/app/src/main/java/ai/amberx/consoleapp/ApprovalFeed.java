package ai.amberx.consoleapp;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.webkit.CookieManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Reads axHub's live approvals list for the floating toolbar (rules in {@link ApprovalFeedRules}). One background
 * thread while the toolbar runs: a GET of the feed with the phone's hub session (the WebView's axhub.amberxai.com
 * cookie, like {@link DeviceLink}), then the list goes to {@link OverlayService#feed} on the main thread.
 *
 * It does not depend on the console page: the page stops reading the feed once it is off screen, which is exactly when
 * the toolbar has to pop an approval. {@link #syncNow} reads at once (the overlay changed state, the app or the screen
 * came back, the page reported a change, a countdown ended); otherwise it reads every few seconds
 * ({@link ApprovalFeedRules#pollMs}). Read-only: deciding stays Brett's tap in the console.
 */
final class ApprovalFeed {
    private ApprovalFeed() {}

    private static final Handler ui = new Handler(Looper.getMainLooper());
    private static final Object wake = new Object();
    private static boolean asked;
    /** The running loop's token: a loop ends when it is no longer the current one. */
    private static volatile Object current;
    /** The last reading's status ({@link ApprovalFeedRules#IDLE} before the first), for the overlay's state. */
    static volatile String status = ApprovalFeedRules.IDLE;

    static synchronized void start(Context c) {
        if (current != null) return;
        Context app = c.getApplicationContext();
        Object token = new Object();
        current = token;
        Thread t = new Thread(() -> loop(app, token), "axf-console-approvals");
        t.setDaemon(true);
        t.start();
    }

    static synchronized void stop() {
        current = null;
        status = ApprovalFeedRules.IDLE;
        syncNow();
    }

    /** True once the hub has answered with its list: the toolbar then shows that list and nothing else. */
    static boolean ok() { return ApprovalFeedRules.OK.equals(status); }

    /** Read the feed now instead of at the next poll. */
    static void syncNow() {
        synchronized (wake) { asked = true; wake.notifyAll(); }
    }

    private static void loop(Context app, Object token) {
        PowerManager power = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
        while (current == token) {
            ApprovalFeedRules.Result r = read();
            if (current != token) return;
            status = r.status;
            ui.post(() -> { if (current == token) OverlayService.feed(r); });
            long wait = ApprovalFeedRules.pollMs(r.items.size(), power == null || power.isInteractive());
            synchronized (wake) {
                try { if (!asked) wake.wait(wait); } catch (InterruptedException e) { return; }
                asked = false;
            }
        }
    }

    private static ApprovalFeedRules.Result read() {
        try {
            String cookie = CookieManager.getInstance().getCookie(DeviceLink.HUB);
            if (cookie == null || cookie.isEmpty()) return ApprovalFeedRules.empty(ApprovalFeedRules.SIGNED_OUT);
            HttpURLConnection c = (HttpURLConnection) new URL(DeviceLink.HUB + ApprovalFeedRules.FEED_PATH).openConnection();
            try {
                c.setInstanceFollowRedirects(false);
                c.setConnectTimeout(10_000); c.setReadTimeout(15_000); c.setUseCaches(false);
                c.setRequestProperty("Accept", "application/json");
                c.setRequestProperty("Cookie", cookie);
                int code = c.getResponseCode();
                String body = code == 200 ? read(c.getInputStream()) : "";
                return ApprovalFeedRules.parse(DeviceLink.HUB, code, body, System.currentTimeMillis());
            } finally {
                c.disconnect();
            }
        } catch (Exception e) {
            return ApprovalFeedRules.empty(ApprovalFeedRules.UNREACHABLE);
        }
    }

    private static String read(InputStream in) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = s.read(buf)) > 0) {
                if (out.size() + n > ApprovalFeedRules.MAX_BYTES) throw new IOException("reply too large");
                out.write(buf, 0, n);
            }
            return out.toString("UTF-8");
        }
    }
}
