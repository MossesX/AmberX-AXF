import com.android.build.api.dsl.CommonExtension
import org.gradle.api.JavaVersion
import org.gradle.api.Project
import org.gradle.api.artifacts.VersionCatalog
import org.gradle.api.artifacts.VersionCatalogsExtension
import org.gradle.kotlin.dsl.getByType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.dsl.KotlinJvmCompilerOptions
import org.jetbrains.kotlin.gradle.dsl.KotlinProjectExtension

/** Shared helpers for the AmberX AXF convention plugins. */
internal val Project.libs: VersionCatalog
    get() = extensions.getByType<VersionCatalogsExtension>().named("libs")

internal fun Project.configureAndroid(ext: CommonExtension<*, *, *, *, *, *>) {
    ext.apply {
        compileSdk = libs.findVersion("compileSdk").get().toString().toInt()
        defaultConfig.minSdk = libs.findVersion("minSdk").get().toString().toInt()
        compileOptions {
            sourceCompatibility = JavaVersion.VERSION_17
            targetCompatibility = JavaVersion.VERSION_17
        }
        // Every module contributes its own manifest pieces (permissions, services, intent filters); the app merges them.
        buildFeatures.buildConfig = false
    }
}

internal fun Project.configureKotlin() {
    extensions.configure(KotlinProjectExtension::class.java) {
        // Explicit API mode: every public symbol of the framework is a deliberate contract.
        // App code and an app's own plugin modules (`:plugins:<id>`, apps/<app>/plugins) are not framework contracts.
        if (!path.startsWith(":app") && !path.startsWith(":plugins:") && !path.endsWith("-testing")) explicitApi()
    }
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile::class.java).configureEach {
        compilerOptions.configureCommon()
    }
}

internal fun KotlinJvmCompilerOptions.configureCommon() {
    jvmTarget.set(JvmTarget.JVM_17)
    freeCompilerArgs.addAll(
        "-opt-in=kotlin.RequiresOptIn",
        "-opt-in=ai.amberx.axf.kernel.AxfInternal",
        "-Xcontext-receivers",
    )
}
