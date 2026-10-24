// AmberX AXF — Android port. Included as a composite build by apps (`includeBuild("../../framework/android")`)
// or opened directly in Android Studio.
pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "amberx-axf-android"

// Kernel + platform
include(":axf-kernel")
include(":axf-platform-android")
include(":axf-ui")
include(":axf-assets")
include(":axf-nav")
include(":axf-data")
include(":axf-network")
// Libraries (lib-* = feature libraries; some are placeholder modules carrying contracts + stubs only)
include(":lib-settings")
include(":lib-logging")
include(":lib-admin")
include(":lib-accounts")
include(":lib-profile")
include(":lib-billing")
include(":lib-browser")
include(":lib-voice")
include(":lib-lock")
include(":lib-mcp")
include(":lib-hub")
include(":lib-notifications")
include(":lib-work")
include(":lib-selection")
include(":lib-readaloud")
// Plugins (plugin@1 module plugins: compiled Kotlin modules an app adds to its module list)
include(":plugin-xselect")
// Tooling
include(":axf-devtools")
include(":axf-testing")
