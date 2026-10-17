"""Writes framework/library-templates/<id>/ (template.json + android/ web/ python/ files) from the specs below.
Re-run after editing: python3 framework/library-templates/generate.py. Tokens: {{SLUG}} {{MODULE_NAME}} {{PACKAGE}}
{{CLASS}} {{LABEL}} {{MODULE_ID}} {{ROUTE}} {{PY}} {{VERSION}} {{TEMPLATE}} {{DESCRIPTION}} and {{P_<PARAM>}} for template parameters.
Kotlin/TS/Python files under android/kotlin, web/, python/ are moved into the right package by the build engine."""
import json, os, shutil
HERE = os.path.dirname(os.path.abspath(__file__))

GRADLE = '''plugins { id("axf.android.compose.library") }
description = "{{LABEL}} — AXF library ({{TEMPLATE}} template)"
dependencies {
    api(project(":axf-kernel"))
    implementation(project(":axf-ui"))%s
}
'''
MANIFEST = '<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n'
KT_IMPORTS_MODULE = '''import ai.amberx.axf.kernel.contract.RouteSpec
import ai.amberx.axf.kernel.contract.SettingKind
import ai.amberx.axf.kernel.contract.SettingSpec
import ai.amberx.axf.kernel.contract.SettingsGroup
import ai.amberx.axf.kernel.engine.ActionMeta
import ai.amberx.axf.kernel.module.ActionContribution
import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext
import ai.amberx.axf.kernel.module.RouteContribution
import ai.amberx.axf.kernel.module.SettingsContribution
import ai.amberx.axf.kernel.runtime.AxfRuntime
import kotlinx.serialization.json.JsonPrimitive
'''

def module(extra_imports='', body='', settings='', caps='', deps='', doc=''):
    return f'''package {{{{PACKAGE}}}}

{KT_IMPORTS_MODULE}{extra_imports}
/**
 * {{{{LABEL}}}} — generated from the `{{{{TEMPLATE}}}}` library template. {doc}
 * Apps add it with `axf install {{{{SLUG}}}}` (or list {{{{CLASS}}}}Module() in App.kt) and map the "{{{{ROUTE}}}}" view to {{{{CLASS}}}}Screen.
 */
public class {{{{CLASS}}}}Module : BaseModule(ID, "{{{{LABEL}}}}") {{
    override val provides: List<Capability> = listOf(Capability(ID, "{{{{DESCRIPTION}}}}"){caps})
    override val dependsOn: List<String> = listOf({deps})

    override fun register(ctx: ModuleContext) {{
        val runtime = ctx.service(AxfRuntime::class)
        ctx.extensions.contribute(ExtensionPoints.ROUTES, id, RouteContribution(RouteSpec("{{{{ROUTE}}}}", "{{{{LABEL}}}}", icon = "box", module = id)))
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("{{{{ROUTE}}}}.open", ActionMeta("Open {{{{LABEL}}}}", module = id)) {{ _, _ -> runtime?.navigate("{{{{ROUTE}}}}") }})
        ctx.extensions.contribute(ExtensionPoints.SETTINGS, id, SettingsContribution(SettingsGroup("{{{{ROUTE}}}}", "{{{{LABEL}}}}", "box", id, order = 100, settings = listOf(
            SettingSpec("{{{{ROUTE}}}}.enabled", "Enable {{{{LABEL}}}}", SettingKind.TOGGLE, default = JsonPrimitive(true)),{settings}
        ))))
{body}    }}

    public companion object {{ public const val ID: String = "{{{{MODULE_ID}}}}" }}
}}
'''

