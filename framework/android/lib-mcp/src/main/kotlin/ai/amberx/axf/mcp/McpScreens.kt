package ai.amberx.axf.mcp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import ai.amberx.axf.kernel.asset.AxfJson
import ai.amberx.axf.kernel.mcp.Mcp
import ai.amberx.axf.kernel.mcp.McpEngine
import ai.amberx.axf.kernel.mcp.McpException
import ai.amberx.axf.kernel.mcp.McpToolEffect
import ai.amberx.axf.kernel.result.AxfResult
import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.LocalAxfRuntime
import ai.amberx.axf.ui.components.AxfBadge
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfChip
import ai.amberx.axf.ui.components.AxfEmptyState
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfSectionHeader
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.AxfTextField
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/*
 * Compose screens of lib-mcp (theme tokens only: Axf.colors / Axf.space / Axf.type).
 *   McpScreen         route `mcp`: pick a server, connect, browse tools / resources / prompts / call log, call a tool
 *                     with JSON arguments (write tools need mcp.call.write; destructive ones mcp.call.destructive + confirm)
 *   McpServersScreen  route `mcp-servers`: add / edit / remove servers; tokens are write-only (secure store)
 * Preview names start with `McpPreview` so a CI screenshot job can find them.
 */

private fun effectTone(e: McpToolEffect) = when (e) { McpToolEffect.READ -> "success"; McpToolEffect.WRITE -> "warning"; McpToolEffect.DESTRUCTIVE -> "danger" }

