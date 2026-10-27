// AX Notes plugin "ai-automations" (plugin@1: plugin.json). A Gradle module of the ax-notes build, wired by install.mjs and
// removed without a trace by uninstall.mjs. Codes only against kernel contracts (ai-modes@1, speech@1, triggers@1, work@1)
// and axf-ui components; the app keeps working without it.
plugins { id("axf.android.compose.library") }

group = "ai.amberx.axf.axnotes.plugins"
description = "AX Notes plugin ai-automations: toggleable automation rules (voice, schedule, git push, #build/#ask notes, finished builds)"

android { namespace = "ai.amberx.axf.axnotes.plugins.automations" }

val axf = libs.versions.axf.get()
dependencies {
    implementation("ai.amberx.axf:axf-kernel:$axf")
    implementation("ai.amberx.axf:axf-ui:$axf")
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
}
