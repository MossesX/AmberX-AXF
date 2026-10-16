plugins { id("axf.android.application") }

android {
    namespace = "{{APPLICATION_ID}}"
    defaultConfig {
        applicationId = "{{APPLICATION_ID}}"
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Deep-link scheme used by axf-nav: axf://{{APP_ID}}/<route>
        manifestPlaceholders["axfAppId"] = "{{APP_ID}}"
    }
}

// Every AXF app gets the framework; libraries are added per app (the Dev Console's library picker edits this list).
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
    implementation("ai.amberx.axf:axf-devtools:$axf")
    // axf:modules {{AXF_MODULES}}
}
