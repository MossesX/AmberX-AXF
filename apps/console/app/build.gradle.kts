plugins { id("axf.android.application") }

android {
    namespace = "ai.amberx.axf.console"
    defaultConfig {
        applicationId = "ai.amberx.axf.console"
        // CI sets AXF_BUILD_NUMBER (the run number) so each catalog build installs over the last one.
        versionCode = System.getenv("AXF_BUILD_NUMBER")?.toIntOrNull() ?: 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["axfAppId"] = "axf-console"
    }
}

// AmberX build rule: no project is compiled without a validated manifest (project.manifest.json, project-manifest@1).
// The framework's build engine checks it before every build (needs Node 22, like `axf`); the rules are
// framework/schemas/project-rules.json, managed in the Dev Console under Standards.
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
    implementation("ai.amberx.axf:axf-nav:$axf")
    implementation("ai.amberx.axf:axf-data:$axf")
    implementation("ai.amberx.axf:axf-network:$axf")
    implementation("ai.amberx.axf:lib-settings:$axf")
    implementation("ai.amberx.axf:lib-logging:$axf")
    implementation("ai.amberx.axf:lib-accounts:$axf")
    implementation("ai.amberx.axf:lib-profile:$axf")
    implementation("ai.amberx.axf:lib-billing:$axf")
    implementation("ai.amberx.axf:lib-admin:$axf")
    implementation("ai.amberx.axf:lib-browser:$axf")
    implementation("ai.amberx.axf:axf-devtools:$axf")
    // axf:modules ["ai.amberx.axf.settings","ai.amberx.axf.logging","ai.amberx.axf.devtools","ai.amberx.axf.accounts","ai.amberx.axf.profile","ai.amberx.axf.billing","ai.amberx.axf.admin"]
}

// The console ships the framework's catalog, tracker and boilerplates inside the APK (assets/axf/console/**).
val repoRoot = layout.projectDirectory.dir("../../..")
val copyConsoleData by tasks.registering(Copy::class) {
    group = "axf"
    description = "Copies catalog.json, status.json, tracker.json and boilerplates/** into the APK assets"
    from(repoRoot.dir("framework/catalog")) { include("*.json"); into("catalog") }  // incl. libraries.json (installable libraries + wizard params)
    from(repoRoot.file("tracker.json"))
    from(repoRoot.dir("framework/boilerplates")) { include("**/*.json"); into("boilerplates") }
    into(layout.projectDirectory.dir("src/main/assets/axf/console"))
}
tasks.named("preBuild") { dependsOn(copyConsoleData) }