@OptIn(ExperimentalLayoutApi::class)
@Composable
public fun McpScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val mcp = remember(kernel) { kernel?.services?.get<AxfMcp>() }
    if (mcp == null) { AxfEmptyState("MCP unavailable", message = "McpModule is not installed.", icon = "cloud"); return }
    val runtime = LocalAxfRuntime.current
    runtime.state.collectAsState().value // recompose on role changes (the gate reads the role)
    val scope = rememberCoroutineScope()
    var servers by remember { mutableStateOf(mcp.registry.list()) }
    var selected by remember { mutableStateOf(servers.firstOrNull()?.id) }
    var conn by remember { mutableStateOf<McpConnected?>(null) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf("tools") }
    var filter by remember { mutableStateOf("") }
    var tool by remember { mutableStateOf<McpTool?>(null) }
    val server = servers.firstOrNull { it.id == selected }

    fun connect() {
        val s = server ?: return
        busy = true; problem = null; conn = null; tool = null
        scope.launch {
            try {
                val c = mcp.open(s).connect()
                conn = c
                mcp.registry.touch(s.id, true, c.tools.size); servers = mcp.registry.list()
            } catch (e: McpException) { problem = e.message } finally { busy = false }
        }
    }

    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("MCP servers", eyebrow = "MCP client · ${servers.size} server${if (servers.size == 1) "" else "s"}", description = "Connect to MCP servers over Streamable HTTP, browse what they offer and call their tools.",
            actions = { AxfButton("Manage servers", { runtime.navigate(McpModule.ROUTE_SERVERS) }, icon = "settings", requires = mcp.permissions.manage) })
        if (servers.isEmpty()) {
            AxfEmptyState("No servers yet", message = "Add a Streamable HTTP MCP server. Tokens stay in ${mcp.registry.label}.", icon = "cloud", action = { AxfButton("Add a server", { runtime.navigate(McpModule.ROUTE_SERVERS) }, tone = ButtonTone.PRIMARY, icon = "plus", requires = mcp.permissions.manage) })
            return@Column
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one), verticalArrangement = Arrangement.spacedBy(Axf.space.half)) {
            for (s in servers) AxfChip(s.name, selected = s.id == selected, icon = "cloud") { selected = s.id; conn = null; tool = null; problem = null }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton(if (busy) "Connecting…" else if (conn != null) "Reconnect" else "Connect", ::connect, tone = ButtonTone.PRIMARY, icon = "zap", enabled = !busy && server != null)
            server?.let { AxfText(it.url, muted = true, mono = true, maxLines = 1) }
        }
        problem?.let { AxfText(it, color = Axf.colors.danger) }
        val c = conn ?: return@Column
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfBadge("connected", tone = "success")
            c.session.serverInfo?.let { AxfText("${(it["title"] ?: it["name"])?.toString()?.trim('"')} ${it["version"]?.toString()?.trim('"') ?: ""}") }
            AxfText("protocol ${c.session.protocolVersion}${if (c.session.sessionId != null) " · session" else " · stateless"}", muted = true, style = Axf.type.bodySmall)
        }
        if (c.session.instructions.isNotEmpty()) AxfCard(title = "Server instructions", icon = "info") { AxfText(c.session.instructions, style = Axf.type.bodySmall) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            for ((id, label, n) in listOf(Triple("tools", "Tools", c.tools.size), Triple("resources", "Resources", c.resources.size), Triple("prompts", "Prompts", c.prompts.size), Triple("log", "Call log", -1)))
                AxfChip(if (n >= 0) "$label $n" else label, selected = tab == id) { tab = id }
        }
        when (tab) {
            "tools" -> {
                AxfTextField(filter, { filter = it }, Modifier.fillMaxWidth(), placeholder = "Filter tools…", leadingIcon = "search")
                val shown = c.tools.filter { t -> filter.isBlank() || "${t.name} ${t.title ?: ""} ${t.description ?: ""}".contains(filter, ignoreCase = true) }
                if (shown.isEmpty()) AxfText("No tools match.", muted = true)
                for (t in shown) {
                    val g = mcp.gate(t)
                    AxfListItem(t.name, subtitle = t.description, icon = "terminal", selected = tool?.name == t.name, enabled = g.allowed, onClick = { tool = t }, trailing = { AxfBadge(g.effect.id, tone = effectTone(g.effect)) })
                }
                val t = tool
                if (t != null && server != null) ToolRunner(mcp, server, t)
            }
            "resources" -> {
                c.resourcesError?.let { AxfText(it, color = Axf.colors.warning) }
                if (c.resources.isEmpty() && c.resourceTemplates.isEmpty()) AxfText("This server offers no resources.", muted = true)
                for (r in c.resources) ResourceRow(mcp, server!!, r)
                for (t in c.resourceTemplates) AxfListItem((t["title"] ?: t["name"] ?: t["uriTemplate"])?.toString()?.trim('"') ?: "template", subtitle = t["uriTemplate"]?.toString()?.trim('"'), icon = "file")
            }
            "prompts" -> {
                c.promptsError?.let { AxfText(it, color = Axf.colors.warning) }
                if (c.prompts.isEmpty()) AxfText("This server offers no prompts.", muted = true)
                for (p in c.prompts) PromptRow(mcp, server!!, p)
            }
            else -> CallLogView(mcp)
        }
    }
}

