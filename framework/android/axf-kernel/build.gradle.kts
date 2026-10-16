plugins { id("axf.kotlin.library") }

// The kernel is pure Kotlin: no Android imports, ever. Every platform need is an interface in
// ai.amberx.axf.kernel.platform, filled in by axf-platform-android (or a future desktop/iOS/JS port).
description = "AmberX AXF kernel — asset envelope, registry, validator, engines, runtime, module system"

sourceSets {
    main {
        // asset-types.json and the Android extension spec are read from the shared framework/schemas folder
        // at build time so the Kotlin validator and the Node build engine can never disagree.
        resources.srcDir(layout.projectDirectory.dir("../../schemas"))
    }
}

tasks.named<ProcessResources>("processResources") {
    // framework/defaults.json lives one level above schemas/; ship it alongside so the kernel knows the house defaults.
    from(layout.projectDirectory.file("../../defaults.json"))
    duplicatesStrategy = DuplicatesStrategy.INCLUDE
}
