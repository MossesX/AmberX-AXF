package ai.amberx.axf.phoneconnect.recorder;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The recorder's reads and writes on axHub's data server with the phone's hub session (moved from AmberX's HubRules):
 * only https://axhub.amberxai.com/data/…, no redirects, replies capped at 256 KB, documents at most 64 KB, the hub as
 * Origin on a PUT.
 */
final class HubData {
    private HubData() {}

    static final String HUB = "https://axhub.amberxai.com";
    static final int REPLY_MAX_BYTES = 256 * 1024;
    static final int PUT_MAX_BYTES = 64 * 1024;

    static final class Reply {
        final int status; final String body; final String etag;
        Reply(int status, String body, String etag) { this.status = status; this.body = body; this.etag = etag; }
    }

    static boolean isDataPath(String url) { return url != null && url.startsWith(HUB + "/data/") && !url.contains(".."); }

    static Reply get(String url, String cookie) throws IOException {
        if (!isDataPath(url)) throw new IOException("not the hub's data server");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10_000); c.setReadTimeout(10_000); c.setUseCaches(false);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Accept-Encoding", "identity");
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Reply(code, in == null ? "" : readLimited(in, REPLY_MAX_BYTES), c.getHeaderField("ETag"));
        } finally { c.disconnect(); }
    }

    static Reply put(String url, String body, String ifMatch, String cookie) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        if (!isDataPath(url)) throw new IOException("not the hub's data server");
        if (bytes.length > PUT_MAX_BYTES) throw new IOException("document too large");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(10_000); c.setReadTimeout(10_000); c.setUseCaches(false);
            c.setRequestMethod("PUT"); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("Origin", HUB);
            if (ifMatch != null && !ifMatch.isEmpty()) c.setRequestProperty("If-Match", ifMatch);
            if (cookie != null) c.setRequestProperty("Cookie", cookie);
            c.getOutputStream().write(bytes);
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            return new Reply(code, in == null ? "" : readLimited(in, REPLY_MAX_BYTES), c.getHeaderField("ETag"));
        } finally { c.disconnect(); }
    }

    static String readLimited(InputStream in, int max) throws IOException {
        try (InputStream s = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192]; int total = 0; int n;
            while ((n = s.read(buf)) >= 0) { total += n; if (total > max) break; out.write(buf, 0, n); }
            return out.toString("UTF-8");
        }
    }
}
