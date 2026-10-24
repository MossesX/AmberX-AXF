plugins { id("axf.android.library") }
description = "AmberX AXF read aloud — text to speech for any text: cleanup (links, emoji, markdown, abbreviations, your own pronunciations), sentence/clause/paragraph chunking with pauses, a queue with history and repeat, foreground playback with notification controls, audio focus and wide-range settings any plugin can reuse"
dependencies {
    api(project(":axf-kernel"))
    testImplementation(libs.junit)
}
