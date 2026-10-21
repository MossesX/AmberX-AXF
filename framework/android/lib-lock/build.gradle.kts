plugins { id("axf.android.compose.library") }
description = "AmberX AXF app lock — second-step unlock by fingerprint/face (BiometricPrompt) or a PIN (PBKDF2, Keystore-backed secure store), lockout after failed tries, auto-lock gate, lock-mode guard, hashed secrets (PIN, spoken passphrase)"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    // the lock-mode guard watches Settings → App lock (SettingsEngine.onChange)
    implementation(project(":lib-settings"))
    api(libs.androidx.biometric)
    api(libs.androidx.fragment)
    testImplementation(libs.junit)
}
