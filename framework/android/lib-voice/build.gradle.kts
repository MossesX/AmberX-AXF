plugins { id("axf.android.compose.library") }
description = "AmberX AXF voice library — speech input, spoken prompts, voice commands whose trigger phrases users can record or pick from defaults, and continuous listening (Vosk engine, dictation, sensitivity, echo cancellation, arming)"
dependencies {
    api(project(":axf-kernel"))
    // Spoken prompts run on lib-speech's Android TextToSpeech provider (speech@1); Speaker keeps its API.
    api(project(":lib-speech"))
    implementation(project(":axf-ui"))
    // Continuous on-device speech (VoskVoiceEngine). JNA must come in as an AAR (native libs), as in ActiveX.
    implementation(libs.vosk.android)
    implementation("net.java.dev.jna:jna:${libs.versions.jna.get()}@aar")
    testImplementation(libs.junit)
}
