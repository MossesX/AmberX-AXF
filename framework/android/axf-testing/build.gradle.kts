plugins { id("axf.android.compose.library") }

description = "AmberX AXF testing — fake platform, test kernel builder, Compose test rule"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    api(libs.kotlin.test)
    api(libs.kotlinx.coroutines.test)
    api(libs.junit)
    api(libs.compose.ui.test.junit4)
}