SCREEN_IMPORTS = '''import ai.amberx.axf.ui.LocalAxfActions
import ai.amberx.axf.ui.components.AxfButton
import ai.amberx.axf.ui.components.AxfCard
import ai.amberx.axf.ui.components.AxfPageHead
import ai.amberx.axf.ui.components.AxfText
import ai.amberx.axf.ui.components.ButtonTone
import ai.amberx.axf.ui.theme.Axf
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
'''
def screen(extra_imports='', pre='', items='', doc='The library\'s main screen.'):
    return f'''package {{{{PACKAGE}}}}

{SCREEN_IMPORTS}{extra_imports}
/** {{{{LABEL}}}} — {doc} Apps map the "{{{{ROUTE}}}}" view to it. */
@Composable
public fun {{{{CLASS}}}}Screen(modifier: Modifier = Modifier) {{
    val actions = LocalAxfActions.current
{pre}    LazyColumn(modifier.fillMaxWidth(), contentPadding = PaddingValues(Axf.space.two), verticalArrangement = Arrangement.spacedBy(Axf.space.oneHalf)) {{
        item {{ AxfPageHead("{{{{LABEL}}}}", eyebrow = "{{{{MODULE_NAME}}}} · {{{{TEMPLATE}}}}", description = "{{{{DESCRIPTION}}}}") }}
{items}        item {{
            AxfCard(title = "Settings", icon = "settings") {{
                AxfText("Every library contributes a settings group; this one lives under {{{{LABEL}}}}.", muted = true)
                AxfButton("Open settings", {{ actions.dispatch("app.settings") }}, icon = "settings", tone = ButtonTone.NEUTRAL)
            }}
        }}
    }}
}}
'''

WEB_HEAD = '''import { useState } from 'react';
import { Button, Container, useRuntime } from '../../react';
import type { AxfWebLibrary } from '../../react/library';
'''
def web(extra='', view_body='', register='', head=WEB_HEAD):
    return f'''{head}
/** {{{{LABEL}}}} — generated from the `{{{{TEMPLATE}}}}` library template (web port of {{{{MODULE_ID}}}}). */
{extra}
export function {{{{CLASS}}}}View() {{
  const rt = useRuntime();
  const [opened, setOpened] = useState(0);
{view_body}  return (
    <div className="fx-stack fx-stack--lg">
      <header className="fx-pagehead"><div><p className="fx-eyebrow">{{{{MODULE_NAME}}}} · {{{{TEMPLATE}}}}</p><h1>{{{{LABEL}}}}</h1><p className="fx-muted">{{{{DESCRIPTION}}}}</p></div></header>
      <__BODY__/>
      <Container title="Library" icon="box">
        <p className="fx-muted" style={{{{ marginTop: 0 }}}}>Opened {{opened}} time(s) this session.</p>
        <Button icon="terminal" onClick={{() => {{ setOpened(opened + 1); rt.terminal.log('{{{{ROUTE}}}}', 'opened from the library view'); }}}}>Log to terminal</Button>
      </Container>
    </div>
  );
}}

export const library: AxfWebLibrary = {{
  id: '{{{{MODULE_ID}}}}',
  label: '{{{{LABEL}}}}',
  version: '{{{{VERSION}}}}',
  template: '{{{{TEMPLATE}}}}',
  dependsOn: [],
  register(rt) {{
    rt.actions.register('{{{{ROUTE}}}}.open', () => rt.navigate('{{{{ROUTE}}}}'), {{ label: 'Open {{{{LABEL}}}}' }});
{register}  }},
  views: {{ '{{{{ROUTE}}}}': {{ title: '{{{{LABEL}}}}', icon: 'box', render: () => <{{{{CLASS}}}}View /> }} }},
}};
'''

def py(service='', register=''):
    return f'''"""{{{{LABEL}}}} — generated from the `{{{{TEMPLATE}}}}` library template (Python port of {{{{MODULE_ID}}}})."""
from __future__ import annotations

from axf.library import Kernel, Library
{service}

def register(kernel: Kernel) -> None:
    kernel.contribute("routes", "{{{{MODULE_ID}}}}", {{"id": "{{{{ROUTE}}}}", "label": "{{{{LABEL}}}}"}})
    kernel.contribute("actions", "{{{{MODULE_ID}}}}", {{"id": "{{{{ROUTE}}}}.open", "label": "Open {{{{LABEL}}}}"}})
    kernel.contribute("settings", "{{{{MODULE_ID}}}}", {{"group": "{{{{ROUTE}}}}", "settings": [{{"key": "{{{{ROUTE}}}}.enabled", "kind": "toggle", "default": True}}]}})
{register}

LIBRARY = Library(id="{{{{MODULE_ID}}}}", label="{{{{LABEL}}}}", version="{{{{VERSION}}}}", template="{{{{TEMPLATE}}}}", register=register)
'''

