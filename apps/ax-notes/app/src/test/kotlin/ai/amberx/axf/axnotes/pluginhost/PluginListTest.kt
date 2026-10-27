package ai.amberx.axf.axnotes.pluginhost

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PluginListTest {
    @Test fun parsesInstalledPlugins() {
        val text = """{"${'$'}axf":"axnotes-plugins@1","plugins":[
            {"id":"ai.amberx.axf.axnotes.example","folder":"example","entry":"ai.amberx.axf.axnotes.plugins.example.ExamplePlugin","dataPrefix":"example."},
            {"id":"ai.amberx.axf.axnotes.example","folder":"dup","entry":"ai.amberx.axf.axnotes.plugins.x.X"},
            {"id":"evil.plugin","folder":"evil","entry":"java.lang.Runtime"},
            {"id":"a.b","folder":"../up","entry":"ai.amberx.axf.axnotes.plugins.x.X"},
            {"id":"a.c","folder":"other","entry":"ai.amberx.axf.axnotes.plugins.x.Y","dataPrefix":""},
            {"id":"a.d","folder":"ok"}
        ]}"""
        val list = PluginList.parse(text)
        assertEquals(listOf("example", "other"), list.map { it.folder })
        assertEquals("other.", list[1].dataPrefix) // a prefix can't be blank or another plugin's
        assertTrue(PluginList.parse("{\"${'$'}axf\":\"other@1\",\"plugins\":[]}").isEmpty())
        assertTrue(PluginList.parse("not json").isEmpty())
    }

    @Test fun removedPluginsLeaveNoKeys() {
        val now = listOf(PluginEntry("x.a", "a", "ai.amberx.axf.axnotes.plugins.a.A", "a."))
        val before = PluginList.decodeFolders(PluginList.encodeFolders(now + PluginEntry("x.b", "b", "ai.amberx.axf.axnotes.plugins.b.B", "b.")))
        assertEquals(listOf("a", "b"), before)
        assertEquals(listOf("b"), PluginList.removed(before, now))
        assertEquals(listOf("b.x", "b.rec.1"), PluginList.keysOf("b", listOf("a.x", "b.x", "bb.y", "b.rec.1", "axnotes.hub")))
        assertTrue(PluginList.decodeFolders("garbage").isEmpty())
    }
}
