package ai.amberx.axf.phoneconnect.recorder

import ai.amberx.axf.phoneconnect.watch.Commands
import ai.amberx.axf.phoneconnect.watch.Outcome
import org.json.JSONObject

/** The recorder session a console command started (session name, axHub group, note) and the command waiting on it. */
object RecordSession {
    @Volatile var session: String = ""
    @Volatile var group: String = ""
    @Volatile var note: String = ""
    @Volatile var waiting: String = "" // the recorder.start command id still waiting for its result
    @Volatile var running: Boolean = false
    @Volatile var since: String = ""
    @Volatile var parts: Int = 0
    @Volatile var queue: Int = 0

    fun state(): JSONObject = JSONObject().put("running", running).put("since", since).put("session", session)
        .put("parts", parts).put("queue", queue).put("mic", false)

    fun started(at: String) {
        running = true; since = at; parts = 0
        settle(Outcome.Done(JSONObject().put("running", true).put("since", at).put("session", session), JSONObject().put("recorder@1", state())))
    }

    fun refused(why: String) { settle(Outcome.Failed("consent_required", why)) }

    fun stopped() { running = false; session = ""; group = ""; note = "" }

    private fun settle(o: Outcome) {
        val id = waiting
        if (id.isNotEmpty()) { waiting = ""; Commands.later.add(id to o) }
    }
}
