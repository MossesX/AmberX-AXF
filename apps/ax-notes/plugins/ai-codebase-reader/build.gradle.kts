// AX Notes plugin "ai-codebase-reader" (plugin@1: plugin.json). A Gradle module of the ax-notes build, wired by
// install.mjs and removed without a trace by uninstall.mjs. Codes only against kernel contracts (ai-modes@1, triggers@1)
// and the app's JSON host actions (axnotes.notes.save / axnotes.notes.saved / axnotes.todos.sync); the app keeps
// working without it.
plugins { id("axf.android.library") }

group = "ai.amberx.axf.axnotes.plugins"
description = "AX Notes plugin ai-codebase-reader: read-only repos via axHub → notes with code links, TODO/FIXME harvest, voice on code"

android { namespace = "ai.amberx.axf.axnotes.plugins.codebase" }

val axf = libs.versions.axf.get()
dependencies {
    implementation("ai.amberx.axf:axf-kernel:$axf")
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
