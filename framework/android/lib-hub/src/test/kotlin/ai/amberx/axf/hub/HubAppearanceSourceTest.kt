package ai.amberx.axf.hub

import ai.amberx.axf.kernel.engine.AppearanceChange
import ai.amberx.axf.kernel.engine.AppearanceSourceState
import ai.amberx.axf.kernel.runtime.AppearanceEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The Android source against a fake hub data API: 404 first run, ETag/If-Match, 409 re-merge, 401, network error. */
class HubAppearanceSourceTest {
    private val server = MockWebServer()
    private var stored: Pair<String, String>? = null
    private var conflictOnce = false
    private var mode = "ok"
    private val puts = ArrayList<RecordedRequest>()

    @Before fun up() {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (mode == "signed-out") return MockResponse().setResponseCode(401).setBody("{}")
                if (request.getHeader("Cookie") != "axhub_session=abc") return MockResponse().setResponseCode(401).setBody("{}")
                if (request.path!!.startsWith("/data-events")) return MockResponse().setResponseCode(200).setHeader("Content-Type", "text/event-stream").setBody("event: ready\ndata: {}\n\n")
                return when (request.method) {
                    "GET" -> stored?.let { (t, v) -> MockResponse().setResponseCode(200).setHeader("X-Data-Version", v).setBody(t) } ?: MockResponse().setResponseCode(404).setBody("{}")
                    "PUT" -> {
                        puts += request
                        if (conflictOnce) { conflictOnce = false; stored = """{"${'$'}axf":"appearance@1","slots":{"layout":"focus-top","style-theme":"glass-orbit"}}""" to "cccccccccccccccc"; return MockResponse().setResponseCode(409).setBody("{}") }
                        val im = request.getHeader("If-Match")
                        if (im != "new" && im != "\"${stored?.second}\"") return MockResponse().setResponseCode(409).setBody("{}")
                        val body = request.body.readUtf8()
                        stored = body to body.length.toString().padStart(16, '0')
                        MockResponse().setResponseCode(200).setHeader("X-Data-Version", stored!!.second).setBody("{}")
                    }
                    else -> MockResponse().setResponseCode(405)
                }
            }
        }
        server.start()
    }
    @After fun down() { server.shutdown() }

    private fun source(creds: HubCredentials = HubCredentials { HubCredential.SessionCookie("axhub_session=abc") }) =
        HubAppearanceSource(server.url("/").toString().trimEnd('/'), "test-app", creds, live = false, pollMs = 100_000, scope = CoroutineScope(SupervisorJob() + Dispatchers.Default))

    private fun await(cond: () -> Boolean) { val end = System.currentTimeMillis() + 5000; while (!cond() && System.currentTimeMillis() < end) Thread.sleep(20); assertTrue(cond()) }

    @Test fun `http hub is refused, https or local http accepted`() {
        assertNull(HubOrigin.normalize("http://axhub.amberxai.com"))
        assertEquals("https://axhub.amberxai.com", HubOrigin.normalize("https://AXHUB.amberxai.com/"))
        assertNull(HubOrigin.normalize("https://user:pw@axhub.amberxai.com"))
        assertNull(HubOrigin.normalize("https://axhub.amberxai.com/path"))
        assertEquals("http://127.0.0.1:8080", HubOrigin.normalize("http://127.0.0.1:8080"))
    }

    @Test fun `first run, save, conflict re-merge, sign-out and hub down`() {
        val src = source()
        val events = ArrayList<AppearanceEvent>()
        src.subscribe { synchronized(events) { events += it } }
        src.start()
        await { src.state() == AppearanceSourceState.Ready(null) }
        assertTrue(synchronized(events) { events.any { it is AppearanceEvent.Document && it.doc == null } })
        src.save(AppearanceChange(slots = mapOf("color-theme" to "neon-tide")))
        await { puts.size == 1 && src.state() is AppearanceSourceState.Ready && (src.state() as AppearanceSourceState.Ready).version != null }
        assertEquals("new", puts[0].getHeader("If-Match"))
        assertTrue(stored!!.first.contains("\"updatedBy\":\"test-app\""))
        conflictOnce = true
        src.save(AppearanceChange(slots = mapOf("color-theme" to "amber-ember")))
        await { puts.size >= 3 && stored!!.first.contains("amber-ember") }
        assertTrue("other app's keys kept", stored!!.first.contains("focus-top") && stored!!.first.contains("glass-orbit"))
        mode = "signed-out"; src.refresh()
        await { src.state() is AppearanceSourceState.Unauthorized }
        mode = "ok"; src.refresh()
        await { src.state() is AppearanceSourceState.Ready }
        src.stop()
        server.shutdown()
        val down = HubAppearanceSource(server.url("/").toString().trimEnd('/'), "test-app", { HubCredential.SessionCookie("axhub_session=abc") }, live = false)
        down.start()
        await { down.state() is AppearanceSourceState.Unreachable }
        assertEquals(1000L, (down.state() as AppearanceSourceState.Unreachable).retryInMs)
        down.stop()
    }

    @Test fun `no credential = unauthorized, never a request`() {
        val src = source(HubCredentials { null })
        src.start()
        await { src.state() is AppearanceSourceState.Unauthorized }
        assertEquals(0, server.requestCount)
        src.stop()
    }
}
