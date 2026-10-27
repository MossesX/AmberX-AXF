package ai.amberx.axf.ai

import java.io.IOException

/**
 * A scripted assistant behind axHub. Calls are answered by [onCall]; each stream request takes the next script from
 * [streams] (lines to send, then either end normally, return a status, or drop the connection).
 */
class FakeHubTransport : AiHubTransport {
    override val origin: String = "https://console.example.com"
    val calls = ArrayList<Pair<AiHubRequest, Boolean>>()
    val streamPaths = ArrayList<String>()
    var onCall: (AiHubRequest) -> AiHubResponse = { AiHubResponse(404, """{"detail":"no route"}""") }

    sealed interface Script {
        data class Lines(val lines: List<String>, val code: Int = 200) : Script
        data class Drop(val lines: List<String>) : Script
        data class Status(val code: Int, val body: String = "{}") : Script
    }
    val streams = ArrayDeque<Script>()
    /** after the scripts run out: an idle stream with nothing new */
    var whenEmpty: Script = Script.Lines(listOf("event: replay", """data: {"next":0,"gap":false,"reset":false,"more":false,"state":"idle","lastSeq":0}""", ""))

    override suspend fun call(request: AiHubRequest, headersOnly: Boolean): AiHubResponse {
        calls += request to headersOnly
        val r = onCall(request)
        return if (headersOnly && r.code in 200..299) AiHubResponse(r.code) else r
    }

    override suspend fun stream(request: AiHubRequest, onLine: suspend (String) -> Unit): AiHubResponse {
        streamPaths += request.path
        return when (val s = streams.removeFirstOrNull() ?: whenEmpty) {
            is Script.Lines -> { for (l in s.lines) onLine(l); AiHubResponse(s.code) }
            is Script.Drop -> { for (l in s.lines) onLine(l); throw IOException("connection reset") }
            is Script.Status -> AiHubResponse(s.code, s.body)
        }
    }

    companion object {
        fun replay(next: Long, state: String, reset: Boolean = false, gap: Boolean = false, last: Long = next) =
            listOf("event: replay", """data: {"next":$next,"gap":$gap,"reset":$reset,"more":false,"state":"$state","lastSeq":$last}""", "")
        fun ev(seq: Long, kind: String, data: String = "{}") = listOf("id: $seq", "event: $kind", "data: $data", "")
    }
}
