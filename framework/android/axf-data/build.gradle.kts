plugins { id("axf.android.library") }

description = "AmberX AXF data — DataStore preferences, JSON document store, offline-first repository base, DB registry, query persistence"

dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-platform-android"))
    api(libs.androidx.datastore.preferences)
    api(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
}
