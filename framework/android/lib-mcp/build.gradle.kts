plugins { id("axf.android.compose.library") }
description = "AmberX AXF MCP client library — connect any AXF app to MCP servers over Streamable HTTP (OkHttp via axf-network); server registry with tokens in the secure store; browse tools/resources/prompts and call tools under the interop exposure rules; Compose screens"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-network"))
    implementation(project(":axf-ui"))
    api(libs.okhttp)
    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
}
