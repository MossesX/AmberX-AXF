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

// lib-voice's Vosk engine needs a speech model in assets (≈40 MB, never committed: .gitignore has it). Fetched once
// before the first build, as lib-voice's README describes; without it voice input is off and the typed box still works.
val voskModelDir = layout.projectDirectory.dir("src/main/assets/model-en-us")
val fetchVoskModel by tasks.registering {
    group = "axf"
    description = "Downloads the small English Vosk model into src/main/assets/model-en-us (once)"
    val dir = voskModelDir.asFile
    outputs.dir(dir)
    onlyIf { !File(dir, "uuid").exists() && System.getenv("AXF_SKIP_VOSK_MODEL") == null }
    doLast {
        val name = "vosk-model-small-en-us-0.15"
        val zip = File(temporaryDir, "$name.zip")
        java.net.URL("https://alphacephei.com/vosk/models/$name.zip").openStream().use { i -> zip.outputStream().use { o -> i.copyTo(o) } }
        dir.deleteRecursively(); dir.mkdirs()
        java.util.zip.ZipInputStream(zip.inputStream()).use { zin ->
            generateSequence { zin.nextEntry }.forEach { e ->
                val rel = e.name.removePrefix("$name/")
                if (rel.isBlank()) return@forEach
                val out = File(dir, rel)
                if (e.isDirectory) out.mkdirs() else { out.parentFile.mkdirs(); out.outputStream().use { zin.copyTo(it) } }
            }
        }
        File(dir, "uuid").writeText(java.util.UUID.randomUUID().toString())
    }
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn(fetchVoskModel) }

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
    // Libraries behind the app-local seams (build ax-notes s13; `axf install <lib>` added these lines).
    // axf:modules ["ai.amberx.axf.data","ai.amberx.axf.settings","ai.amberx.axf.notifications","ai.amberx.axf.voice","ai.amberx.axf.speech","ai.amberx.axf.triggers","ai.amberx.axf.ai","ai.amberx.axf.onboarding","ai.amberx.axf.overlay"]
    implementation("ai.amberx.axf:lib-notifications:$axf")
    implementation("ai.amberx.axf:lib-voice:$axf")
    implementation("ai.amberx.axf:lib-speech:$axf")
    implementation("ai.amberx.axf:lib-triggers:$axf")
    implementation("ai.amberx.axf:lib-ai:$axf")
    implementation("ai.amberx.axf:lib-onboarding:$axf")
    implementation("ai.amberx.axf:lib-overlay:$axf")
    // Plugins (apps/ax-notes/plugins/<folder>) add `implementation(project(":plugins:<folder>"))` lines below with their
    // install.mjs (marker `axf-plugin:<folder>`) and list themselves in assets/axnotes/plugins.json. Keep this block last.
    implementation(project(":plugins:ai-chat")) // axf-plugin:ai-chat
    implementation(project(":plugins:ai-build-bridge")) // axf-plugin:ai-build-bridge
    implementation(project(":plugins:ai-automations")) // axf-plugin:ai-automations
}
