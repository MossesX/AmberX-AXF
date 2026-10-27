package ai.amberx.axf.data

import kotlinx.coroutines.test.runTest
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Raw keys can be deleted one by one or by prefix (uninstalled plugins' settings), on the in-memory store. */
class PreferenceStoreRemoveTest {
    @Test fun prefixRuleIgnoresBlankAndRepeats() {
        assertEquals(emptyList(), PrefKeys.underPrefix(listOf("a.b", "a.c"), ""))
        assertEquals(emptyList(), PrefKeys.underPrefix(listOf("a.b"), "  "))
        assertEquals(listOf("p.x.one", "p.x.two"), PrefKeys.underPrefix(listOf("p.x.one", "p.xy", "p.x.two", "p.x.one", "q.p.x.one"), "p.x."))
    }

    @Test fun removeRawDeletesOneKey() = runTest {
        val p = PreferenceStore.inMemory()
        p.setRaw("plugin.sorter.mode", "auto")
        p.setRaw("app.theme", "dark")
        assertTrue(p.removeRaw("plugin.sorter.mode"))
        assertFalse(p.removeRaw("plugin.sorter.mode"))
        assertNull(p.raw("plugin.sorter.mode"))
        assertEquals("dark", p.raw("app.theme"))
        assertFalse("plugin.sorter.mode" in p.snapshot())
    }

    @Test fun removeRawWorksForTypedKeysToo() = runTest {
        val p = PreferenceStore.inMemory()
        val k = PrefKey("count", 0)
        p.set(k, 3)
        assertTrue(p.removeRaw("user.count"))
        assertEquals(0, p.get(k))
    }

    @Test fun removePrefixDeletesOnlyThatPrefix() = runTest {
        val p = PreferenceStore.inMemory()
        p.setRaw("plugin.sorter.mode", "auto")
        p.setRaw("plugin.sorter.rules", "[]")
        p.setRaw("plugin.sorterx.keep", "1")
        p.setRaw("app.theme", "dark")
        assertEquals(2, p.removePrefix("plugin.sorter."))
        assertEquals(setOf("plugin.sorterx.keep", "app.theme"), p.snapshot().keys)
        assertEquals(0, p.removePrefix("plugin.sorter."))
        assertEquals(0, p.removePrefix(""))
        assertEquals(2, p.snapshot().size)
    }
}
