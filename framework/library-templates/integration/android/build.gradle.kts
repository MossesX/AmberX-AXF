plugins { id("axf.android.compose.library") }
description = "{{LABEL}} — AXF library ({{TEMPLATE}} template)"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    implementation(project(":axf-network"))
}
