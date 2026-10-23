plugins { id("axf.android.library") }
description = "AmberX AXF notifications — channels, POST_NOTIFICATIONS / full-screen checks, the ongoing \"watching\" notification, high-priority alerts whose lock-screen version is only a private public text, notices, post/cancel by tag, and the hook for alert@1 deliveries; fills the platform's android.notifications placeholder"
dependencies {
    api(project(":axf-kernel"))
    testImplementation(libs.junit)
}
