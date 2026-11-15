plugins { id("axf.android.application") }

// Phone Connect: no app screens. A one-time sign-in / permissions page, then everything visible is the overlay
// (floating toolbar, draggable button, popups), themed live from the console's skin through the hub (Axf tokens).
android {
    namespace = "ai.amberx.axf.phoneconnect"
    defaultConfig {
        applicationId = "ai.amberx.axf.phoneconnect"
        targetSdk = 35
        // CI sets AXF_BUILD_NUMBER (the run number) so each build installs over the last one.
        versionCode = System.getenv("AXF_BUILD_NUMBER")?.toIntOrNull() ?: 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["axfAppId"] = "phone-connect"
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

// AmberX build rule: no project is compiled without a validated manifest (project.manifest.json, project-manifest@1).
val axfProjectDir: File = rootDir
val axfCheckProject = tasks.register<Exec>("axfCheckProject") {
    group = "verification"
    description = "Validates project.manifest.json against the AmberX project rules"
    workingDir = axfProjectDir
    commandLine("node", axfProjectDir.resolve("../../framework/cli/project.mjs").absolutePath, "validate", axfProjectDir.absolutePath)
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(axfCheckProject) }

val axf = libs.versions.axf.get()
dependencies {
    implementation("ai.amberx.axf:axf-kernel:$axf")
    implementation("ai.amberx.axf:axf-platform-android:$axf")
    implementation("ai.amberx.axf:axf-ui:$axf")
    implementation("ai.amberx.axf:axf-assets:$axf")
    implementation("ai.amberx.axf:axf-data:$axf")
    implementation("ai.amberx.axf:axf-network:$axf")
    implementation("ai.amberx.axf:lib-settings:$axf")
    implementation("ai.amberx.axf:lib-hub:$axf")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.savedstate:savedstate-ktx:1.2.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
