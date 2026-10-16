plugins { id("axf.android.compose.library") }
description = "AmberX AXF accounts library — user account interface contracts, mock provider (placeholder module)"
dependencies { api(project(":axf-kernel")); implementation(project(":axf-ui")) }
