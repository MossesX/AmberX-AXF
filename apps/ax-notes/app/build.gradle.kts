plugins { id("axf.android.application") }

android {
    namespace = "ai.amberx.axf.axnotes"
    defaultConfig {
        applicationId = "ai.amberx.axf.axnotes"
        // CI sets AXF_BUILD_NUMBER (the run number) so each catalog build installs over the last one.
        versionCode = System.getenv("AXF_BUILD_NUMBER")?.toIntOrNull() ?: 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Deep-link scheme used by axf-nav: axf://ax-notes/<route>
        manifestPlaceholders["axfAppId"] = "ax-notes"
    }
}

// AX Notes plugins (axnotes-plugins@1): every plugin listed in src/main/assets/axnotes/plugins.json is compiled in from
// ../plugins/<folder>/ (src/main/kotlin, assets, src/test/kotlin). Only install.mjs / uninstall.mjs edit that list, so
// removing a plugin removes its code from the build; with the list empty the app builds exactly as without plugins.
val axnotesPlugins: List<String> = run {
    val list = file("src/main/assets/axnotes/plugins.json")
    if (!list.exists()) emptyList()
    else Regex("\"folder\"\\s*:\\s*\"([a-z0-9][a-z0-9-]{0,63})\"").findAll(list.readText()).map { it.groupValues[1] }
        .filter { file("../plugins/$it/plugin.json").exists() }.distinct().toList()
}
android {
    sourceSets {
        getByName("main") { for (p in axnotesPlugins) { java.srcDir("../plugins/$p/src/main/kotlin"); assets.srcDir("../plugins/$p/assets") } }
        getByName("test") { for (p in axnotesPlugins) java.srcDir("../plugins/$p/src/test/kotlin") }
    }
}

// Every AXF app gets the framework; libraries are added per app (the Dev Console's library picker edits this list).
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
    implementation("ai.amberx.axf:lib-hub:$axf")
    implementation("ai.amberx.axf:lib-logging:$axf")
    implementation("ai.amberx.axf:axf-devtools:$axf")
    // Records are JSON (kotlinx JsonElement, no serialization plugin); pure model logic is unit-tested on the JVM.
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit)
    // TODO(lib-voice / lib-speech / lib-triggers / lib-ai / lib-overlay, build ax-notes s4–s10): added when the parent
    // session wires the app-local interfaces in capture/Interfaces.kt to those libraries.
    // axf:modules [\"ai.amberx.axf.data\",\"ai.amberx.axf.settings\"]
}
