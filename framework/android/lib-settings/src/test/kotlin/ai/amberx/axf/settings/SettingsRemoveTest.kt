package ai.amberx.axf.settings

import ai.amberx.axf.data.PreferenceStore
import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ExtensionRegistry
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.ServiceRegistry
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.platform.SecureStore
import ai.amberx.axf.kernel.result.AxfResult
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Test
import kotlin.reflect.KClass
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** SettingsEngine.remove / removePrefix delete saved values (prefs, secrets, Config user layer) instead of blanking them. */
class SettingsRemoveTest {
    private class MemorySecure : SecureStore {
        val map = HashMap<String, String>()
        override suspend fun get(key: String): AxfResult<String?> = AxfResult.ok(map[key])
        override suspend fun put(key: String, value: String): AxfResult<Unit> { map[key] = value; return AxfResult.ok(Unit) }
        override suspend fun remove(key: String): AxfResult<Unit> { map.remove(key); return AxfResult.ok(Unit) }
    }

    private class Ctx : ModuleContext {
        override val extensions = ExtensionRegistry()
        override val services = ServiceRegistry()
        override fun <T : Any> service(type: KClass<T>): T? = services.get(type)
    }

    private fun setup(): Triple<SettingsEngine, Ctx, MemorySecure> {
        val c = Ctx()
        val secure = MemorySecure()
        c.services.register(PreferenceStore::class, PreferenceStore.inMemory())
        c.services.register(SecureStore::class, secure)
        c.services.register(Config::class, Config())
        c.extensions.contribute(ExtensionPoints.SETTINGS, "plugin", SettingsContribution(SettingsGroup("sorter", "Sorter", "sort", "plugin", settings = listOf(
            SettingSpec("plugin.sorter.mode", "Mode", SettingKind.TEXT),
            SettingSpec("plugin.sorter.token", "Token", SettingKind.SECRET),
        ))))
        val e = SettingsEngine()
        e.bind(c)
        return Triple(e, c, secure)
    }

    @Test fun removeDeletesOneValue() = runTest {
        val (e, c, _) = setup()
        e.set("plugin.sorter.mode", JsonPrimitive("auto"))
        e.remove("plugin.sorter.mode")
        assertNull(c.services.get(PreferenceStore::class)!!.raw("plugin.sorter.mode"))
        assertNull(c.services.get(Config::class)!!.get("plugin.sorter.mode"))
        assertFalse("plugin.sorter.mode" in e.values.value)
    }

    @Test fun removePrefixDeletesEverythingUnderIt() = runTest {
        val (e, c, secure) = setup()
        val prefs = c.services.get(PreferenceStore::class)!!
        e.set("plugin.sorter.mode", JsonPrimitive("auto"))
        e.set("plugin.sorter.token", JsonPrimitive("s3cret"))
        prefs.setRaw("plugin.sorter.orphan", "x")   // saved by an older version, no spec any more
        e.set("app.theme", JsonPrimitive("dark"))
        assertEquals(2, e.removePrefix("plugin.sorter."))
        assertEquals(setOf("app.theme"), prefs.snapshot().keys)
        assertTrue(secure.map.isEmpty())
        assertNull(c.services.get(Config::class)!!.get("plugin.sorter.mode"))
        assertEquals("dark", c.services.get(Config::class)!!.string("app.theme"))
        assertEquals(setOf("app.theme"), e.values.value.keys)
        assertEquals(0, e.removePrefix(""))
    }
}
