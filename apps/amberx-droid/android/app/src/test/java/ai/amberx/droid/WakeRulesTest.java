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

/** WakeRules gives the same answers as src/plugins/voice/web/wake.ts on the shared wake-cases.json. */
public class WakeRulesTest {
    private static JSONObject cases() throws Exception {
        Path rel = Paths.get("src", "plugins", "voice", "web", "wake-cases.json");
        Path dir = Paths.get("").toAbsolutePath();
        for (int i = 0; i < 6 && dir != null; i++, dir = dir.getParent()) {
            Path p = dir.resolve(rel);
            if (Files.exists(p)) return new JSONObject(new String(Files.readAllBytes(p), StandardCharsets.UTF_8));
        }
        throw new IllegalStateException("wake-cases.json not found");
    }

    private static List<String> list(JSONArray a) throws Exception {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        return out;
    }

    @Test public void grammar() throws Exception {
        JSONObject c = cases();
        assertEquals(list(c.getJSONArray("grammar")), WakeRules.grammar(list(c.getJSONArray("phrases"))));
    }

    @Test public void trigger() throws Exception {
        JSONObject c = cases();
        List<String> phrases = list(c.getJSONArray("phrases"));
        JSONArray t = c.getJSONArray("trigger");
        for (int i = 0; i < t.length(); i++) {
            JSONArray k = t.getJSONArray(i);
            String want = k.isNull(4) ? null : k.getString(4);
            assertEquals(k.toString(), want, WakeRules.trigger(k.getString(0), k.getBoolean(1), k.getString(2), k.getDouble(3), phrases));
        }
    }

    @Test public void clean() throws Exception {
        JSONArray t = cases().getJSONArray("clean");
        for (int i = 0; i < t.length(); i++) assertEquals(t.getJSONArray(i).getString(1), WakeRules.clean(t.getJSONArray(i).getString(0)));
    }

    @Test public void level() throws Exception {
        JSONArray t = cases().getJSONArray("level");
        for (int i = 0; i < t.length(); i++) {
            JSONArray k = t.getJSONArray(i);
            double level = WakeRules.levelOfDbfs(k.getDouble(0));
            assertEquals(k.getDouble(1), level, 1e-9);
            assertEquals(k.getDouble(2), WakeRules.recognizerDb(level), 1e-9);
        }
    }

    @Test public void sensitivity() throws Exception {
        JSONArray t = cases().getJSONArray("sensitivity");
        for (int i = 0; i < t.length(); i++) {
            JSONArray k = t.getJSONArray(i);
            assertEquals(k.getString(1), WakeRules.sensitivity(k.isNull(0) ? null : k.get(0)));
        }
    }
}
