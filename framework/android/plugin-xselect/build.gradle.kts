plugins { id("axf.android.compose.library") }
description = "X Select (AmberX AXF plugin) — Read aloud next to Select all in every app's text selection menu, with a settings-only screen (toolbar, banner, axHub status badge) and 80+ read-aloud settings. Built on lib-readaloud + lib-selection."
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    implementation(project(":axf-platform-android"))
    implementation(project(":lib-settings"))
    implementation(project(":lib-hub"))
    api(project(":lib-readaloud"))
    api(project(":lib-selection"))
    testImplementation(libs.junit)
}
