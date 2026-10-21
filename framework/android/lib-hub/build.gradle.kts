plugins { id("axf.android.compose.library") }
description = "AmberX AXF hub library — connects a developer app to axHub: appearance + settings documents from the hub's data server (appearance@1 over the data API, live change feed, backoff), hub credentials seam (session cookie or token, held by the app, never stored here), waiting screen while the hub is unreachable"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-network"))
    implementation(project(":axf-ui"))
    api(libs.okhttp)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