@Composable
private fun ToolRunner(mcp: AxfMcp, server: McpServerRecord, tool: McpTool) {
    val scope = rememberCoroutineScope()
    var args by remember(tool.name) { mutableStateOf(McpEngine.argumentSkeleton(tool.inputSchema).let { if (it.isEmpty()) "{}" else AxfJson.encodeToString(JsonObject.serializer(), it) }) }
    var result by remember(tool.name) { mutableStateOf<McpCallResult?>(null) }
    var error by remember(tool.name) { mutableStateOf<String?>(null) }
    var confirming by remember(tool.name) { mutableStateOf(false) }
    var job by remember { mutableStateOf<Job?>(null) }
    val g = mcp.gate(tool)

    fun run(confirmed: Boolean) {
        val parsed = runCatching { AxfJson.parseToJsonElement(args) as? JsonObject }.getOrNull()
        if (parsed == null) { error = "Arguments must be a JSON object."; return }
        if (g.confirm && !confirmed) { confirming = true; return }
        confirming = false; error = null; result = null
        job = scope.launch {
            when (val o = mcp.callTool(server, tool, parsed, confirmed)) {
                is McpCallOutcome.Done -> result = o.result
                is McpCallOutcome.ConfirmFirst -> confirming = true
                is McpCallOutcome.Failed -> error = o.error.message
            }
            job = null
        }
    }

    AxfCard(title = tool.title ?: tool.name, icon = "terminal") {
        tool.description?.let { AxfText(it, style = Axf.type.bodySmall) }
        Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfBadge(g.effect.id, tone = effectTone(g.effect))
            if (!g.allowed) AxfBadge("needs ${g.requires}", tone = "danger")
        }
        (tool.inputSchema?.get("properties") as? JsonObject)?.let { props ->
            for ((k, v) in props) AxfText("$k: ${((v as? JsonObject)?.get("type") ?: "any").toString().trim('"')}${((v as? JsonObject)?.get("description"))?.let { " — ${it.toString().trim('"')}" } ?: ""}", style = Axf.type.bodySmall, muted = true, mono = true)
        }
        AxfTextField(args, { args = it }, Modifier.fillMaxWidth(), label = "Arguments (JSON)", singleLine = false, minLines = 3, monospace = true)
        if (confirming) {
            AxfCard(title = "${tool.name} is marked destructive by its server", icon = "alert") {
                AxfText("It may delete or irreversibly change something. Call it with these arguments?", style = Axf.type.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                    AxfButton("Call it", { run(true) }, tone = ButtonTone.DANGER, icon = "play")
                    AxfButton("Keep", { confirming = false }, tone = ButtonTone.GHOST)
                }
            }
        } else Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
            AxfButton(if (job != null) "Calling…" else "Call tool", { run(false) }, tone = ButtonTone.PRIMARY, icon = "play", enabled = job == null && g.allowed)
            if (job != null) AxfButton("Cancel", { job?.cancel(); job = null }, tone = ButtonTone.GHOST, icon = "x")
            AxfButton("Reset", { args = McpEngine.argumentSkeleton(tool.inputSchema).let { if (it.isEmpty()) "{}" else AxfJson.encodeToString(JsonObject.serializer(), it) } }, tone = ButtonTone.GHOST, icon = "undo")
        }
        error?.let { AxfText(it, color = Axf.colors.danger) }
        result?.let { r ->
            AxfBadge(if (r.isError) "tool error" else "result", tone = if (r.isError) "danger" else "success")
            AxfText(McpEngine.contentText(r.content).ifEmpty { "(no content)" }, mono = true, style = Axf.type.bodySmall)
            r.structured?.let { AxfText(it.toString(), mono = true, style = Axf.type.bodySmall, muted = true) }
        }
    }
}

