plugins { id("axf.android.compose.library") }
description = "AmberX AXF admin library — administration interface: roles/policies, flags, remote config, module toggles, audit trail (placeholder module)"
dependencies { api(project(":axf-kernel")); implementation(project(":axf-ui")) }
