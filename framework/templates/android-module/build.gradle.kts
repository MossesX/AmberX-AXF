plugins { id("{{PLUGIN}}") }

description = "{{LABEL}} — AmberX AXF library module"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-platform-android"))
    implementation(project(":axf-ui"))
}
