plugins { id("axf.android.library") }
description = "AmberX AXF work — the host for work@1 poll jobs: a foreground service (specialUse) that runs registered jobs through the kernel's WorkEngine state machine, STOP / CHECK_NOW commands, a boot + update restart receiver, running-state flows, and the ongoing notification through lib-notifications; fills the platform's android.work placeholder"
dependencies {
    api(project(":axf-kernel"))
    api(project(":lib-notifications"))
    testImplementation(libs.junit)
}
