plugins { id("axf.android.compose.library") }

description = "AmberX AXF navigation — kernel Router contract on Navigation Compose, typed routes, deep links, results"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    api(libs.androidx.navigation.compose)
}
