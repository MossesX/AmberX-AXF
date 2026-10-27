// AX Notes plugin "note-sorter" (plugin@1: plugin.json). A Gradle module of the ax-notes build, wired by install.mjs and
// removed without a trace by uninstall.mjs. Codes only against kernel contracts (ai-modes@1, triggers@1) and the app's
// JSON host actions (axnotes.notes.save / axnotes.notes.saved / axnotes.todos.add); the app keeps working without it.
plugins { id("axf.android.library") }

group = "ai.amberx.axf.axnotes.plugins"
description = "AX Notes plugin note-sorter: AI sorting (category, tags, title, summary, action items → to-dos), learning, digests"

android { namespace = "ai.amberx.axf.axnotes.plugins.notesorter" }

val axf = libs.versions.axf.get()
dependencies {
    implementation("ai.amberx.axf:axf-kernel:$axf")
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
