plugins { id("axf.android.library") }
description = "AmberX AXF AI library — ai-modes@1 sessions that are always live on axHub: HubAiSessionClient (start/attach/send/stream/stop/close/list over the assistant behind axHub's wall, reconnect + resume from the last seq, replies as a Flow), AiService (mode registry, per-trigger mode override, UAC gating from the hub account or the local role, model choice), AI settings (mode, model, read aloud). Replaces the kernel's axf.ai.session placeholder."
dependencies {
    api(project(":axf-kernel"))
    api(project(":lib-hub"))
    implementation(project(":axf-network"))
    api(libs.okhttp)
    testImplementation(libs.junit)
}
