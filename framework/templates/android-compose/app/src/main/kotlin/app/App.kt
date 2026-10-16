package {{APPLICATION_ID}}

import ai.amberx.axf.kernel.module.AxfModule
import ai.amberx.axf.platform.AxfApplication

/**
 * {{APP_NAME}} — builds the kernel from app/src/main/assets/axf (manifest + assets) and the modules below.
 * Framework modules (settings, logging, devtools) are added by AxfApplication; list the app's own here.
 */
class App : AxfApplication() {
    override fun appModules(): List<AxfModule> = listOf(AppModule())
}
