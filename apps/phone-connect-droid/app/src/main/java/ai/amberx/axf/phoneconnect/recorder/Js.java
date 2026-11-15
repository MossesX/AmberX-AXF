package ai.amberx.axf.phoneconnect.recorder;

import org.json.JSONException;
import org.json.JSONObject;

/** A JSONObject whose put never throws (what the recorder used from Capacitor's JSObject before it moved here). */
public class Js extends JSONObject {
    public Js() { super(); }
    public Js(String json) throws JSONException { super(json); }

    @Override public Js put(String key, boolean value) { try { super.put(key, value); } catch (JSONException ignored) { } return this; }
    @Override public Js put(String key, int value) { try { super.put(key, value); } catch (JSONException ignored) { } return this; }
    @Override public Js put(String key, long value) { try { super.put(key, value); } catch (JSONException ignored) { } return this; }
    @Override public Js put(String key, double value) { try { super.put(key, value); } catch (JSONException ignored) { } return this; }
    @Override public Js put(String key, Object value) { try { super.put(key, value); } catch (JSONException ignored) { } return this; }
}
