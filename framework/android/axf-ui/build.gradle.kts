plugins { id("axf.android.compose.library") }

description = "AmberX AXF Compose UI — tokens → theme, shell, components, overlays, studio views"

dependencies {
    api(project(":axf-kernel"))
    api(platform(libs.compose.bom))
    api(libs.compose.ui)
    api(libs.compose.foundation)
    api(libs.compose.material3)
    implementation(libs.androidx.activity.compose)
}
