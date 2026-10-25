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

    /** MainActivity hands notification taps and wake-phrase hits here. */
    static void deliver(Intent intent) {
        AmberxNativePlugin p = current;
        if (p == null || intent == null) return;
        String open = intent.getStringExtra(MainActivity.EXTRA_OPEN);
        if (open != null) p.notifyListeners("open", new JSObject().put("url", open), true);
        String wake = intent.getStringExtra(MainActivity.EXTRA_WAKE);
        if (wake != null) p.notifyListeners("wake", new JSObject().put("phrase", wake).put("text", intent.getStringExtra(MainActivity.EXTRA_WAKE_TEXT)), true);
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
        getActivity().runOnUiThread(() -> {
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) { call.reject("No speech recognizer on this phone."); return; }
            SpeechRecognizer rec = SpeechRecognizer.createSpeechRecognizer(getContext());
            rec.setRecognitionListener(new RecognitionListener() {
                private boolean done;
                private void finish(String text) {
                    if (done) return;
                    done = true;
                    call.resolve(new JSObject().put("text", text));
                    rec.destroy();
                }
                @Override public void onResults(Bundle b) {
                    ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    finish(r == null || r.isEmpty() ? "" : r.get(0));
                }
                @Override public void onError(int error) { finish(""); }
                @Override public void onReadyForSpeech(Bundle b) {}
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float v) {}
                @Override public void onBufferReceived(byte[] b) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onPartialResults(Bundle b) {}
                @Override public void onEvent(int t, Bundle b) {}
            });
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("lang", "en-US"))
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            rec.startListening(i);
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        if (tts == null || !ttsReady || text.isEmpty()) { call.resolve(); return; }
        tts.setLanguage(Locale.forLanguageTag(call.getString("lang", "en-US")));
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
