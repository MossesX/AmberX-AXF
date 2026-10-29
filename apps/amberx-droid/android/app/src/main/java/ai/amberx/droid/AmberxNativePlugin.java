package ai.amberx.droid;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * The bridge the web side calls through `src/native.ts` (`AmberxNative`). Every method there has its twin here; the
 * browser fallback lives in native.ts. Hub calls only ever reach the hub's own origin (the page's hub, checked by
 * [HubRules]), carry the session from Android's cookie store, refuse redirects and cap replies.
 */
@CapacitorPlugin(
    name = "AmberxNative",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" }),
    }
)
public class AmberxNativePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private TextToSpeech tts;
    private boolean ttsReady;
    private static AmberxNativePlugin current;

    @Override
    public void load() {
        current = this;
        WatchService.channels(getContext());
        WatchService.listener = s -> notifyListeners("monitor", js(s));
        tts = new TextToSpeech(getContext(), status -> ttsReady = status == TextToSpeech.SUCCESS);
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) tts.shutdown();
        WatchService.listener = null;
        io.shutdown();
    }

    private static JSObject js(JSONObject o) {
        try { return JSObject.fromJSONObject(o); } catch (Exception e) { return new JSObject(); }
    }

    /* ---------------------------------------------------------------- hands-free events (from WatchService) */

    /** A wake phrase (or, always armed, a whole command) heard while the app is on screen: true when delivered. */
    static boolean wakeInApp(String phrase, String text) {
        AmberxNativePlugin p = current;
        if (p == null) return false;
        p.notifyListeners("wake", new JSObject().put("phrase", phrase).put("text", text), true);
        return true;
    }

    /** What the recognizer is hearing (partial or final), for the Voice page. */
    static void heard(String text, boolean last) {
        AmberxNativePlugin p = current;
        if (p != null && WatchService.inApp) p.notifyListeners("heard", new JSObject().put("text", text).put("final", last));
    }

    /** Input level (recognizer RMS dB), at most ten a second, for the Voice page's graph. */
    static void level(float db) {
        AmberxNativePlugin p = current;
        if (p != null && WatchService.inApp) p.notifyListeners("level", new JSObject().put("db", db));
    }

    /** A quick setting changed on the overlay: the web side saves it so Settings shows the same. */
    static void voiceChanged(JSONObject cfg) {
        AmberxNativePlugin p = current;
        if (p != null) p.notifyListeners("voiceSettings", js(cfg), true);
    }

    /** MainActivity hands notification taps and wake-phrase hits here. */
    static void deliver(Intent intent) {
        AmberxNativePlugin p = current;
        if (p == null || intent == null) return;
        String open = intent.getStringExtra(MainActivity.EXTRA_OPEN);
        if (open != null) p.notifyListeners("open", new JSObject().put("url", open), true);
        String veto = intent.getStringExtra(MainActivity.EXTRA_VETO);
        if (veto != null) p.notifyListeners("veto", new JSObject().put("id", veto).put("action", "open"), true);
        String wake = intent.getStringExtra(MainActivity.EXTRA_WAKE);
        if (wake != null) p.notifyListeners("wake", new JSObject().put("phrase", wake).put("text", intent.getStringExtra(MainActivity.EXTRA_WAKE_TEXT)), true);
    }

    /** A held command was denied (or the Deny failed) from its notification. */
    static void vetoEvent(String id, String action, String error) {
        AmberxNativePlugin p = current;
        if (p == null) return;
        JSObject o = new JSObject().put("id", id).put("action", action);
        if (error != null) o.put("error", error);
        p.notifyListeners("veto", o, true);
    }

    /* ---------------------------------------------------------------- veto approvals (VetoAlerts) */

    @PluginMethod
    public void vetoSettings(PluginCall call) {
        VetoAlerts.configure(getContext(), call.getData());
        call.resolve();
    }

    @PluginMethod
    public void vetoDeny(PluginCall call) {
        String id = call.getString("id", "");
        if (HubRules.approvalUrl(HubRules.HUB, id) == null) { call.reject("Not a request id."); return; }
        io.execute(() -> {
            int code = VetoAlerts.deny(getContext(), id);
            JSObject r = new JSObject().put("ok", code == 200);
            if (code == 200) r.put("state", "denied");
            else r.put("error", code < 0 ? "signed out of axHub" : "the hub answered " + code);
            call.resolve(r);
        });
    }

    @PluginMethod
    public void vetoTest(PluginCall call) {
        String phase = call.getString("phase", "held");
        VetoAlerts.test(getContext(), "warning".equals(phase) || "running".equals(phase) ? phase : "held");
        call.resolve();
    }

    /* ---------------------------------------------------------------- hub */

    @PluginMethod
    public void hubGet(PluginCall call) {
        String url = call.getString("url", "");
        String hub = HubRules.HUB;
        if (!HubRules.isHub(hub, url) || !url.startsWith(hub + "/")) { call.reject("Only this app's hub."); return; }
        io.execute(() -> {
            try {
                HubRules.Reply r = HubRules.get(url, CookieManager.getInstance().getCookie(hub));
                // A redirect is never followed: the hub sends one for a signed-out browser page, so report it as that.
                int status = r.status >= 300 && r.status < 400 ? 401 : r.status;
                JSObject out = new JSObject().put("status", status).put("body", r.body);
                if (r.etag != null) out.put("etag", r.etag);
                call.resolve(out);
            } catch (Exception e) {
                call.resolve(new JSObject().put("status", 0).put("body", ""));
            }
        });
    }

    @PluginMethod
    public void hubPut(PluginCall call) {
        String url = call.getString("url", "");
        String body = call.getString("body", "");
        String ifMatch = call.getString("ifMatch", "");
        String hub = HubRules.HUB;
        if (!HubRules.isDataPath(hub, url)) { call.reject("Only this app's hub data server."); return; }
        io.execute(() -> {
            try {
                HubRules.Reply r = HubRules.put(hub, url, body, ifMatch, CookieManager.getInstance().getCookie(hub));
                int status = r.status >= 300 && r.status < 400 ? 401 : r.status;
                JSObject out = new JSObject().put("status", status).put("body", r.body);
                if (r.etag != null) out.put("etag", r.etag);
                call.resolve(out);
            } catch (Exception e) {
                call.resolve(new JSObject().put("status", 0).put("body", ""));
            }
        });
    }

    @PluginMethod
    public void hubOpen(PluginCall call) {
        String url = call.getString("url", "");
        if (!HubRules.isHub(HubRules.HUB, url)) { call.reject("Only this app's hub."); return; }
        startActivityForResult(call, HubWebActivity.intent(getActivity(), url), "hubClosed");
    }

    @ActivityCallback
    private void hubClosed(PluginCall call, ActivityResult result) {
        if (call != null) call.resolve(new JSObject().put("closed", true));
    }

    @PluginMethod
    public void hubSignOut(PluginCall call) {
        CookieManager.getInstance().removeAllCookies(ok -> CookieManager.getInstance().flush());
        call.resolve();
    }

    /* ---------------------------------------------------------------- speech */

    @PluginMethod
    public void listen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) { requestPermissionForAlias("microphone", call, "listenAfterPermission"); return; }
        doListen(call);
    }

    @PermissionCallback
    private void listenAfterPermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) doListen(call);
        else call.reject("The microphone isn't allowed.");
    }

    private void doListen(PluginCall call) {
        WatchService.appMic(true); // hands-free lets go of the microphone while the Speak button listens
        getActivity().runOnUiThread(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { WatchService.appMic(false); call.reject("No speech recognizer on this phone."); return; }
            JSONObject voice = WatchService.voice(getContext());
            SpeechRecognizer rec = SpeechRecognizer.createSpeechRecognizer(getContext());
            SpeechTuning.quiet(getContext(), voice); // no tone
            rec.setRecognitionListener(new RecognitionListener() {
                private boolean done;
                private void finish(String text) {
                    if (done) return;
                    done = true;
                    WatchService.appMic(false);
                    if (WatchService.running == null) SpeechTuning.loud(getContext()); // hands-free keeps it quiet
                    call.resolve(new JSObject().put("text", text));
                    rec.destroy();
                }
                private String top(Bundle b) {
                    ArrayList<String> r = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    return r == null || r.isEmpty() ? "" : SpeechTuning.clean(r.get(0), voice);
                }
                @Override public void onResults(Bundle b) { finish(top(b)); }
                @Override public void onError(int error) { finish(""); }
                @Override public void onReadyForSpeech(Bundle b) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float v) { level(v); }
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() {}
                // Live text: what's been heard so far, as it's said (Brett: "text doesn't show up in real time").
                @Override public void onPartialResults(Bundle b) {
                    String t = top(b);
                    if (!t.isEmpty()) notifyListeners("heard", new JSObject().put("text", t).put("final", false).put("source", "listen"));
                }
                @Override public void onEvent(int t, Bundle b) {}
            });
            Intent i = SpeechTuning.request(call.getString("lang", "en-US"), voice, false);
            // Give hands-free a moment to release the microphone first.
            getActivity().getWindow().getDecorView().postDelayed(() -> {
                try { rec.startListening(i); } catch (Exception e) { WatchService.appMic(false); call.reject("The microphone is busy."); }
            }, 250);
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (tts == null || !ttsReady || text.isEmpty()) { call.resolve(); return; }
        tts.setLanguage(Locale.forLanguageTag(call.getString("lang", "en-US")));
        SpeechTuning.unmuteMedia(getContext()); // "silence-all" mutes media while listening; spoken replies need it
        tts.speak(text.length() > 2000 ? text.substring(0, 2000) : text, TextToSpeech.QUEUE_FLUSH, null, "amberx");
        call.resolve();
    }

    /* ---------------------------------------------------------------- background watch */

    @PluginMethod
    public void monitorStart(PluginCall call) {
        JSONObject cfg = call.getData();
        if (!HubRules.isHub(HubRules.HUB, cfg.optString("hub", ""))) { call.reject("Only this app's hub."); return; }
        WatchService.start(getContext(), cfg);
        call.resolve(js(WatchService.status));
    }

    @PluginMethod
    public void monitorStop(PluginCall call) {
        WatchService.stop(getContext());
        call.resolve(js(WatchService.idle()));
    }

    @PluginMethod
    public void monitorStatus(PluginCall call) {
        call.resolve(js(WatchService.status));
    }

    /* ---------------------------------------------------------------- hands-free + detection overlay */

    /** Saves the voice config (handsFree, alwaysArmed, overlay, wakePhrases, lang, colors) and starts/stops to match. */
    @PluginMethod
    public void voiceSet(PluginCall call) {
        JSONObject cfg = call.getData();
        if (cfg.optBoolean("handsFree", true) && getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "voiceSetAfterPermission");
            return;
        }
        WatchService.setVoice(getContext(), cfg);
        call.resolve(voiceStatusJs());
    }

    @PermissionCallback
    private void voiceSetAfterPermission(PluginCall call) {
        WatchService.setVoice(getContext(), call.getData());
        call.resolve(voiceStatusJs());
    }

    @PluginMethod
    public void voiceStatus(PluginCall call) { call.resolve(voiceStatusJs()); }

    private JSObject voiceStatusJs() {
        boolean listening = WatchService.status.optBoolean("listening", false);
        return new JSObject()
            .put("listening", listening)
            .put("microphone", getPermissionState("microphone") == PermissionState.GRANTED)
            .put("overlayAllowed", DetectionOverlay.canDraw(getContext()))
            .put("engine", WatchService.status.optString("engine", WatchService.wakeMode(getContext()) ? "wake" : "classic"))
            .put("phase", WatchService.status.optString("phase", ""))
            .put("phaseDetail", WatchService.status.optString("phaseDetail", ""));
    }

    /** Opens Android's "Display over other apps" screen for AmberX; resolves with whether it's allowed when they return. */
    @PluginMethod
    public void overlayPermission(PluginCall call) {
        if (DetectionOverlay.canDraw(getContext())) { call.resolve(new JSObject().put("allowed", true)); return; }
        startActivityForResult(call, DetectionOverlay.permissionIntent(getContext()), "overlayPermissionResult");
    }

    @ActivityCallback
    private void overlayPermissionResult(PluginCall call, ActivityResult result) {
        boolean ok = DetectionOverlay.canDraw(getContext());
        WatchService s = WatchService.running;
        if (ok && s != null) s.syncOverlay();
        if (call != null) call.resolve(new JSObject().put("allowed", ok));
    }

    @PluginMethod
    public void permissions(PluginCall call) {
        boolean needNotify = Build.VERSION.SDK_INT >= 33;
        if (getPermissionState("microphone") == PermissionState.GRANTED && (!needNotify || getPermissionState("notifications") == PermissionState.GRANTED)) {
            permissionsResult(call);
            return;
        }
        requestPermissionForAliases(needNotify ? new String[] { "microphone", "notifications" } : new String[] { "microphone" }, call, "permissionsResult");
    }

    @PermissionCallback
    private void permissionsResult(PluginCall call) {
        boolean notify = Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED;
        call.resolve(new JSObject().put("microphone", getPermissionState("microphone") == PermissionState.GRANTED).put("notifications", notify));
    }
}
