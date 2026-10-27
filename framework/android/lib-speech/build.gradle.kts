plugins { id("axf.android.library") }
description = "AmberX AXF speech library (speech@1, the speaking side) — Android TextToSpeech provider registered as axf.speech, a SpeechPlayer that runs the kernel SpeechQueue (enqueue, pause, resume, skip, faster, slower, repeat, stop), audio focus + ducking, a Speech settings group and voice triggers as data"
dependencies {
    api(project(":axf-kernel"))
    testImplementation(libs.junit)
}