@Composable
private fun ResourceRow(mcp: AxfMcp, server: McpServerRecord, r: McpResource) {
    val scope = rememberCoroutineScope()
    val runtime = LocalAxfRuntime.current
    var text by remember(r.uri) { mutableStateOf<String?>(null) }
    val may = runtime.can(mcp.permissions.call)
    AxfCard(title = r.title ?: r.name ?: r.uri, icon = "file", actions = {
        AxfButton("Read", { scope.launch { text = try { mcp.open(server).readResource(r.uri).joinToString("\n\n") { c -> (c["text"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "(binary ${(c["mimeType"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""})" } } catch (e: McpException) { e.message } } }, icon = "eye", enabled = may, requires = mcp.permissions.call)
    }) {
        AxfText("${r.uri}${r.mimeType?.let { " · $it" } ?: ""}", muted = true, mono = true, style = Axf.type.bodySmall)
        r.description?.let { AxfText(it, style = Axf.type.bodySmall) }
        text?.let { AxfText(it, mono = true, style = Axf.type.bodySmall) }
    }
}

@Composable
private fun PromptRow(mcp: AxfMcp, server: McpServerRecord, p: McpPrompt) {
    val scope = rememberCoroutineScope()
    val runtime = LocalAxfRuntime.current
    var text by remember(p.name) { mutableStateOf<String?>(null) }
    val args = remember(p.name) { androidx.compose.runtime.mutableStateMapOf<String, String>() }
    AxfCard(title = p.title ?: p.name, icon = "message", actions = {
        AxfButton("Get", { scope.launch { text = try { val r = mcp.open(server).getPrompt(p.name, args.toMap()); (r["messages"] as? kotlinx.serialization.json.JsonArray)?.joinToString("\n\n") { m -> val o = m as? JsonObject; "[${(o?.get("role") as? kotlinx.serialization.json.JsonPrimitive)?.content}] ${McpEngine.contentText(o?.get("content")?.let { kotlinx.serialization.json.JsonArray(listOf(it)) })}" } ?: "" } catch (e: McpException) { e.message } } }, icon = "eye", requires = mcp.permissions.call, enabled = runtime.can(mcp.permissions.call))
    }) {
        p.description?.let { AxfText(it, style = Axf.type.bodySmall, muted = true) }
        for (a in p.arguments) {
            val name = (a["name"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: continue
            AxfTextField(args[name] ?: "", { args[name] = it }, Modifier.fillMaxWidth(), label = name + (if ((a["required"] as? kotlinx.serialization.json.JsonPrimitive)?.content == "true") "*" else ""))
        }
        text?.let { AxfText(it, mono = true, style = Axf.type.bodySmall) }
    }
}

@Composable
private fun CallLogView(mcp: AxfMcp) {
    var rows by remember { mutableStateOf(mcp.log.list()) }
    Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
        AxfButton("Refresh", { rows = mcp.log.list() }, icon = "refresh")
        AxfButton("Clear", { mcp.log.clear(); rows = emptyList() }, icon = "trash", tone = ButtonTone.GHOST)
    }
    if (rows.isEmpty()) AxfText("No calls yet.", muted = true)
    for (r in rows) AxfListItem("${r.server} · ${r.op}", subtitle = if (r.ok) "ok · ${r.ms} ms" else "failed · ${r.detail}", icon = if (r.ok) "check" else "alert")
}

/** Route `mcp-servers`: add, edit and remove servers. Tokens are write-only (secure store). */
@Composable
public fun McpServersScreen(modifier: Modifier = Modifier) {
    val kernel = LocalAxfKernel.current
    val mcp = remember(kernel) { kernel?.services?.get<AxfMcp>() }
    if (mcp == null) { AxfEmptyState("MCP unavailable", message = "McpModule is not installed.", icon = "cloud"); return }
    val runtime = LocalAxfRuntime.current
    val scope = rememberCoroutineScope()
    var servers by remember { mutableStateOf(mcp.registry.list()) }
    var editing by remember { mutableStateOf<McpServerRecord?>(null) }
    var adding by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var token by remember { mutableStateOf("") }
    var clearToken by remember { mutableStateOf(false) }
    var note by remember { mutableStateOf<String?>(null) }
    var confirmRemove by remember { mutableStateOf<String?>(null) }
    val manage = runtime.can(mcp.permissions.manage)
    fun startEdit(s: McpServerRecord?) { editing = s; adding = s == null; name = s?.name ?: ""; url = s?.url ?: ""; description = s?.description ?: ""; token = ""; clearToken = false; note = null }

    Column(modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.two)) {
        AxfPageHead("Manage MCP servers", eyebrow = "Settings · MCP", description = "Tokens are write-only: kept in ${mcp.registry.label} and never shown again.")
        if (!manage) AxfText("Your role can view servers; adding or changing them needs ${mcp.permissions.manage}.", muted = true)
        if (servers.isEmpty() && !adding) AxfText("No MCP servers yet.", muted = true)
        for (s in servers) AxfCard(title = s.name, icon = "cloud", actions = {
            AxfBadge(if (s.hasToken) "token set" else "no auth", tone = if (s.hasToken) "accent" else "muted")
        }) {
            AxfText(s.url, muted = true, mono = true, style = Axf.type.bodySmall)
            if (s.description.isNotEmpty()) AxfText(s.description, style = Axf.type.bodySmall)
            s.lastCheck?.let { AxfText("last connected: ${if (it.ok) "ok" else "failed"} · ${it.tools} tools", muted = true, style = Axf.type.bodySmall) }
            if (confirmRemove == s.id) Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfText("Remove ${s.name}?")
                AxfButton("Remove", { scope.launch { mcp.registry.remove(s.id); servers = mcp.registry.list(); confirmRemove = null; runtime.toast("Removed ${s.name}") } }, tone = ButtonTone.DANGER, icon = "trash")
                AxfButton("Keep", { confirmRemove = null }, tone = ButtonTone.GHOST)
            } else Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Edit", { startEdit(s) }, icon = "edit", requires = mcp.permissions.manage, enabled = manage)
                AxfButton("Remove", { confirmRemove = s.id }, icon = "trash", tone = ButtonTone.GHOST, requires = mcp.permissions.manage, enabled = manage)
            }
        }
        if (adding || editing != null) AxfCard(title = editing?.let { "Edit ${it.name}" } ?: "Add an MCP server", icon = "cloud") {
            AxfTextField(name, { name = it }, Modifier.fillMaxWidth(), label = "Name", placeholder = "axHub")
            AxfTextField(url, { url = it }, Modifier.fillMaxWidth(), label = "Streamable HTTP URL", placeholder = "https://axhub.amberxai.com/mcp", monospace = true)
            AxfTextField(description, { description = it }, Modifier.fillMaxWidth(), label = "Description")
            AxfTextField(token, { token = it; clearToken = false }, Modifier.fillMaxWidth(), label = "Bearer token" + if (editing?.hasToken == true) " (leave blank to keep the stored one)" else "", secret = true)
            if (editing?.hasToken == true) AxfChip(if (clearToken) "Token will be cleared" else "Clear the stored token", selected = clearToken, icon = "x") { clearToken = !clearToken; if (clearToken) token = "" }
            note?.let { AxfText(it, color = Axf.colors.danger) }
            Row(horizontalArrangement = Arrangement.spacedBy(Axf.space.one)) {
                AxfButton("Save", {
                    scope.launch {
                        when (val r = mcp.registry.save(editing?.id, name, url, description, if (clearToken) "" else token.ifEmpty { null })) {
                            is AxfResult.Ok -> { servers = mcp.registry.list(); adding = false; editing = null; runtime.toast("Saved ${r.value.name}") }
                            is AxfResult.Err -> note = r.failure.message
                        }
                    }
                }, tone = ButtonTone.PRIMARY, icon = "save", enabled = manage)
                AxfButton("Cancel", { adding = false; editing = null; note = null }, tone = ButtonTone.GHOST)
            }
        } else AxfButton("Add a server", { startEdit(null) }, tone = ButtonTone.PRIMARY, icon = "plus", requires = mcp.permissions.manage, enabled = manage)
        AxfSectionHeader("Permissions")
        AxfText("${mcp.permissions.call} read tools, resources, prompts · ${mcp.permissions.write} write tools · ${mcp.permissions.destructive} destructive tools (always confirmed) · ${mcp.permissions.manage} this screen", muted = true, style = Axf.type.bodySmall)
    }
}

@Preview(name = "McpPreviewServers", showBackground = true)
@Composable
private fun McpPreviewServers() { McpServersScreen() }

@Preview(name = "McpPreviewBrowse", showBackground = true)
@Composable
private fun McpPreviewBrowse() { McpScreen() }