T = {}
# ---------------------------------------------------------------- feature-screens
T['feature-screens'] = dict(name='Feature screens', category='Screens & UI', icon='layout',
  description='A feature with its own screen, an Open action and a settings group. The starting point for most libraries.',
  produces=['Route + view', 'Open action', 'Settings group'], params=[], deps=[], gradle='',
  android={'Module.kt': module(doc='Contributes a route, an Open action and a settings group.'),
           'Screen.kt': screen(items='''        item {
            AxfCard(title = "Getting started", icon = "box") {
                AxfText("Build this feature's screen here. The route, action and settings are already registered.")
                AxfButton("Show a toast", { actions.dispatch("toast:success:{{LABEL}} works") }, tone = ButtonTone.PRIMARY, icon = "zap")
            }
        }
''')},
  web=web().replace('<__BODY__/>', '<Container title="Getting started" icon="box"><p style={{ marginTop: 0 }}>Build this feature\'s view here; the route and Open action are registered.</p><Button tone="primary" icon="zap" onClick={() => rt.toast(\'{{LABEL}} works\', \'success\')}>Show a toast</Button></Container>'),
  py=py())

# ---------------------------------------------------------------- service-provider
SP_KT = '''package {{PACKAGE}}

import ai.amberx.axf.kernel.result.AxfResult

/** The contract apps code against; real providers (per platform / vendor) implement it. */
public interface {{CLASS}}Provider {
    public val name: String
    public suspend fun status(): AxfResult<String>
}

/** Ships with the library so apps and demos work before a real provider exists. */
public class Mock{{CLASS}}Provider : {{CLASS}}Provider {
    override val name: String = "mock"
    override suspend fun status(): AxfResult<String> = AxfResult.ok("Mock {{LABEL}} provider ready")
}

/** Registered as a service; swap `provider` at startup (or from settings) to change implementations. */
public class {{CLASS}}Service(public var provider: {{CLASS}}Provider = Mock{{CLASS}}Provider())
'''
T['service-provider'] = dict(name='Service provider', category='Services', icon='package',
  description='A provider contract with a mock implementation and a service apps resolve at runtime — for accounts, billing, storage, AI… where real vendors plug in later.',
  produces=['Provider interface', 'Mock provider', 'Service + capability', 'Status screen'], params=[{'key':'provider','label':'Default provider name','type':'text','default':'mock'}], deps=[], gradle='',
  android={'Service.kt': SP_KT,
           'Module.kt': module(body='        ctx.services.register({{CLASS}}Service::class, {{CLASS}}Service(), "{{MODULE_ID}}.service")\n', caps=', Capability("{{MODULE_ID}}.provider", "Pluggable {{LABEL}} provider")',
                settings='\n            SettingSpec("{{ROUTE}}.provider", "Provider", SettingKind.CHOICE, default = JsonPrimitive("{{P_PROVIDER}}"), options = listOf("mock" to "Mock")),', doc='Registers a service with a swappable provider (mock by default).'),
           'Screen.kt': screen(extra_imports='import ai.amberx.axf.ui.LocalAxfKernel\nimport androidx.compose.runtime.LaunchedEffect\nimport androidx.compose.runtime.getValue\nimport androidx.compose.runtime.mutableStateOf\nimport androidx.compose.runtime.remember\nimport androidx.compose.runtime.setValue\n',
               pre='''    val service = LocalAxfKernel.current?.services?.get({{CLASS}}Service::class)
    var status by remember { mutableStateOf("checking…") }
    LaunchedEffect(service) { status = service?.provider?.status()?.getOrNull() ?: "service not registered" }
''', items='''        item {
            AxfCard(title = "Provider", icon = "package") {
                AxfText("Active provider: ${service?.provider?.name ?: "none"}")
                AxfText(status, muted = true)
            }
        }
''')},
  web=web(extra='''export interface {{CLASS}}Provider { name: string; status(): Promise<string> }
export const mock{{CLASS}}Provider: {{CLASS}}Provider = { name: 'mock', status: async () => 'Mock {{LABEL}} provider ready' };
export const {{CLASS_LOWER}}Service = { provider: mock{{CLASS}}Provider as {{CLASS}}Provider };
''', view_body='''  const [status, setStatus] = useState('not checked');
''').replace('<__BODY__/>', '<Container title="Provider" icon="package"><p style={{ marginTop: 0 }}>Active provider: {{{CLASS_LOWER}}Service.provider.name} — {status}</p><Button icon="refresh" onClick={() => {{CLASS_LOWER}}Service.provider.status().then(setStatus)}>Check status</Button></Container>'),
  py=py(service='''

class {{CLASS}}Provider:
    name = "base"

    def status(self) -> str:
        raise NotImplementedError


class Mock{{CLASS}}Provider({{CLASS}}Provider):
    name = "mock"

    def status(self) -> str:
        return "Mock {{LABEL}} provider ready"


class {{CLASS}}Service:
    def __init__(self, provider: {{CLASS}}Provider | None = None) -> None:
        self.provider = provider or Mock{{CLASS}}Provider()
''', register='    kernel.register_service("{{MODULE_ID}}.service", {{CLASS}}Service())\n'))

