plugins { id("axf.android.library") }

description = "AmberX AXF bundled assets — ships framework/assets/** in the APK and loads them from AssetManager"

dependencies {
    api(project(":axf-kernel"))
}

// Copy the shared framework assets (the same 39 JSON files the web demo uses) into this module's APK
// assets at build time, so the Android port can never drift from the web port.
val sharedAssets = layout.projectDirectory.dir("../../assets")
// Port-specific asset types (ui-kit, …) live beside the Android port and are merged on top.
val androidAssets = layout.projectDirectory.dir("../assets")
val bundledAssets = layout.projectDirectory.dir("src/main/assets/axf/assets")

val copyAxfAssets by tasks.registering(Copy::class) {
    description = "Copies framework/assets/** into src/main/assets/axf/assets"
    group = "axf"
    from(sharedAssets) { include("**/*.json") }
    from(androidAssets) { include("**/*.json") }
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
    into(bundledAssets)
}

tasks.named("preBuild") { dependsOn(copyAxfAssets) }
