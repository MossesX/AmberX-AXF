plugins { id("axf.android.compose.library") }
description = "AmberX AXF library browser — reusable floating tab-group browser (select → compare → undock/split/grid) that attaches to any tab group declared in an app's manifest"
dependencies { api(project(":axf-kernel")); implementation(project(":axf-ui")) }