# ---------------------------------------------------------------- data-feature
DF_KT = '''package {{PACKAGE}}

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** One record of this feature. */
public data class {{CLASS}}Item(val id: String, val title: String, val done: Boolean = false, val createdAt: Long = System.currentTimeMillis())

/** In-memory repository with an observable list. Persist it with axf-data (JsonDocumentStore / OfflineFirstRepository) when the feature needs it. */
public class {{CLASS}}Repository {
    private val _items = MutableStateFlow<List<{{CLASS}}Item>>(emptyList())
    public val items: StateFlow<List<{{CLASS}}Item>> get() = _items
    public fun add(title: String) { if (title.isNotBlank()) _items.update { it + {{CLASS}}Item(System.nanoTime().toString(36), title.trim()) } }
    public fun toggle(id: String) { _items.update { list -> list.map { if (it.id == id) it.copy(done = !it.done) else it } } }
    public fun remove(id: String) { _items.update { list -> list.filterNot { it.id == id } } }
}
'''
T['data-feature'] = dict(name='Data feature (list + detail)', category='Data', icon='list',
  description='A record type, an observable repository and a list screen with add / toggle / remove — notes, tasks, expenses, bookmarks.',
  produces=['Record model', 'Repository service', 'List screen'], params=[{'key':'item','label':'What one record is called','type':'text','default':'item'}], deps=[], gradle='',
  android={'Repository.kt': DF_KT,
           'Module.kt': module(body='        ctx.services.register({{CLASS}}Repository::class, {{CLASS}}Repository(), "{{MODULE_ID}}.repository")\n', doc='Registers a repository service for its records.'),
           'Screen.kt': screen(extra_imports='''import ai.amberx.axf.ui.LocalAxfKernel
import ai.amberx.axf.ui.components.AxfIconButton
import ai.amberx.axf.ui.components.AxfListItem
import ai.amberx.axf.ui.components.AxfTextField
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
''', pre='''    val repo = LocalAxfKernel.current?.services?.get({{CLASS}}Repository::class)
    val items by (repo?.items ?: kotlinx.coroutines.flow.MutableStateFlow(emptyList<{{CLASS}}Item>())).collectAsState()
    var draft by remember { mutableStateOf("") }
''', items='''        item {
            AxfCard(title = "New {{P_ITEM}}", icon = "plus") {
                AxfTextField(draft, { draft = it }, Modifier.fillMaxWidth(), label = "Title")
                AxfButton("Add", { repo?.add(draft); draft = "" }, tone = ButtonTone.PRIMARY, icon = "plus", enabled = draft.isNotBlank())
            }
        }
        if (items.isEmpty()) item { AxfText("No {{P_ITEM}}s yet.", muted = true) }
        items(items.size) { i ->
            val it0 = items[i]
            AxfListItem(it0.title, subtitle = if (it0.done) "done" else "open", icon = if (it0.done) "check" else "box", onClick = { repo?.toggle(it0.id) }, trailing = { AxfIconButton("x", "Remove", { repo?.remove(it0.id) }) })
        }
''')},
  web=web(extra='''export interface {{CLASS}}Item { id: string; title: string; done: boolean }
''', view_body='''  const [items, setItems] = useState<{{CLASS}}Item[]>([]);
  const [draft, setDraft] = useState('');
''').replace('<__BODY__/>', '''<Container title="{{P_ITEM}}s" icon="list">
        <form className="fx-row" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { setItems([...items, { id: Date.now().toString(36), title: draft.trim(), done: false }]); setDraft(''); } }}>
          <input className="fx-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New {{P_ITEM}}" /><Button tone="primary" icon="plus" type="submit">Add</Button>
        </form>
        {items.length === 0 ? <p className="fx-muted">No {{P_ITEM}}s yet.</p> : <ul>{items.map((it) => <li key={it.id}><label><input type="checkbox" checked={it.done} onChange={() => setItems(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))} /> {it.title}</label> <button className="fx-iconbtn" onClick={() => setItems(items.filter((x) => x.id !== it.id))}>×</button></li>)}</ul>}
      </Container>'''),
  py=py(service='''
from dataclasses import dataclass, field
import time


@dataclass
class {{CLASS}}Item:
    id: str
    title: str
    done: bool = False
    created_at: float = field(default_factory=time.time)


class {{CLASS}}Repository:
    def __init__(self) -> None:
        self.items: list[{{CLASS}}Item] = []

    def add(self, title: str) -> {{CLASS}}Item:
        item = {{CLASS}}Item(id=format(time.time_ns(), "x"), title=title.strip())
        self.items.append(item)
        return item

    def toggle(self, item_id: str) -> None:
        for it in self.items:
            if it.id == item_id:
                it.done = not it.done

    def remove(self, item_id: str) -> None:
        self.items = [it for it in self.items if it.id != item_id]
''', register='    kernel.register_service("{{MODULE_ID}}.repository", {{CLASS}}Repository())\n'))

