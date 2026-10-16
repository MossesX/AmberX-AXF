plugins { `kotlin-dsl` }

group = "ai.amberx.axf.buildlogic"

dependencies {
    compileOnly(libs.android.gradlePlugin)
    compileOnly(libs.kotlin.gradlePlugin)
    compileOnly(libs.compose.gradlePlugin)
}

gradlePlugin {
    plugins {
        register("axfKotlinLibrary") { id = "axf.kotlin.library"; implementationClass = "AxfKotlinLibraryPlugin" }
        register("axfAndroidLibrary") { id = "axf.android.library"; implementationClass = "AxfAndroidLibraryPlugin" }
        register("axfAndroidComposeLibrary") { id = "axf.android.compose.library"; implementationClass = "AxfAndroidComposeLibraryPlugin" }
        register("axfAndroidApplication") { id = "axf.android.application"; implementationClass = "AxfAndroidApplicationPlugin" }
    }
}
