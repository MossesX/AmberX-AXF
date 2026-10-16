plugins { id("axf.android.library") }

description = "AmberX AXF network — OkHttp client with retries/cache/auth seam, websocket, remote config, download manager"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-platform-android"))
    api(libs.okhttp)
    implementation(libs.okhttp.logging)
}
