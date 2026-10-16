plugins { id("axf.android.compose.library") }
description = "AmberX AXF profile library — user profile interface contracts + local profile store (placeholder module)"
dependencies { api(project(":axf-kernel")); implementation(project(":axf-ui")) }
