plugins { id("axf.android.compose.library") }
description = "AmberX AXF voice library — speech input, spoken prompts, and voice commands whose trigger phrases users can record or pick from defaults"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    testImplementation(libs.junit)
}
