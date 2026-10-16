plugins { id("axf.android.compose.library") }
description = "AmberX AXF billing library — subscription interface contracts, entitlements → UAC, mock provider (placeholder module)"
dependencies { api(project(":axf-kernel")); implementation(project(":axf-ui")) }
