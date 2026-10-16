import com.android.build.api.dsl.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies

/** Android library module without Compose (platform adapters, data, network). */
class AxfAndroidLibraryPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        pluginManager.apply("com.android.library")
        pluginManager.apply("org.jetbrains.kotlin.android")
        pluginManager.apply("org.jetbrains.kotlin.plugin.serialization")
        pluginManager.apply("maven-publish")
        extensions.configure<LibraryExtension> {
            configureAndroid(this)
            namespace = "ai.amberx.axf." + project.name.removePrefix("axf-").removePrefix("lib-").replace('-', '.')
            publishing { singleVariant("release") { withSourcesJar() } }
        }
        configureKotlin()
        dependencies {
            add("implementation", libs.findLibrary("kotlinx-coroutines-android").get())
            add("implementation", libs.findLibrary("kotlinx-serialization-json").get())
            add("implementation", libs.findLibrary("androidx-core-ktx").get())
            add("testImplementation", libs.findLibrary("kotlin-test").get())
            add("testImplementation", libs.findLibrary("kotlinx-coroutines-test").get())
        }
        AxfPublishing.configure(this)
    }
}
