package ai.amberx.axf.work

import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ExtensionRegistry
import ai.amberx.axf.kernel.work.DelayRule
import ai.amberx.axf.kernel.work.IntervalBounds
import ai.amberx.axf.kernel.work.JobSpec
import ai.amberx.axf.kernel.work.OutcomeRule
import ai.amberx.axf.kernel.work.PollWorker
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `axf.workers` contributions → a job registry, including ones contributed after start and withdrawn ones (pure part of
 * WorkModule's hosting; the Android side is PollJobs.register / unregister).
 */
class WorkerSyncTest {
    private fun worker(id: String) = PollWorker(JobSpec(id, "poll", IntervalBounds(60_000, 15_000, 600_000), mapOf("*" to OutcomeRule(DelayRule.Interval)))) { "ok" }

    private class Reg {
        val jobs = LinkedHashMap<String, PollWorker>()
        val log = ArrayList<String>()
    }

    private fun sync(reg: Reg) = WorkerSync<PollWorker>({ it.id }, { w ->
        require(!w.id.startsWith("bad")) { "bad id" }
        reg.jobs[w.id] = w; reg.log += "+${w.id}"
    }, { id -> reg.jobs.remove(id); reg.log += "-$id" })

    @Test fun registersNewAndDropsWithdrawn() {
        val reg = Reg(); val s = sync(reg)
        val a = worker("a"); val b = worker("b")
        assertEquals(WorkerSync.Change(listOf("a"), emptyList()), s.sync(listOf(a)))
        assertEquals(WorkerSync.Change(listOf("b"), emptyList()), s.sync(listOf(a, b)))   // late contribution
        assertEquals(WorkerSync.Change(emptyList(), emptyList()), s.sync(listOf(a, b)))   // nothing changed: no re-register
        assertEquals(WorkerSync.Change(emptyList(), listOf("a")), s.sync(listOf(b)))      // withdrawn
        assertEquals(listOf("+a", "+b", "-a"), reg.log)
        assertEquals(listOf("b"), s.ids())
    }

    @Test fun replacedValueIsRegisteredAgainAndDuplicatesKeepTheFirst() {
        val reg = Reg(); val s = sync(reg)
        val a1 = worker("a"); val a2 = worker("a")
        s.sync(listOf(a1, a2))
        assertTrue(reg.jobs["a"] === a1)
        s.sync(listOf(a2))
        assertTrue(reg.jobs["a"] === a2)
    }

    @Test fun failuresAreReportedAndNotOwned() {
        val reg = Reg(); val s = sync(reg)
        val failed = ArrayList<String>()
        val change = s.sync(listOf(worker("bad.one"), worker("ok"))) { w, e -> failed += "${w.id}: ${e.message}" }
        assertEquals(listOf("ok"), change.added)
        assertEquals(listOf("bad.one: bad id"), failed)
        assertEquals(listOf("ok"), s.ids())
    }

    @Test fun followsAnExtensionRegistryIncludingModuleStop() {
        val ext = ExtensionRegistry()
        val reg = Reg(); val s = sync(reg)
        fun resync() { s.sync(ext.get(ExtensionPoints.WORKERS).filterIsInstance<PollWorker>()) }
        ext.contribute(ExtensionPoints.WORKERS, "app", "not a worker")
        resync()
        ext.onChange(ExtensionPoints.WORKERS) { resync() }
        ext.contribute(ExtensionPoints.WORKERS, "plugin.automations", worker("automations.rules"))
        assertEquals(setOf("automations.rules"), reg.jobs.keys)
        ext.removeAllFrom("plugin.automations")   // the plugin's module stopped
        assertTrue(reg.jobs.isEmpty())
    }
}
