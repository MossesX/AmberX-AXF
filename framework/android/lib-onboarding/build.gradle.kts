plugins { id("axf.android.compose.library") }
description = "AmberX AXF onboarding — reusable first-run permissions flow (welcome/why → live checklist → hand-offs) for microphone, camera, overlay, accessibility service, notifications and battery exemption; recovery banner + screen when a required permission is revoked or a service is stopped; \"done\" persisted per app in the KV store"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    // rememberLauncherForActivityResult + BackHandler
    implementation(libs.androidx.activity.compose)
    testImplementation(libs.junit)
}
