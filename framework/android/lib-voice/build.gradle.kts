plugins { id("axf.android.compose.library") }
description = "AmberX AXF voice library — speech input, spoken prompts, voice commands whose trigger phrases users can record or pick from defaults, and continuous listening (Vosk engine, dictation, sensitivity, echo cancellation, arming)"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))
    // Continuous on-device speech (VoskVoiceEngine). JNA must come in as an AAR (native libs), as in ActiveX.
    implementation(libs.vosk.android)
    implementation("net.java.dev.jna:jna:${libs.versions.jna.get()}@aar")
    testImplementation(libs.junit)
}
