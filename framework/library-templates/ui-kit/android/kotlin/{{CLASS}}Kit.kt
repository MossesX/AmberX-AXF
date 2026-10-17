package {{PACKAGE}}

import ai.amberx.axf.kernel.contract.ComponentKind
import ai.amberx.axf.kernel.contract.UiKitSpec
import ai.amberx.axf.ui.kit.AxfComponents
import ai.amberx.axf.ui.kit.AxfUiKit
import ai.amberx.axf.ui.kit.DefaultComponents

/**
 * {{LABEL}} — a UI kit. Override the components it renders in the object below; every kind it does not cover
 * falls back to the default AmberX kit (noted on the output terminal). Select it with a ui-kit asset whose kit = "{{SLUG}}".
 */
public object {{CLASS}}Kit : AxfUiKit {
    override val spec: UiKitSpec = UiKitSpec("{{SLUG}}", "{{LABEL}}", "{{P_LIBRARY}}", covers = setOf(ComponentKind.BUTTON, ComponentKind.CHIP))
    override val components: AxfComponents = object : DefaultComponents() {
        // @Composable override fun Button(…) { … }  — render with {{P_LIBRARY}} here
    }
}