# ---------------------------------------------------------------- device-capability
DC_KT = '''package {{PACKAGE}}

import ai.amberx.axf.kernel.platform.PermissionGateway
import ai.amberx.axf.kernel.platform.PermissionState

/** Wraps the platform permission for this capability; the real device API calls go in here. */
public class {{CLASS}}Capability(private val permissions: PermissionGateway?) {
    public val permission: String = "{{P_PERMISSION}}"
    public fun state(): PermissionState = permissions?.state(permission) ?: PermissionState.UNKNOWN
    public suspend fun request(): PermissionState = permissions?.request(listOf(permission), "{{LABEL}} needs this to work")?.get(permission) ?: PermissionState.UNKNOWN
    public fun openSettings() { permissions?.openSettings() }
}
'''
T['device-capability'] = dict(name='Device capability', category='Device', icon='smartphone',
  description='Wraps one device capability behind its permission: state, request with rationale, open settings — camera, location, microphone, Bluetooth, NFC, sensors.',
  produces=['Capability service', 'Permission flow', 'Status screen'], params=[{'key':'permission','label':'Android permission','type':'text','default':'android.permission.CAMERA','help':'Also add it to the app\'s AndroidManifest.xml'}], deps=[], gradle='',
  android={'Capability.kt': DC_KT,
           'Module.kt': module(extra_imports='import ai.amberx.axf.kernel.platform.PermissionGateway\n', body='        ctx.services.register({{CLASS}}Capability::class, {{CLASS}}Capability(ctx.service(PermissionGateway::class)), "{{MODULE_ID}}.capability")\n', doc='Registers a capability service around the {{P_PERMISSION}} permission.'),
           'Screen.kt': screen(extra_imports='''import ai.amberx.axf.ui.LocalAxfKernel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
''', pre='''    val cap = LocalAxfKernel.current?.services?.get({{CLASS}}Capability::class)
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf(cap?.state()?.name ?: "UNKNOWN") }
''', items='''        item {
            AxfCard(title = "Permission", icon = "shield") {
                AxfText("${cap?.permission ?: "{{P_PERMISSION}}"}: $state")
                AxfButton("Request", { scope.launch { state = cap?.request()?.name ?: "UNKNOWN" } }, tone = ButtonTone.PRIMARY, icon = "shield")
                AxfButton("Open app settings", { cap?.openSettings() }, icon = "settings")
            }
        }
''')},
  web=web(view_body='''  const [state, setState] = useState('unknown');
''').replace('<__BODY__/>', '''<Container title="Permission" icon="shield"><p style={{ marginTop: 0 }}>Browser permission state: {state}</p><Button icon="refresh" onClick={() => { const n = navigator as Navigator & { permissions?: Permissions }; n.permissions?.query({ name: 'camera' as PermissionName }).then((r) => setState(r.state), () => setState('not supported')); }}>Check</Button></Container>'''),
  py=py(service='''

class {{CLASS}}Capability:
    permission = "{{P_PERMISSION}}"

    def state(self) -> str:
        return "unknown"  # desktop: replace with the platform check (e.g. QMediaDevices for the camera)
''', register='    kernel.register_service("{{MODULE_ID}}.capability", {{CLASS}}Capability())\n'))

