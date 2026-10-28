package ai.amberx.droid;

import static org.junit.Assert.assertEquals;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** SpeechTuning gives the same answers as src/plugins/voice/web/speech.ts on the shared speech-cases.json. */
public class SpeechTuningTest {
    private static JSONObject cases() throws Exception {
        // Gradle runs unit tests from the app module (android/app); look upward for the web folder.
        Path rel = Paths.get("src", "plugins", "voice", "web", "speech-cases.json");
        Path dir = Paths.get("").toAbsolutePath();
        for (int i = 0; i < 6 && dir != null; i++, dir = dir.getParent()) {
            Path p = dir.resolve(rel);
            if (Files.exists(p)) return new JSONObject(new String(Files.readAllBytes(p), StandardCharsets.UTF_8));
        }
        throw new IllegalStateException("speech-cases.json not found");
    }

    private static String strOrNull(JSONArray a, int i) { return a.isNull(i) ? null : a.getString(i); }

    @Test public void compact() throws Exception {
        JSONArray c = cases().getJSONArray("compact");
        for (int i = 0; i < c.length(); i++) assertEquals(c.getJSONArray(i).getString(1), SpeechTuning.compact(c.getJSONArray(i).getString(0)));
    }

    @Test public void wakePhrasesMatchLoosely() throws Exception {
        JSONObject w = cases().getJSONObject("wake");
        List<String> phrases = new ArrayList<>();
        for (int i = 0; i < w.getJSONArray("phrases").length(); i++) phrases.add(w.getJSONArray("phrases").getString(i));
        JSONArray c = w.getJSONArray("cases");
        for (int i = 0; i < c.length(); i++) {
            JSONArray k = c.getJSONArray(i);
            assertEquals(k.getString(0), strOrNull(k, 1), SpeechTuning.wakeHit(k.getString(0), phrases));
        }
    }

    @Test public void swearsComeBack() throws Exception {
        JSONArray c = cases().getJSONArray("unmask");
        for (int i = 0; i < c.length(); i++) assertEquals(c.getJSONArray(i).getString(1), SpeechTuning.unmask(c.getJSONArray(i).getString(0)));
    }
}
