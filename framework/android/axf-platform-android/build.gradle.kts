plugins { id("axf.android.compose.library") }

// Compose is needed only for AxfActivity (setContent { AxfRoot { … } }); every platform seam is plain Kotlin.
description = "AmberX AXF platform adapters for Android — stores, logger, permissions, files, host info, Application/Activity bases"

dependencies {
    api(project(":axf-kernel"))
    api(project(":axf-ui"))
    api(project(":axf-assets"))
    implementation(libs.androidx.security.crypto)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.core.ktx)
}