# ---------------------------------------------------------------- integration
IN_KT = '''package {{PACKAGE}}

import ai.amberx.axf.network.AxfHttp

/** Talks to the remote service. Keep tokens in the settings SECRET field (secure store), never in code. */
public class {{CLASS}}Client(private val http: AxfHttp?, public var baseUrl: String = "{{P_BASE_URL}}") {
    /** Returns the HTTP status of the base URL, or null when the network module is missing / the call fails. */
    public suspend fun ping(): Int? = http?.get(baseUrl)?.getOrNull()?.code
}
'''
T['integration'] = dict(name='Integration (remote API)', category='Integrations', icon='cloud',
  description='A client for a remote service with base URL and secret token settings, a Sync action and a connection check — GitHub, VPS, Coolify, Hostinger, Stripe…',
  produces=['HTTP client service', 'Base URL + token settings', 'Sync action', 'Connection screen'], params=[{'key':'base_url','label':'API base URL','type':'text','default':'https://api.example.com'}],
  deps=['ai.amberx.axf.network'], gradle='\n    implementation(project(":axf-network"))',
  android={'Client.kt': IN_KT,
           'Module.kt': module(extra_imports='import ai.amberx.axf.network.AxfHttp\n', deps='"ai.amberx.axf.network"',
               settings='\n            SettingSpec("{{ROUTE}}.baseUrl", "API base URL", SettingKind.TEXT, default = JsonPrimitive("{{P_BASE_URL}}")),\n            SettingSpec("{{ROUTE}}.token", "API token", SettingKind.SECRET),',
               body='''        ctx.services.register({{CLASS}}Client::class, {{CLASS}}Client(ctx.service(AxfHttp::class)), "{{MODULE_ID}}.client")
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("{{ROUTE}}.sync", ActionMeta("Sync {{LABEL}}", module = id)) { _, _ -> runtime?.toast("Sync for {{LABEL}} is not implemented yet.") })
''', doc='Registers an HTTP client, its settings and a Sync action.'),
           'Screen.kt': screen(extra_imports='''import ai.amberx.axf.ui.LocalAxfKernel
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.launch
''', pre='''    val client = LocalAxfKernel.current?.services?.get({{CLASS}}Client::class)
    val scope = rememberCoroutineScope()
    var result by remember { mutableStateOf("not checked") }
''', items='''        item {
            AxfCard(title = "Connection", icon = "cloud") {
                AxfText(client?.baseUrl ?: "client not registered", muted = true)
                AxfText(result)
                AxfButton("Check connection", { scope.launch { result = client?.ping()?.let { "HTTP $it" } ?: "unreachable" } }, tone = ButtonTone.PRIMARY, icon = "refresh")
                AxfButton("Sync now", { actions.dispatch("{{ROUTE}}.sync") }, icon = "refresh")
            }
        }
''')},
  web=web(view_body='''  const [result, setResult] = useState('not checked');
''', register="    rt.actions.register('{{ROUTE}}.sync', () => rt.toast('Sync for {{LABEL}} is not implemented yet.'), { label: 'Sync {{LABEL}}' });\n").replace('<__BODY__/>', '''<Container title="Connection" icon="cloud"><p className="fx-mono" style={{ marginTop: 0 }}>{{P_BASE_URL}}</p><p>{result}</p><Button tone="primary" icon="refresh" onClick={() => fetch('{{P_BASE_URL}}').then((r) => setResult(`HTTP ${r.status}`), () => setResult('unreachable'))}>Check connection</Button></Container>'''),
  py=py(service='''
import urllib.request


class {{CLASS}}Client:
    def __init__(self, base_url: str = "{{P_BASE_URL}}") -> None:
        self.base_url = base_url

    def ping(self) -> int | None:
        try:
            with urllib.request.urlopen(self.base_url, timeout=10) as r:
                return r.status
        except Exception:
            return None
''', register='    kernel.register_service("{{MODULE_ID}}.client", {{CLASS}}Client())\n'))

