package ai.amberx.axf.ui.studio

import ai.amberx.axf.kernel.asset.AssetEnvelope
import ai.amberx.axf.kernel.asset.AssetTypes
import ai.amberx.axf.kernel.asset.ColorTokens
import ai.amberx.axf.kernel.engine.Gate
import ai.amberx.axf.kernel.engine.WindowClass
import ai.amberx.axf.kernel.runtime.ToastKind
import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.LocalAxfCompiled
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.LocalAxfState
import ai.amberx.axf.ui.LocalAxfUac
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfSlider
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/* ---------------- Role panel (web AccountView) ---------------- */

@Composable
public fun RolePanel(modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val compiled = LocalAxfCompiled.current
    val actions = LocalAxfActions.current
    val uac = LocalAxfUac.current
    val policy = compiled.policy
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Account control", eyebrow = "policy: ${state.active[AssetTypes.UAC_POLICY]} · gating: ${policy.gating.name.lowercase()}", description = "Roles resolve permissions with inheritance and wildcards. Locked items are hidden or disabled depending on the policy.", actions = {
            AxfButton("Next policy", { actions.dispatch("swap:uac-policy:next") }, icon = "shield", requires = "uac.manage")
        }) }
        item { AxfCard(title = "Roles") { Column {
            for (r in policy.roles) AxfListItem(r.label, subtitle = r.description ?: r.permissions.joinToString(), icon = if (r.id == state.role) "check" else "user", selected = r.id == state.role, onClick = { runtime.setRole(r.id) }, trailing = { if (r.inherits.isNotEmpty()) AxfBadge("inherits ${r.inherits.joinToString()}") })
        } } }
        item { AxfCard(title = "Permissions of ${policy.role(state.role)?.label ?: state.role}") { Column {
            for ((perm, desc) in policy.permissions) {
                val ok = uac.can(perm)
                AxfListItem(perm, subtitle = desc, icon = if (ok) "unlock" else "lock", enabled = ok, trailing = { AxfBadge(if (ok) "allowed" else uac.gate(perm).name.lowercase(), tone = if (ok) "success" else "danger") })
            }
        } } }
        item { AxfCard(title = "Try it") { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AxfButton("Save (files.write)", { actions.dispatch("file.save") }, icon = "save", requires = "files.write")
            AxfButton("Deploy (dev.deploy)", { actions.dispatch("run.deploy") }, icon = "upload", requires = "dev.deploy")
        } } }
    }
}

/* ---------------- Action console ---------------- */

@Composable
public fun ActionConsole(modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    val actions = LocalAxfActions.current
    var spec by remember { mutableStateOf("swap:color-theme:next") }
    var payload by remember { mutableStateOf("") }
    val registered = remember(runtime) { runtime.actions.list() }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Action console", eyebrow = "${registered.size} actions · ${registered.count { it.second.stub }} stubs", description = "Dispatch any action spec through the bus. Menus, toolbars and shortcuts use exactly this path.") }
        item { AxfCard(title = "Dispatch") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            AxfTextField(spec, { spec = it }, Modifier.fillMaxWidth(), label = "Action spec", monospace = true, placeholder = "id:arg:arg")
            AxfTextField(payload, { payload = it }, Modifier.fillMaxWidth(), label = "Payload ({payload})", monospace = true)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AxfButton("Dispatch", { actions.dispatch(spec, payload.ifBlank { null }) }, tone = ButtonTone.PRIMARY, icon = "play") }
        } } }
        item { AxfCard(title = "Registered actions") { Column {
            for ((id, meta) in registered) AxfListItem(id, subtitle = meta.label + (meta.requires?.let { " · requires $it" } ?: ""), icon = if (meta.stub) "alert" else "zap", onClick = { spec = id }, trailing = { if (meta.stub) AxfBadge("stub", tone = "warning") else AxfBadge(meta.module) })
        } } }
    }
}

/* ---------------- Theme designer ---------------- */

