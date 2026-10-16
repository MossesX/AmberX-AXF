plugins { id("axf.android.compose.library") }

description = "AmberX AXF settings library — settings schema registry, DataStore-backed values, generated settings UI (every asset slot included)"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    implementation(project(":axf-data"))
}
