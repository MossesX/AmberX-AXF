package ai.amberx.consoleapp;

import java.security.SecureRandom;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The axHub device link's rules (console app part 3, s3): the console app is the {@code amberx} device service AmberX
 * was (axHub decision #108), speaking AXPP ({@code axpp@1}) to the one hub, so axHub's MCP tools
 * ({@code amberx.open_url}, {@code amberx.recorder_start|stop|status}, {@code amberx.console_wake}, {@code amberx.notify})
 * keep working with no hub change. Same envelopes, routes and long poll as AmberX's {@code AxppLink}; the calls go to
 * {@link DeviceBridge#run}, so a hub call and a page call run the same code.
 *
 * No Android imports: JUnit {@code HubLinkRulesTest}. {@code HubLink} is the thread that uses them.
 */
final class HubLinkRules {
    private HubLinkRules() {}

    /** The one hub the link talks to (AmberX's {@code HubRules.HUB}); nothing is sent anywhere else. */
    static final String HUB = "https://axhub.amberxai.com";
    static final String AXPP_PATH = "/axpp/v1/";
    static final String PROTOCOL = "axpp@1";
    static final int POLL_SECONDS = 25;
    static final List<String> ROUTES = java.util.Arrays.asList("hello", "next", "answer");
    private static final Pattern DEVICE_ID = Pattern.compile("^[A-Za-z0-9_-]{8,64}$");

    /** The hub URL for a route; anything but hello / next / answer is refused. */
    static String url(String route) {
        if (!ROUTES.contains(route)) throw new IllegalArgumentException("not an AXPP route: " + route);
        return HUB + AXPP_PATH + route;
    }

    static boolean validDeviceId(String id) { return id != null && DEVICE_ID.matcher(id).matches(); }

    /** A new device id ({@code console-droid-} + 16 hex), kept in the app's preferences by {@code HubLink}. */
    static String newDeviceId(SecureRandom r) {
        StringBuilder b = new StringBuilder("console-droid-");
        for (int i = 0; i < 16; i++) b.append(Integer.toHexString(r.nextInt(16)));
        return b.toString();
    }

    /** Wait before the next try: 5 s, 15 s, 30 s, then every minute (AmberX's steps). Signed out or refused: 1 min. */
    static long backoff(int failures) {
        long[] steps = { 5_000, 15_000, 30_000, 60_000 };
        return steps[Math.max(0, Math.min(failures, steps.length) - 1)];
    }

    static long waitAfter(int status, int failures) {
        return status == 401 || status == 403 ? 60_000 : backoff(failures);
    }

    static JSONObject envelope(String kind, String correlationId, JSONObject payload) {
        try {
            JSONObject e = new JSONObject().put("protocol", PROTOCOL).put("kind", kind).put("id", UUID.randomUUID().toString())
                .put("payload", payload == null ? new JSONObject() : payload);
            if (correlationId != null) e.put("correlationId", correlationId);
            return e;
        } catch (Exception x) { throw new IllegalStateException(x); }
    }

    /**
     * The {@code hello}: the console app as the {@code amberx} device service. Capabilities are the ones whose tools
     * this build has ({@link DeviceBridge#capabilities}), so the hub never routes a tool here that would only answer
     * {@code not_implemented} (AmberX keeps the recorder until it moves).
     */
    static JSONObject hello(String deviceId, String deviceName, String version, JSONArray capabilities, JSONObject state) {
        if (!validDeviceId(deviceId)) throw new IllegalArgumentException("bad device id");
        try {
            JSONObject p = new JSONObject()
                .put("deviceId", deviceId)
                .put("name", deviceName == null ? "" : deviceName)
                .put("app", BridgeContract.APP)
                .put("service", "amberx")
                .put("version", version == null ? "" : version)
                .put("bridge", BridgeContract.VERSION)
                .put("capabilities", capabilities == null ? new JSONArray() : capabilities)
                .put("state", state == null ? new JSONObject() : state);
            return envelope("hello", null, p);
        } catch (Exception x) { throw new IllegalStateException(x); }
    }

    static JSONObject next(String deviceId) {
        try { return new JSONObject().put("deviceId", deviceId).put("wait", POLL_SECONDS); }
        catch (Exception x) { throw new IllegalStateException(x); }
    }

    /** One call the hub sent: its id, the tool name as the hub spelled it, and its arguments. */
    static final class HubCall {
        final String id, name;
        final JSONObject args;
        HubCall(String id, String name, JSONObject args) { this.id = id; this.name = name; this.args = args; }
    }

    /** Reads a hub envelope; throws (with the call id when there is one) for anything that isn't a call. */
    static HubCall callOf(JSONObject envelope) {
        if (envelope == null) throw new IllegalArgumentException("empty envelope");
        if (!"call".equals(envelope.optString("kind"))) throw new IllegalArgumentException("not a call: " + envelope.optString("kind"));
        JSONObject p = envelope.optJSONObject("payload");
        String name = p == null ? "" : p.optString("tool", "");
        JSONObject args = p == null ? null : p.optJSONObject("arguments");
        if (args == null && p != null) args = p.optJSONObject("args");
        return new HubCall(envelope.optString("id", null), name, args == null ? new JSONObject() : args);
    }

    /**
     * The bridge's answer as the AXPP reply: {@code result} with {@code data} (and the device state), or {@code error}
     * with the bridge's code and message (and the permissions to ask for), correlated to the hub's call id.
     */
    static JSONObject reply(String callId, JSONObject bridgeAnswer, JSONObject state) {
        try {
            if (bridgeAnswer != null && bridgeAnswer.optBoolean("ok")) {
                JSONObject data = bridgeAnswer.optJSONObject("data");
                return envelope("result", callId, new JSONObject().put("data", data == null ? new JSONObject() : data)
                    .put("tool", bridgeAnswer.opt("tool")).put("state", state == null ? new JSONObject() : state));
            }
            JSONObject err = bridgeAnswer == null ? null : bridgeAnswer.optJSONObject("error");
            JSONObject p = new JSONObject()
                .put("code", err == null ? BridgeContract.E_UNAVAILABLE : err.optString("code", BridgeContract.E_UNAVAILABLE))
                .put("message", err == null ? "The console app didn't answer." : err.optString("message", ""));
            if (err != null && err.has("permissions")) p.put("permissions", err.get("permissions"));
            return envelope("error", callId, p);
        } catch (Exception x) { throw new IllegalStateException(x); }
    }

    /** What {@code answer} posts: the device id and the reply envelope. */
    static JSONObject answerBody(String deviceId, JSONObject envelope) {
        try { return new JSONObject().put("deviceId", deviceId).put("envelope", envelope); }
        catch (Exception x) { throw new IllegalStateException(x); }
    }
}
