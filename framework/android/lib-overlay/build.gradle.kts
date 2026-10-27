plugins { id("axf.android.compose.library") }
description = "AmberX AXF overlay library — the overlay@1 asset drawn over other apps: a foreground service owning a TYPE_APPLICATION_OVERLAY window with a draggable, resizable Compose pill (status chips + quick action), a tappable log panel, a collapsed strip while hidden and a mini-screen host any app fills"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    implementation(project(":lib-notifications"))
    // ComposeView inside a WindowManager window: the window owns its lifecycle + saved-state registry (OverlayWindows.kt)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.savedstate.ktx)
    testImplementation(libs.junit)
}