/**
 * Edit any color token or style number of the active theme live. Changes are applied by importing a derived
 * asset (`<id>-custom`) so the original stays intact; Export shows the JSON for sharing.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun ThemeDesigner(modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    val compiled = LocalAxfCompiled.current
    val state = LocalAxfState.current
    val colorAsset = runtime.requireAsset(AssetTypes.COLOR_THEME)
    val styleAsset = runtime.requireAsset(AssetTypes.STYLE_THEME)
    var colors by remember(colorAsset.key) { mutableStateOf(ai.amberx.axf.kernel.asset.ColorTheme.fromJson(colorAsset.data).tokens) }
    var style by remember(styleAsset.key) { mutableStateOf(styleAsset.data) }
    var editing by remember { mutableStateOf<String?>(null) }
@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
    fun apply() {
        val derivedColor = derive(colorAsset, buildJsonObject { put("scheme", colorAsset.data["scheme"] ?: JsonPrimitive("dark")); put("tokens", JsonObject(colors.mapValues { JsonPrimitive(it.value) })) })
        val derivedStyle = derive(styleAsset, style)
        val r1 = runtime.importAsset(derivedColor); val r2 = runtime.importAsset(derivedStyle)
        if (r1.ok && r2.ok) runtime.toast("Custom theme applied.", ToastKind.SUCCESS, "Theme designer") else runtime.toast((r1.errors + r2.errors).joinToString(), ToastKind.DANGER, "Invalid")
    }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Theme designer", eyebrow = "${colorAsset.name} + ${styleAsset.name}", description = "Tap a token to edit it. Apply creates a custom copy of the active theme; the compiled result is what every screen reads.", actions = {
            AxfButton("Apply", { apply() }, tone = ButtonTone.PRIMARY, icon = "check", requires = "assets.import")
            AxfButton("Export", { runtime.openDialog("asset-json", mapOf("type" to AssetTypes.COLOR_THEME, "id" to state.active.getValue(AssetTypes.COLOR_THEME))) }, icon = "code")
        }) }
        item { AxfCard(title = "Color tokens") { FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (k in ColorTokens.CORE + ColorTokens.EXTENDED.filter { it in colors }) {
                val v = colors[k] ?: compiled.theme.colors[k] ?: ""
                val parsed = ai.amberx.axf.kernel.engine.Rgba.parse(v)
                Column(Modifier.padding(2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(44.dp).background(parsed?.let { Color(it.r, it.g, it.b, (it.a * 255).toInt()) } ?: Axf.colors.border, Axf.shapes.smShape).border(if (editing == k) 2.dp else 1.dp, if (editing == k) Axf.colors.accent else Axf.colors.border, Axf.shapes.smShape).clickable { editing = k })
                    AxfText(k, mono = true, muted = true)
                }
            }
        } } }
        if (editing != null) item { AxfCard(title = "Edit $editing", icon = "palette") { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            val key = editing!!
            val value = colors[key] ?: compiled.theme.colors[key] ?: "#000000"
            AxfTextField(value, { colors = colors + (key to it) }, Modifier.fillMaxWidth(), label = "Value (#hex or rgba())", monospace = true)
            val rgba = ai.amberx.axf.kernel.engine.Rgba.parse(value)
            if (rgba != null) {
                AxfSlider("Red", rgba.r.toFloat(), { colors = colors + (key to rgba.copy(r = it.toInt()).toCss()) }, max = 255f)
                AxfSlider("Green", rgba.g.toFloat(), { colors = colors + (key to rgba.copy(g = it.toInt()).toCss()) }, max = 255f)
                AxfSlider("Blue", rgba.b.toFloat(), { colors = colors + (key to rgba.copy(b = it.toInt()).toCss()) }, max = 255f)
                AxfSlider("Alpha", (rgba.a * 100).toFloat(), { colors = colors + (key to rgba.withAlpha(it / 100.0).toCss()) }, max = 100f, unit = "%")
            }
        } } }
        item { AxfCard(title = "Style tokens") { Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            val s = ai.amberx.axf.kernel.asset.StyleTheme.fromJson(style)
            fun num(key: String, v: Number) { style = JsonObject(style + (key to JsonPrimitive(v))) }
            fun nested(key: String, sub: String, v: Int) { val inner = (style[key] as? JsonObject) ?: JsonObject(emptyMap()); style = JsonObject(style + (key to JsonObject(inner + (sub to JsonPrimitive(v))))) }
            AxfSlider("Font size", s.fontSize.toFloat(), { num("fontSize", it.toInt()) }, min = 10f, max = 20f, unit = "px")
            AxfSlider("Spacing unit", s.space.toFloat(), { num("space", it.toInt()) }, min = 4f, max = 16f, unit = "px")
            AxfSlider("Radius sm", s.radius.sm.toFloat(), { nested("radius", "sm", it.toInt()) }, max = 24f, unit = "px")
            AxfSlider("Radius md", s.radius.md.toFloat(), { nested("radius", "md", it.toInt()) }, max = 32f, unit = "px")
            AxfSlider("Radius lg", s.radius.lg.toFloat(), { nested("radius", "lg", it.toInt()) }, max = 40f, unit = "px")
            AxfSlider("Border width", s.borderWidth.toFloat(), { num("borderWidth", it.toInt()) }, max = 4f, unit = "px")
            AxfSlider("Motion", s.motion.toFloat(), { num("motion", it.toInt()) }, max = 600f, step = 10f, unit = "ms")
            AxfSlider("Blur", s.blur.toFloat(), { num("blur", it.toInt()) }, max = 40f, unit = "px")
            AxfSlider("Disabled opacity", (s.opacityDisabled * 100).toFloat(), { num("opacityDisabled", it / 100.0) }, max = 100f, unit = "%")
            AxfSlider("Muted opacity", (s.opacityMuted * 100).toFloat(), { num("opacityMuted", it / 100.0) }, max = 100f, unit = "%")
            AxfSlider("Hover opacity", (s.opacityHover * 100).toFloat(), { num("opacityHover", it / 100.0) }, max = 100f, unit = "%")
            AxfSlider("Tint opacity", (s.opacityTint * 100).toFloat(), { num("opacityTint", it / 100.0) }, max = 100f, unit = "%")
            AxfSlider("Scrim opacity", (s.opacityScrim * 100).toFloat(), { num("opacityScrim", it / 100.0) }, max = 100f, unit = "%")
            AxfSlider("Glass opacity", (s.opacityGlass * 100).toFloat(), { num("opacityGlass", it / 100.0) }, max = 100f, unit = "%")
            AxfSlider("Heading weight", s.headingWeight.toFloat(), { num("headingWeight", it.toInt()) }, min = 300f, max = 900f, step = 50f)
            AxfSlider("Tracking", (s.tracking * 100).toFloat(), { num("tracking", it / 100.0) }, min = -8f, max = 8f, unit = "/100em")
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { for (d in listOf("compact", "comfortable", "spacious")) AxfChip(d, selected = s.density.name.equals(d, true), onClick = { style = JsonObject(style + ("density" to JsonPrimitive(d))) }) }
        } } }
    }
}

private fun derive(base: AssetEnvelope, data: JsonObject): JsonObject = buildJsonObject {
    put("\$axf", base.frame); put("type", base.type); put("id", if (base.id.endsWith("-custom")) base.id else "${base.id}-custom"); put("name", if (base.name.endsWith(" (custom)")) base.name else "${base.name} (custom)"); put("version", "0.1.0")
    put("description", "Derived from ${base.id} in the theme designer."); put("author", "Theme designer"); put("tags", kotlinx.serialization.json.JsonArray(base.tags.map { JsonPrimitive(it) })); put("data", data)
}

/* ---------------- Layout gallery ---------------- */

