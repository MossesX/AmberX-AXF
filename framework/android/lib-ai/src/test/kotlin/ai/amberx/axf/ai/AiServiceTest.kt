package ai.amberx.axf.ai

import ai.amberx.axf.ai.FakeHubTransport.Companion.ev
import ai.amberx.axf.ai.FakeHubTransport.Companion.replay
import ai.amberx.axf.kernel.ai.AiModeRegistry
import ai.amberx.axf.kernel.ai.AiModes
import ai.amberx.axf.kernel.ai.AiRequestInput
import ai.amberx.axf.kernel.ai.ModeReason
import ai.amberx.axf.kernel.ai.ModelOption
import ai.amberx.axf.kernel.ai.ModelTier
import ai.amberx.axf.kernel.ai.PlaceholderAiSessionClient
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.Principal
import ai.amberx.axf.kernel.live.LiveKinds
import ai.amberx.axf.kernel.platform.MemoryKeyValueStore
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.triggers.TriggerCommand
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiServiceTest {
    private val hub = FakeHubTransport()
    private val client = HubAiSessionClient(hub, options = AiLiveOptions(1, 2, 2))
    private val kv = MemoryKeyValueStore()
    private val config = Config()
    private var perms: Set<String> = emptySet()
    private var principal: Principal? = null
    private val models = listOf(ModelOption("m-fast", ModelTier.FAST), ModelOption("m-bal", ModelTier.BALANCED), ModelOption("m-deep", ModelTier.DEEP))
    private val service = AiService(AiModeRegistry(), { client }, AiPolicies.local({ perms }, { principal }), AiSettings(config, kv), AiCursors(kv), { models })

    @Test fun nonAdminsGetChatOnlyByDefault() {
        assertEquals(listOf(AiModes.CHAT), service.availableModes().map { it.id })
        val r = service.resolve(override = AiModes.BUILD_REQUEST)
        assertEquals(AiModes.CHAT, r.mode!!.id)
        assertEquals(ModeReason.FALLBACK, r.reason)
        assertEquals(AiModes.BUILD_REQUEST, r.denied)
    }

    @Test fun uacGrantsModesPerUser() {
        perms = setOf("ai.read", "ai.mode.ai.read-codebase")
        assertTrue(service.canUse(AiModes.READ_CODEBASE))
        assertFalse(service.canUse(AiModes.BUILD_REQUEST))
        perms = setOf("ai.read"); principal = Principal("bea", roles = listOf("user"), attributes = mapOf(AiPolicies.MODES_ATTRIBUTE to "ai.read-codebase"))
        assertTrue(service.canUse(AiModes.READ_CODEBASE))
        perms = setOf("*")
        assertEquals(3, service.availableModes().size)
        assertEquals(ModeReason.OVERRIDE, service.resolve(override = AiModes.BUILD_REQUEST).reason)
    }

    @Test fun theHubAccountWinsOverTheLocalRole() = runBlocking {
        perms = setOf("*")
        hub.onCall = { AiHubResponse(200, """{"user":{"name":"bea"},"admin":false,"can":{"assistant.models":false}}""") }
        assertTrue(service.refreshAccount().isOk)
        assertEquals("bea", service.account()!!.user)
        assertEquals(listOf(AiModes.CHAT), service.availableModes().map { it.id })
        hub.onCall = { AiHubResponse(401) }
        service.refreshAccount()
        assertNull("signed out: back to the local view", service.account())
        assertEquals(3, service.availableModes().size)
    }

    @Test fun settingsFillTheRequest() {
        assertEquals(AiModes.CHAT, service.settings.mode)
        assertEquals("", service.settings.model)
        assertFalse(service.settings.readAloud)
        service.settings.mode = AiModes.READ_CODEBASE
        service.settings.model = " m-deep "
        service.settings.readAloud = true
        assertEquals("m-deep", config.string(AiSettings.MODEL))
        assertEquals("true", kv.get(AiSettings.READ_ALOUD))
        // non-admin, no assistant.models: the read-codebase preference falls back to chat and the model pick is ignored
        val r = service.prepare(AiRequestInput("hi"))
        assertEquals(AiModes.CHAT, r.request!!.mode)
        assertEquals("m-bal", r.request!!.model)
        perms = setOf("*")
        val a = service.prepare(AiRequestInput("hi"))
        assertEquals(AiModes.READ_CODEBASE, a.request!!.mode)
        assertEquals("m-deep", a.request!!.model)
        val group = AiSettings.group(AiModeRegistry().list(), "ai.amberx.axf.ai")
        assertEquals(listOf(AiSettings.MODE, AiSettings.MODEL, AiSettings.READ_ALOUD), group.settings.map { it.key })
    }

    @Test fun triggersOverrideTheMode() {
        perms = setOf("*")
        val cmd = TriggerCommand("notes.build", "ai.start", JsonObject(mapOf("mode" to JsonPrimitive(AiModes.BUILD_REQUEST), "text" to JsonPrimitive("add dark mode"))), heard = "build add dark mode")
        val input = service.inputFrom(cmd)
        assertEquals("add dark mode", input.prompt)
        val r = service.prepare(input)
        assertEquals(AiModes.BUILD_REQUEST, r.request!!.mode)
        assertTrue(r.request!!.needsApproval)
        assertEquals("notes.build", r.request!!.triggerId)
        assertEquals(ModeReason.OVERRIDE, r.resolution.reason)
    }

    @Test fun startIsDeniedWhenNothingIsAllowed() = runBlocking {
        principal = Principal("x", attributes = mapOf(AiPolicies.MODES_ATTRIBUTE to ""))
        val svc = AiService(AiModeRegistry(), { client }, { ai.amberx.axf.kernel.ai.AiModePolicy(false, emptyList(), emptyList()) }, AiSettings(null), AiCursors(null))
        assertTrue((svc.start(AiRequestInput("hi")) as AxfResult.Err).failure is AxfFailure.Denied)
        assertTrue(hub.calls.isEmpty())
        assertTrue((service.start(AiRequestInput("  ")) as AxfResult.Err).failure is AxfFailure.Invalid)
    }

    @Test fun repliesFoldStreamSaveTheCursorAndFinishOnce() = runBlocking {
        service.settings.readAloud = true
        hub.streams += FakeHubTransport.Script.Lines(replay(0, "running") + ev(1, LiveKinds.TURN_START) + ev(2, "start", """{"turnId":"t1"}""") +
            ev(3, "text", """{"text":"Hel"}""") + ev(4, "text", """{"text":"lo"}""") + ev(5, "done") + ev(6, LiveKinds.TURN_END) + ev(7, LiveKinds.CLOSE))
        val ups = withTimeout(5_000) { service.replies("c1").toList() }
        assertEquals("Hello", ups.last { it.item is AiStreamItem.Event && (it.item as AiStreamItem.Event).event.seq == 5L }.text)
        assertEquals(1, ups.count { it.finished })
        assertEquals(1, ups.count { service.shouldReadAloud(it) })
        assertEquals(7L, service.cursors.get("c1"))
        assertEquals("7", kv.get("axf.ai.cursor.c1"))
        // reopening resumes from the saved cursor
        hub.streams += FakeHubTransport.Script.Lines(replay(7, "closed"))
        withTimeout(5_000) { service.replies("c1").toList() }
        assertTrue(hub.streamPaths.last().contains("since=7"))
    }

    @Test fun withoutLibAiTheServiceSaysSo() = runBlocking {
        val svc = AiService(AiModeRegistry(), { PlaceholderAiSessionClient }, AiPolicies.local({ emptySet() }), AiSettings(null), AiCursors(null))
        assertFalse(svc.installed)
        val ups = svc.replies("c1").toList()
        assertTrue(ups.single().item is AiStreamItem.Failed)
        assertTrue((svc.refreshAccount() as AxfResult.Err).failure is AxfFailure.NotImplemented)
    }

    @Test fun closeEndsOnTheHubAndForgetsTheCursor() = runBlocking {
        service.cursors.put("c1", 4)
        hub.onCall = { AiHubResponse(200, """{"closed":true}""") }
        assertTrue(service.close("c1").isOk)
        assertEquals(0L, service.cursors.get("c1"))
    }
}
