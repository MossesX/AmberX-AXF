package ai.amberx.axf.kernel

import ai.amberx.axf.kernel.config.Config
import ai.amberx.axf.kernel.config.ConfigLayer
import org.junit.Test
import kotlin.test.assertEquals

/** Config.remove / removePrefix drop keys from one layer; lower layers show through. */
class ConfigRemoveTest {
    @Test fun removeAndRemovePrefix() {
        val c = Config()
        c.set("p.a", "default", ConfigLayer.DEFAULTS)
        c.set("p.a", "user"); c.set("p.b", "user"); c.set("q.a", "user")
        c.remove("p.a")
        assertEquals("default", c.string("p.a"))
        assertEquals(0, c.removePrefix(""))
        assertEquals(1, c.removePrefix("p."))
        assertEquals(null, c.get("p.b"))
        assertEquals("user", c.string("q.a"))
        assertEquals("default", c.string("p.a"))
    }
}
