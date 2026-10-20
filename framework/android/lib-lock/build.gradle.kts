plugins { id("axf.android.compose.library") }
description = "AmberX AXF app lock — second-step unlock by fingerprint/face (BiometricPrompt) or a PIN (PBKDF2, Keystore-backed secure store), lockout after failed tries, auto-lock timing"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    api(libs.androidx.biometric)
    api(libs.androidx.fragment)
    testImplementation(libs.junit)
}
