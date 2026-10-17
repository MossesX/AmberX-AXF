package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.interop.ActionDescriptor
import ai.amberx.axf.kernel.interop.CallOrigin
import ai.amberx.axf.kernel.interop.CallableAction
import ai.amberx.axf.kernel.interop.Exposure
import ai.amberx.axf.kernel.interop.JsonSchemas
import ai.amberx.axf.kernel.interop.OriginKind
import ai.amberx.axf.kernel.interop.RemoteCaller
import ai.amberx.axf.kernel.interop.WireCodes
import ai.amberx.axf.kernel.interop.toWire
import ai.amberx.axf.kernel.manifest.AxfManifest
import ai.amberx.axf.kernel.result.AxfFailure
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Interop gate: default-deny exposure, caller grants AND role, schema checks, callables, surfaces, wire errors. */
class InteropTest {
    private val manifest = AxfManifest.parse("""{"${'$'}axf":"manifest@1","app":{"id":"test","name":"Test","version":"0.1.0"},"framework":{"version":"0.2.0","template":"android-compose"},"targets":["android"],"startView":"home","defaults":${File("../../defaults.json").readText()}}""")!!
    private fun kernel() = AxfKernel.builder(manifest).build()
    private val input = JsonObject(mapOf("title" to JsonPrimitive("hi")))
    private val schema = JsonSchemas.obj(mapOf("title" to JsonSchemas.prop("string")), required = listOf("title"))
    private fun caller(vararg perms: String) = CallOrigin.remote(RemoteCaller("t1", "mcp", permissions = perms.toSet()), "mcp/test", "c1")

    @Test fun `actions without a descriptor are invisible to remote callers`() = runTest {
        val k = kernel()
        k.runtime.actions.register("notes.create", ActionMeta("Create")) { _, _ -> }
        val r = k.interop.invoke("notes.create", input, caller("*"))
        assertTrue(r.failureOrNull() is AxfFailure.NotFound)
        assertTrue(k.interop.surface(OriginKind.REMOTE).actions.isEmpty())
        // the app's own UI can still call it
        assertTrue(k.interop.invoke("notes.create", input, CallOrigin.UI).isOk)
    }

    @Test fun `LINKED exposure is not reachable remotely`() = runTest {
        val k = kernel()
        k.runtime.actions.register("notes.create", ActionMeta("Create")) { _, _ -> }
        k.interop.describe(ActionDescriptor("notes.create", "Create a note", schema, exposure = Exposure.LINKED))
        assertTrue(k.interop.invoke("notes.create", input, caller("*")).failureOrNull() is AxfFailure.NotFound)
        assertEquals(1, k.interop.surface(OriginKind.LINKED_APP).actions.size)
    }

    @Test fun `remote callers need their own grant for the action's permission`() = runTest {
        val k = kernel()
        k.runtime.actions.register("notes.delete", ActionMeta("Delete", requires = "notes.write")) { _, _ -> }
        k.interop.describe(ActionDescriptor("notes.delete", "Delete a note", exposure = Exposure.REMOTE))
        val denied = k.interop.invoke("notes.delete", JsonObject(emptyMap()), caller("files.read"))
        assertEquals("notes.write", (denied.failureOrNull() as? AxfFailure.Denied)?.permission)
        assertEquals(WireCodes.DENIED, denied.failureOrNull()!!.toWire().code)
    }

    @Test fun `schema check runs before the handler and callables return values`() = runTest {
        val k = kernel()
        k.interop.describe(ActionDescriptor("notes.create", "Create a note", schema, exposure = Exposure.REMOTE), CallableAction { call ->
            AxfResult.ok(JsonPrimitive("created:" + (call.input["title"] as JsonPrimitive).content))
        })
        assertTrue(k.interop.invoke("notes.create", JsonObject(emptyMap()), caller("*")).failureOrNull() is AxfFailure.Validation)
        assertEquals(JsonPrimitive("created:hi"), k.interop.invoke("notes.create", input, caller("*")).getOrNull())
        assertEquals(listOf("notes.create"), k.interop.surface(OriginKind.REMOTE).actions.map { it.id })
    }

    @Test fun `external calls are audited and long-running actions need the job manager`() = runTest {
        val k = kernel()
        k.interop.describe(ActionDescriptor("media.transcode", "Transcode a file", exposure = Exposure.REMOTE, longRunning = true), CallableAction { AxfResult.ok(JsonPrimitive("done")) })
        val r = k.interop.invoke("media.transcode", JsonObject(emptyMap()), caller("*"))
        assertEquals("axf.jobs", (r.failureOrNull() as? AxfFailure.NotImplemented)?.capability)
        val audit = k.services.get(ai.amberx.axf.kernel.contract.AuditLog::class)!!.recent(5)
        assertTrue(audit.any { it.action == "media.transcode" && it.details["outcome"] == WireCodes.NOT_IMPLEMENTED && it.details["correlationId"] == "c1" })
        assertTrue("axf.jobs" in k.services.placeholders() && "axf.remote" in k.services.placeholders())
    }

    @Test fun `wire errors round-trip and never leak exception text`() {
        val e = AxfFailure.Unexpected("NullPointerException at Foo.kt:12").toWire()
        assertEquals(WireCodes.UNEXPECTED, e.code)
        assertTrue("Foo.kt" !in e.message)
        val nf = AxfFailure.NotFound("action", "x").toWire().toFailure()
        assertEquals("x", (nf as AxfFailure.NotFound).id)
    }
}