# ---------------------------------------------------------------- ui-kit
UK_KT = '''package {{PACKAGE}}

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
'''
UK_MOD = '''package {{PACKAGE}}

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ExtensionPoints
import ai.amberx.axf.kernel.module.ModuleContext

/** Registers {{CLASS}}Kit at the ui-kits extension point. Generated from the `{{TEMPLATE}}` library template. */
public class {{CLASS}}Module : BaseModule(ID, "{{LABEL}}") {
    override val provides: List<Capability> = listOf(Capability(ID, "{{DESCRIPTION}}"))
    override fun register(ctx: ModuleContext) { ctx.extensions.contribute(ExtensionPoints.UI_KITS, id, {{CLASS}}Kit) }
    public companion object { public const val ID: String = "{{MODULE_ID}}" }
}
'''
T['ui-kit'] = dict(name='UI kit', category='Screens & UI', icon='grid',
  description='A hot-swappable UI kit: component overrides on top of the default kit, registered at the ui-kits extension point. Kinds it skips fall back automatically.',
  produces=['AxfUiKit + overrides', 'Kit module'], params=[{'key':'library','label':'Library it wraps','type':'text','default':'androidx.compose.material3'}], deps=[], gradle='',
  android={'Kit.kt': UK_KT, 'Module.kt': UK_MOD},
  web='''import type { ComponentType, ReactNode } from 'react';
import type { AxfWebLibrary } from '../../react/library';

/** {{LABEL}} — a UI kit for the web port: component overrides keyed by kind. Kinds it leaves out use the built-in AXF components. */
export interface {{CLASS}}KitComponents { Button?: ComponentType<{ children?: ReactNode; onClick?: () => void }> }
export const {{CLASS_LOWER}}Kit: { id: string; library: string; components: {{CLASS}}KitComponents } = { id: '{{SLUG}}', library: '{{P_LIBRARY}}', components: {} };

export const library: AxfWebLibrary = {
  id: '{{MODULE_ID}}',
  label: '{{LABEL}}',
  version: '{{VERSION}}',
  template: '{{TEMPLATE}}',
  register(rt) { rt.terminal.log('ui-kits', `${{{CLASS_LOWER}}Kit.id} available (wraps ${{{CLASS_LOWER}}Kit.library})`); },
};
''',
  py=py(service='''

class {{CLASS}}Kit:
    id = "{{SLUG}}"
    library = "{{P_LIBRARY}}"
    covers = ("BUTTON", "CHIP")
''', register='    kernel.contribute("ui-kits", "{{MODULE_ID}}", {{CLASS}}Kit())\n'))

