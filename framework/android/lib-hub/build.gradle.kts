plugins { id("axf.android.compose.library") }
description = "AmberX AXF hub library — connects an app to axHub: hub address rules, the approvals feed (axHub decision #85) read with the app's own hub session, sign-out on the hub, watch prefs + seen ids, HubState flows, a web view locked to one origin, hub APK downloads; hub credentials seam (session cookie or token, held by the app, never stored here). The hub protocol (AXPP) is a placeholder (parked for Fable)."
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-network"))
    implementation(project(":axf-ui"))
    implementation(libs.androidx.activity.compose)
    api(libs.okhttp)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
