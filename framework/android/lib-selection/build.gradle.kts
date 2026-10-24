plugins { id("axf.android.library") }
description = "AmberX AXF text selection — add your own entries to Android's text selection menu in every app (ACTION_PROCESS_TEXT): a base activity, menu entries switched on/off at run time, and pure text rules"
dependencies {
    api(project(":axf-kernel"))
    testImplementation(libs.junit)
}