@Composable
public fun LayoutGallery(modifier: Modifier = Modifier) {
    val runtime = LocalAxfRuntime.current
    val state = LocalAxfState.current
    val compiled = LocalAxfCompiled.current
    val layouts = remember(compiled.rev) { runtime.registry.list(AssetTypes.LAYOUT) }
    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {
        item { AxfPageHead("Layouts", eyebrow = "window: ${compiled.layoutFor(state.windowWidthDp).windowClass.name.lowercase()} · ${state.windowWidthDp}dp", description = "Each layout asset compiles to a region grid per window class. Tap one to apply it to this app right now.") }
        for (a in layouts) item(key = a.id) {
            val l = ai.amberx.axf.kernel.asset.Layout.fromJson(a.data)
            val active = state.active[AssetTypes.LAYOUT] == a.id
            AxfCard(title = a.name, icon = "layout", ctxTarget = "asset-card", ctxPayload = "layout:${a.id}", actions = { if (active) AxfBadge("active") else AxfButton("Apply", { runtime.swap(AssetTypes.LAYOUT, a.id) }, requires = "assets.swap") }) {
                AxfText(a.description ?: "", muted = true)
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    for (wc in WindowClass.entries) {
                        val c = ai.amberx.axf.kernel.engine.LayoutEngine.compile(l, wc)
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            AxfSectionHeader(wc.name.lowercase())
                            Column(Modifier.size(96.dp, 64.dp).border(1.dp, Axf.colors.border, Axf.shapes.xsShape).padding(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                for (row in c.rows) if (row.region == null) Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                    for (col in c.columns) Box((if (col.width == null) Modifier.weight(1f) else Modifier.width(((col.width ?: 100) / 10).coerceIn(6, 24).dp)).fillMaxHeight().background(if (col.region == ai.amberx.axf.kernel.engine.Region.MAIN) Axf.colors.surface3 else Axf.colors.accentSoft))
                                } else Box(Modifier.fillMaxWidth().height(6.dp).background(Axf.colors.accentSoft))
                            }
                        }
                    }
                }
            }
        }
    }
}
