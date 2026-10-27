plugins { id("axf.android.compose.library") }
description = "AmberX AXF triggers library — persistence of custom triggers + per-trigger overrides (trigger-store@1), the lib-voice → kernel TriggerMatcher bridge with a per-trigger confidence log callback, settings voice bindings written through the settings API, and the trigger screens (dense list, add-trigger flow, action picker with cross-tab search, threshold editor); built on the kernel's triggers@1"
dependencies {
    api(project(":axf-kernel"))
    api(project(":lib-voice"))
    implementation(project(":axf-ui"))
    implementation(project(":lib-settings"))
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
}
