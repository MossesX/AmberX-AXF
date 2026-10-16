plugins { id("axf.android.compose.library") }

description = "AmberX AXF devtools — kernel status, event/action log, asset inspector, build-engine client, dev-server hot reload"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    implementation(project(":axf-network"))
    implementation(project(":axf-assets"))
}
