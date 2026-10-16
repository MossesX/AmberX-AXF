plugins { id("axf.android.compose.library") }

description = "AmberX AXF logging library — levels/tags/fields, ring buffer, logcat + file sinks, crash capture, log viewer, diagnostics"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    implementation(project(":axf-platform-android"))
}