# ---------------------------------------------------------------- background-worker
BW_KT = '''package {{PACKAGE}}

import ai.amberx.axf.kernel.contract.WorkOutcome
import ai.amberx.axf.kernel.contract.Worker

/** The job itself. Report progress, return Success / Retry / Failure; the scheduler (WorkManager on Android) runs it. */
public class {{CLASS}}Worker : Worker {
    override suspend fun run(input: String, progress: suspend (String) -> Unit): WorkOutcome {
        progress("{{LABEL}}: working")
        return WorkOutcome.Success("{}")
    }
}
'''
T['background-worker'] = dict(name='Background worker', category='Services', icon='clock',
  description='A background job registered with the work registry, an interval setting and a Run-now action — sync, backups, cleanups, polling.',
  produces=['Worker', 'Worker registration', 'Interval setting', 'Run-now action'], params=[{'key':'interval','label':'Default interval (minutes)','type':'number','default':60,'min':15,'max':1440}], deps=[], gradle='',
  android={'Worker.kt': BW_KT,
           'Module.kt': module(extra_imports='import ai.amberx.axf.kernel.contract.WorkRegistry\n',
               settings='\n            SettingSpec("{{ROUTE}}.interval", "Run every (minutes)", SettingKind.NUMBER, default = JsonPrimitive({{P_INTERVAL}})),',
               body='''        ctx.service(WorkRegistry::class)?.register("{{ROUTE}}.run", {{CLASS}}Worker())
        ctx.extensions.contribute(ExtensionPoints.ACTIONS, id, ActionContribution("{{ROUTE}}.runNow", ActionMeta("Run {{LABEL}} now", module = id)) { _, _ -> runtime?.toast("{{LABEL}} queued — the scheduler is a placeholder until lib-work ships.") })
''', doc='Registers a worker with the work registry plus a Run-now action.'),
           'Screen.kt': screen(items='''        item {
            AxfCard(title = "Job", icon = "clock") {
                AxfText("Runs every {{P_INTERVAL}} minutes by default (setting {{ROUTE}}.interval).")
                AxfButton("Run now", { actions.dispatch("{{ROUTE}}.runNow") }, tone = ButtonTone.PRIMARY, icon = "play")
            }
        }
''')},
  web=web(register="    rt.actions.register('{{ROUTE}}.runNow', () => rt.terminal.log('{{ROUTE}}', 'run now (web: setInterval / service worker)'), { label: 'Run {{LABEL}} now' });\n").replace('<__BODY__/>', '''<Container title="Job" icon="clock"><p style={{ marginTop: 0 }}>Every {{P_INTERVAL}} minutes.</p><Button tone="primary" icon="play" onClick={() => rt.dispatch('{{ROUTE}}.runNow')}>Run now</Button></Container>'''),
  py=py(service='''

class {{CLASS}}Worker:
    interval_minutes = {{P_INTERVAL}}

    def run(self, payload: str = "{}") -> str:
        return "{}"
''', register='    kernel.contribute("workers", "{{MODULE_ID}}", {"id": "{{ROUTE}}.run", "worker": {{CLASS}}Worker()})\n'))

# ---------------------------------------------------------------- blank
BL_MOD = '''package {{PACKAGE}}

import ai.amberx.axf.kernel.module.BaseModule
import ai.amberx.axf.kernel.module.Capability
import ai.amberx.axf.kernel.module.ModuleContext

/** {{LABEL}} — generated from the `{{TEMPLATE}}` library template. Contribute routes, actions, settings or services in register(). */
public class {{CLASS}}Module : BaseModule(ID, "{{LABEL}}") {
    override val provides: List<Capability> = listOf(Capability(ID, "{{DESCRIPTION}}"))
    override fun register(ctx: ModuleContext) { }
    public companion object { public const val ID: String = "{{MODULE_ID}}" }
}
'''
T['blank'] = dict(name='Blank', category='Starter', icon='box', description='An empty module that registers nothing yet — for libraries that fit no other template.',
  produces=['Module'], params=[], deps=[], gradle='', android={'Module.kt': BL_MOD},
  web='''import type { AxfWebLibrary } from '../../react/library';

/** {{LABEL}} — generated from the `{{TEMPLATE}}` library template. */
export const library: AxfWebLibrary = { id: '{{MODULE_ID}}', label: '{{LABEL}}', version: '{{VERSION}}', template: '{{TEMPLATE}}' };
''', py=py())

# ---------------------------------------------------------------- write
for tid, t in T.items():
    d = os.path.join(HERE, tid)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(os.path.join(d, 'android', 'kotlin')); os.makedirs(os.path.join(d, 'web')); os.makedirs(os.path.join(d, 'python'))
    meta = {k: t[k] for k in ('name', 'category', 'icon', 'description', 'produces', 'params', 'deps')}
    meta.update({'$axf': 'library-template@1', 'id': tid, 'ports': ['android', 'web', 'python']})
    json.dump(meta, open(os.path.join(d, 'template.json'), 'w'), indent=2)
    open(os.path.join(d, 'android', 'build.gradle.kts'), 'w').write(GRADLE % t['gradle'])
    open(os.path.join(d, 'android', 'AndroidManifest.xml'), 'w').write(MANIFEST)
    for name, body in t['android'].items():
        open(os.path.join(d, 'android', 'kotlin', '{{CLASS}}' + name), 'w').write(body)
    open(os.path.join(d, 'web', 'index.tsx'), 'w').write(t['web'])
    open(os.path.join(d, 'python', '__init__.py'), 'w').write(t['py'])
json.dump({'$axf': 'library-templates@1', 'items': [{'id': k, 'name': v['name'], 'category': v['category']} for k, v in T.items()]}, open(os.path.join(HERE, 'index.json'), 'w'), indent=2)
print(len(T), 'templates')
