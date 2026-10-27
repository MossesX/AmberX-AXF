plugins { id("axf.android.application") }

android {
    namespace = "ai.amberx.axf.demotriggers"
    defaultConfig {
        applicationId = "ai.amberx.axf.demotriggers"
        // CI sets AXF_BUILD_NUMBER (the run number) so each catalog build installs over the last one.
        versionCode = System.getenv("AXF_BUILD_NUMBER")?.toIntOrNull() ?: 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Deep-link scheme used by axf-nav: axf://demo-triggers/<route>
        manifestPlaceholders["axfAppId"] = "demo-triggers"
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
    // axf:modules ["ai.amberx.axf.triggers"]
    implementation("ai.amberx.axf:lib-triggers:$axf")
    implementation("ai.amberx.axf:lib-speech:$axf")
    implementation("ai.amberx.axf:lib-voice:$axf")
}

// lib-voice's Vosk engine needs a model in src/main/assets/model-en-us (with a `uuid` file). It is ~40 MB, so it is never
// committed (.gitignore): this task (lib-voice README → "Shipping the Vosk model") fetches it once before the first build.
val voskModelDir = layout.projectDirectory.dir("src/main/assets/model-en-us")
val fetchVoskModel by tasks.registering {
    val dir = voskModelDir.asFile
    outputs.dir(dir)
    onlyIf { !File(dir, "uuid").exists() }
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
