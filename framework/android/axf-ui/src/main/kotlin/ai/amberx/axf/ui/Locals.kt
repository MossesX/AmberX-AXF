package ai.amberx.axf.ui

import ai.amberx.axf.kernel.AxfKernel
import ai.amberx.axf.kernel.contract.MapStrings
import ai.amberx.axf.kernel.contract.Strings
import ai.amberx.axf.kernel.engine.CompiledLayout
import ai.amberx.axf.kernel.engine.ComponentStyles
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.kernel.runtime.AxfRuntime
import ai.amberx.axf.kernel.runtime.AxfState
import ai.amberx.axf.kernel.runtime.Compiled
import ai.amberx.axf.kernel.runtime.DialogState
import ai.amberx.axf.kernel.runtime.ToastKind
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.Stable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.staticCompositionLocalOf

/* Composition locals every AXF composable reads. All are provided by [AxfRoot]. */

public val LocalAxfKernel: ProvidableCompositionLocal<AxfKernel?> = staticCompositionLocalOf { null }
public val LocalAxfRuntime: ProvidableCompositionLocal<AxfRuntime> = staticCompositionLocalOf { error("No AxfRuntime — wrap the tree in AxfRoot") }
/** The latest [AxfState] (recomposes on every runtime change). */
public val LocalAxfState: ProvidableCompositionLocal<AxfState> = compositionLocalOf { error("No AxfState — wrap the tree in AxfRoot") }
/** The latest compiled bundle (recomposes on hot-swap). */
public val LocalAxfCompiled: ProvidableCompositionLocal<Compiled> = compositionLocalOf { error("No Compiled — wrap the tree in AxfRoot") }
public val LocalAxfStyles: ProvidableCompositionLocal<ComponentStyles> = compositionLocalOf { error("No ComponentStyles — wrap the tree in AxfRoot") }
/** The compiled layout for the current window class. */
public val LocalAxfLayout: ProvidableCompositionLocal<CompiledLayout> = compositionLocalOf { error("No CompiledLayout — wrap the tree in AxfRoot") }
public val LocalAxfUac: ProvidableCompositionLocal<AxfUac> = compositionLocalOf { AxfUac.ALLOW_ALL }
public val LocalAxfActions: ProvidableCompositionLocal<AxfActions> = staticCompositionLocalOf { AxfActions.NONE }
public val LocalAxfStrings: ProvidableCompositionLocal<Strings> = staticCompositionLocalOf { MapStrings(emptyMap()) }

/** UAC view for composables: `can()` for logic, `gate()` for rendering (HIDE → emit nothing, DISABLE → grey + lock icon). */
@Immutable
public class AxfUac(public val role: String, private val canFn: (String?) -> Boolean, private val gateFn: (String?) -> Gate) {
    public fun can(permission: String?): Boolean = canFn(permission)
    public fun gate(requires: String?): Gate = gateFn(requires)
    public companion object {
        public val ALLOW_ALL: AxfUac = AxfUac("admin", { true }, { Gate.ALLOW })
        public fun of(runtime: AxfRuntime, state: AxfState): AxfUac = AxfUac(state.role, runtime::can, runtime::gate)
    }
}

/** Action dispatch helper bound to the runtime. `clipboard` is passed as an extra so `asset.copy` works. */
@Stable
public class AxfActions(private val dispatchFn: (String, String?, Map<String, Any?>) -> AxfResult<Unit>, private val toastFn: (String, ToastKind, String?) -> Unit, private val clipboard: ((String) -> Unit)?) {
    public fun dispatch(spec: String, payload: String? = null, extras: Map<String, Any?> = emptyMap()): AxfResult<Unit> =
        dispatchFn(spec, payload, if (clipboard != null && "clipboard" !in extras) extras + ("clipboard" to clipboard) else extras)
    public operator fun invoke(spec: String, payload: String? = null): AxfResult<Unit> = dispatch(spec, payload)
    public fun toast(message: String, kind: ToastKind = ToastKind.INFO, title: String? = null): Unit = toastFn(message, kind, title)
    public fun copy(text: String): Boolean { val c = clipboard ?: return false; c(text); return true }
    public companion object {
        public val NONE: AxfActions = AxfActions({ _, _, _ -> AxfResult.ok(Unit) }, { _, _, _ -> }, null)
    }
}

/** A dialog an app or library registers through `ExtensionPoints.DIALOGS`. `content` receives the open [DialogState]. */
public data class DialogContribution(
    val id: String,
    val title: String,
    val icon: String? = null,
    val content: @Composable (DialogState) -> Unit,
)

/** A composable a module injects into a shell region through `ExtensionPoints.SHELL_REGIONS`. */
public data class ShellRegionContribution(
    val region: ai.amberx.axf.kernel.engine.Region,
    val id: String,
    val content: @Composable () -> Unit,
)

/** A devtools panel contributed through `ExtensionPoints.DEVTOOLS_PANELS`. */
public data class DevtoolsPanelContribution(val id: String, val label: String, val icon: String = "bug", val content: @Composable () -> Unit)
