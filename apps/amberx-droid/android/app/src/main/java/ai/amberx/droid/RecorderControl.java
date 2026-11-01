package ai.amberx.droid;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

/**
 * The Audio Output Recorder driven from axHub (`amberx.recorder_start|stop|status`, axHub decision #108), the pure part:
 * the AXPP command names, the session a remote start sets, and the names its parts get. No Android imports, so it runs
 * under plain JUnit ({@code RecorderControlTest}). The Android side is {@link AxppLink} (the hub connection) and the
 * existing recorder ({@link OutputRecordService}); nothing here records anything.
 *
 * Part name: {@code "<session_name> - <YYYY-MM-DD HH-mm> - partN"}, the time being when the session started (phone's
 * local time), N from 1. Web twin: output-recorder core.ts {@code sessionPartName}.
 *
 * Microphone: the recorder has no microphone path at all (AudioPlaybackCapture only); a remote command can't change
 * that, and status always reports {@code mic: false}.
 */
final class RecorderControl {
    private RecorderControl() {}

    static final String START = "recorder.start";
    static final String STOP = "recorder.stop";
    static final String STATUS = "recorder.status";
    static final int MAX_NAME = 80;
    static final int MAX_NOTE = 500;

    /** A session or group name made safe for a file name and a list heading (twin: core.ts cleanSession). */
    static String clean(String raw) {
        String c = raw == null ? "" : raw.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        if (c.length() > MAX_NAME) c = c.substring(0, MAX_NAME).trim();
        return c.isEmpty() ? "Session" : c;
    }

    static String partName(String session, long startedMs, int part, TimeZone tz) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd HH-mm", Locale.US);
        f.setTimeZone(tz);
        return clean(session) + " - " + f.format(new Date(startedMs)) + " - part" + Math.max(1, part);
    }

    /** What a remote start sets: the session, its group (default: the session) and note. */
    static final class Session {
        final String name, group, note;
        Session(String name, String group, String note) { this.name = name; this.group = group; this.note = note; }
    }

    /** The session from a `recorder.start` call's arguments; throws with a message the hub shows when it's unusable. */
    static Session sessionOf(JSONObject args) {
        String raw = args == null ? "" : args.optString("session_name", "");
        if (raw.trim().isEmpty()) throw new IllegalArgumentException("session_name is required.");
        String name = clean(raw);
        String g = args.optString("group", "");
        String group = g.trim().isEmpty() ? name : clean(g);
        String note = args.optString("note", "").replaceAll("\\p{Cntrl}", " ").trim();
        if (note.length() > MAX_NOTE) note = note.substring(0, MAX_NOTE);
        return new Session(name, group, note);
    }

    /** True for the commands this app takes from the hub. */
    static boolean known(String tool) {
        return START.equals(tool) || STOP.equals(tool) || STATUS.equals(tool);
    }
}
