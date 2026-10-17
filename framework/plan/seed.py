# Regenerates seed.json (the curated framework epics). Edit features in the console's Plan view instead once they exist.
import json
D='2026-10-17'
def F(id, title, area, status, summary, *, priority='P1', wave=1, kind='epic', effort='L', ports=None, caps=(), deps=(), catalog=(), modules=(), files=(), acceptance=(), warnings=(), recs=(), previews=(), shots=(), links=(), tags=(), notes='', history=()):
    return dict(id=id, title=title, area=area, kind=kind, status=status, priority=priority, wave=wave, effort=effort, summary=summary,
        ports=ports or {}, capabilities=list(caps), dependsOn=list(deps), catalog=list(catalog), modules=list(modules), files=list(files),
        acceptance=[{'text':a[0],'done':a[1]} if isinstance(a,tuple) else {'text':a,'done':False} for a in acceptance],
        warnings=[{'level':w[0],'text':w[1]} for w in warnings], recommendations=list(recs), previews=[{'kind':p[0],'ref':p[1],'label':p[2]} for p in previews],
        screenshots=[{'src':'media/'+s[0]+'.jpg','caption':s[1]} for s in shots], links=[{'label':l[0],'url':l[1]} for l in links],
        tags=list(tags), notes=notes, source='seed', history=[{'at':h[0],'text':h[1]} for h in history] or [{'at':D,'text':'Added to the plan'}])
def P(a=None,w=None,p=None):
    o={}
    if a: o['android']={'status':a[0],'where':a[1]}
    if w: o['web']={'status':w[0],'where':w[1]}
    if p: o['python']={'status':p[0],'where':p[1]}
    return o
R='https://github.com/MossesX/AmberX-AXF'
B=R+'/blob/main/'
feats=[
# ---------------- kernel & engines
F('x.kernel','Kernel (pure Kotlin + TypeScript core)','Kernel & engines','built','The framework core every app gets: asset registry, engines, runtime state, actions, module system. Pure Kotlin on Android (no Android imports, KMP-ready); framework/core on the web.',priority='P0',effort='XL',
  ports=P(('built','axf-kernel'),('built','framework/core'),('planned','—')),
  caps=['Hot-swappable assets for every visual slot','Runtime state with persistence of the user\'s choices','Kernel API level 1 with semver + deprecations','Explicit-API, KMP-ready Kotlin'],
  deps=['x.assets','x.engines','x.modules'],modules=['axf-kernel'],files=['framework/android/axf-kernel','framework/core'],
  acceptance=[('Compiles with explicit API strict',True),('KernelTest + ConformanceTest pass (7/7)',True),('Compiled in CI on every push',True),'Python port passes the same fixtures'],
  recs=['Keep the kernel free of Android imports so a Kotlin Multiplatform desktop port stays possible','Bump API_LEVEL only for breaking contract changes; add capabilities instead'],
  links=[('Kernel source',B+'framework/android/axf-kernel'),('CI runs',R+'/actions/workflows/android.yml')],tags=['foundation'],
  history=[('2026-10-16','Ported from the web core to Kotlin'),('2026-10-16','First real compile: 0 kernel errors; fixed JS number formatting for conformance'),('2026-10-17','Verified green in CI')]),
F('x.assets','Asset system (asset@1, 13 core types, open registry)','Kernel & engines','built','Every visual is a JSON asset (color theme, style theme, layout, menus, toolbar, nav, context menu, dialog, popup, button, slider, container, UAC policy). Ports read the same files; new types register at runtime.',priority='P0',
  ports=P(('built','axf-kernel/asset'),('built','framework/core'),('planned','—')),
  caps=['Validation shared by every port (schemas/asset-types.json)','Import/export single assets and bundles','Android-only optional types (ui-kit, window, screen-template, icon/string/image/font/motion packs…)','Swap, randomize, reset'],
  files=['framework/schemas','framework/assets','framework/android/assets'],acceptance=[('41 shared assets validate',True),('Android port loads every shared asset',True)],tags=['foundation']),
F('x.engines','Engines: theme, layout, component styles, UAC, context menu, actions','Kernel & engines','built','Compile assets into tokens and behaviour: theme tokens (core + extended), layouts per window class, component styles, role-based access, context menus per target, action bus with interceptors.',priority='P0',
  ports=P(('built','axf-kernel/engine'),('built','framework/core/engines'),('planned','—')),deps=['x.assets'],
  acceptance=[('Theme CSS variables match the reference engine byte for byte',True),('Layouts compile for COMPACT / MEDIUM / EXPANDED',True)],tags=['foundation']),
F('x.conformance','Porting spec + conformance fixtures','Kernel & engines','built','framework/spec: PORTING.md plus generated fixtures every port must reproduce exactly (theme vars, layouts, component styles, UAC). The Android kernel passes them.',priority='P0',effort='M',
  ports=P(('built','ConformanceTest'),('built','gen-fixtures.mts (reference)'),('planned','—')),files=['framework/spec'],
  recs=['Run the fixtures first when starting the Python port — they define "done" for each engine'],tags=['porting']),
F('x.modules','Module system: modules, extension points, services, placeholders','Kernel & engines','partial','Modules register screens, actions, settings, dialogs, services and UI kits through extension points, start in dependency order and can define their own extension points. Placeholders answer NotImplemented until a real module arrives.',priority='P0',
  ports=P(('built','axf-kernel/module'),('partial','framework/react/library.ts'),('partial','framework/python/axf/library.py')),deps=['x.kernel'],
  caps=['20 extension points (routes, actions, settings, dialogs, ui-kits, workers, plugin sources…)','Typed service registry','Topological start order','Add modules without rebuilding the kernel'],
  warnings=[('info','Web port: AxfWebLibrary contract + installLibraries (dependency order, merged views/dialogs/tabs); no extension points or placeholders yet'),('info','Python port: Library contract + MemoryKernel stand-in until the kernel is ported')],tags=['foundation','extensibility']),
F('x.state','State, data cache, events, flags, config, migrations','Kernel & engines','partial','AxfStore (reducer/middleware/undo), QueryClient (stale-while-revalidate), EventBus, layered FeatureFlags and Config, migrations ledger + semver.',
  ports=P(('built','axf-kernel'),('partial','runtime store only'),('planned','—')),deps=['x.kernel'],
  warnings=[('info','Web port has the runtime store but not QueryClient / flags / migrations')]),
F('x.windows','Windowing engine: tab groups, floating windows, split, minimize','Kernel & engines','built','Window schema (types, toolbar rules), tab groups that undock to floating windows, drag tabs between groups and windows, split vertical / horizontal / four-way / custom grid with even distribution (5 → 3+2), minimize to corner title bars (stacked or lined) or a floating toolbar at the cursor, window settings dialog, tree ↔ grid mode.',
  ports=P(('built','axf-kernel contract/Windows.kt + axf-ui windows'),('built','framework/core/engines/windows.ts + framework/react/windows'),('planned','—')),deps=['x.kernel'],
  previews=[('route','libraries','UI libraries → Compare')],shots=[('console-compare-windows','Compare window: 3 libraries split 2+1, grid view in the top group')],
  warnings=[('info','Divider dragging (split weights) and saved window layouts are suggested follow-ups')],recs=['Persist window layouts per app (ui.windows.persist)'],tags=['ui']),
F('x.terminal','Output terminal','Kernel & engines','built','One append-only log every install, import, hot swap and kit fallback writes to; auto-scrolling pane as a floating window, dock tab or dialog; follows the console API live over SSE.',effort='M',
  ports=P(('built','runtime.terminal + OutputTerminalPane'),('built','core/terminal.ts + OutputTerminal.tsx'),('planned','—')),deps=['x.windows'],shots=[('console-output-terminal','Output terminal docked in the console')]),
F('x.uikits','UI-kit switching + fallback','Kernel & engines','partial','Every component is an abstract kind; the active ui-kit asset picks which library renders it. Kinds a kit lacks fall back to the default AmberX kit and are noted on the output terminal.',
  ports=P(('built','Material3Kit, UnstyledKit, dispatchers'),('partial','single built-in kit'),('planned','Qt Widgets kit')),deps=['x.engines','x.terminal'],
  warnings=[('warn','Web port renders one kit only — MUI / shadcn / Chakra kits are planned')],previews=[('element','BUTTON','Button in the active kit'),('element','CHIP','Chips')]),
F('x.plugins','Plugin runtime (deliver features after install)','Kernel & engines','placeholder','plugin@1 manifest, scopes, action macros and a PluginLoader contract exist; loading plugins at runtime is a placeholder.',priority='P2',wave=2,
  ports=P(('placeholder','axf.plugins'),('planned','—'),('planned','—')),deps=['x.modules'],
  warnings=[('warn','On Android, plugins can only deliver assets, packs, scripts and macros after install — not compiled code')],
  recs=['Start with asset packs and action macros downloaded from the console API; they need no code loading']),
F('x.work','Background work scheduler','Kernel & engines','placeholder','WorkSpec / Worker / WorkRegistry contracts and a placeholder scheduler. Real implementation is WorkManager on Android.',priority='P2',wave=2,effort='M',
  ports=P(('placeholder','axf.work'),('planned','—'),('planned','—')),deps=['x.modules'],catalog=['k.scheduler','dv.bg']),
F('x.session','Session, principal, audit log','Kernel & engines','partial','Session/Principal/SessionProvider contracts and an AuditLog service; accounts library uses a mock auth provider.',priority='P2',
  ports=P(('partial','contract/Session.kt + lib-accounts (mock)'),('partial','AccountView'),('planned','—')),warnings=[('warn','No real sign-in provider yet')]),
# ---------------- android
F('x.android.modules','Android framework modules','Android port','built','axf-platform-android, axf-assets, axf-ui (Compose components, kits, element explorer, windows), axf-nav, axf-data, axf-network, axf-devtools, axf-testing. Published as ai.amberx.axf:<module>:0.2.0.',priority='P0',effort='XL',
  ports=P(('built','framework/android')),deps=['x.kernel'],modules=['axf-platform-android','axf-assets','axf-ui','axf-nav','axf-data','axf-network','axf-devtools','axf-testing'],
  acceptance=[('All modules compile in CI',True),('Published to GitHub Packages',True),'Run on a real device'],
  warnings=[('warn','Compiled and tested in CI but never opened on a real phone')],links=[('Packages',R+'/packages')],tags=['android'],
  history=[('2026-10-17','First real Android compile: 16 errors over 3 rounds, all fixed; green since 66c9e04')]),
F('x.libs.core','Libraries: settings, logging, admin, accounts, profile, billing','Android port','partial','The six libraries the console and apps build on. Settings and logging are complete; accounts and billing run on mock providers.',effort='XL',
  ports=P(('partial','lib-settings, lib-logging, lib-admin, lib-accounts, lib-profile, lib-billing'),('partial','AccountView only'),('planned','—')),deps=['x.android.modules'],
  catalog=['s.settings','l.log','a.admin','u.accounts','p.profile','b.subs'],warnings=[('warn','Accounts and billing use mock providers — no real sign-in or Play Billing yet')],recs=['Add the real providers as separate libraries so apps choose them per platform']),
F('x.libs.browser','Library browser (installable)','Android port','built','Floating tab-group browser as a library: two panes, multi-select, Compare → floating windows; binds to tab groups named in the app manifest; installed by a wizard.',effort='M',
  ports=P(('built','lib-browser'),('built','console UI libraries tab'),('planned','—')),deps=['x.windows','x.engine.install'],catalog=['lib.browser'],shots=[('console-compare-windows','Compare in floating windows')]),
F('x.android.showcase','Android showcase app (apps/console)','Android port','built','The first Android app: the console views on the Android port (tracker, catalog, libraries, boilerplates, element explorer). Builds a ~20 MB debug APK in CI.',effort='L',
  ports=P(('built','apps/console')),deps=['x.android.modules','x.libs.core'],acceptance=[('APK builds in CI',True),'Installed and opened on the S26'],
  warnings=[('warn','Never run on a device — download console-debug.apk from the latest green run and try it')],links=[('CI artifacts',R+'/actions/workflows/android.yml')]),
# ---------------- web
F('x.web.core','Web port: core + React components','Web port','built','framework/core + framework/react + framework/ui/axf.css: the original port, plain React 18 + TypeScript, no router.',priority='P0',
  ports=P(None,('built','framework/core, framework/react, framework/ui')),deps=['x.kernel']),
F('x.web.templates','Web templates: react-ts (Vite) and next-ts (Next.js 15)','Web port','built','axf init creates either a Vite SPA or a Next.js App Router app (static export by default) with the framework baked in.',effort='M',
  ports=P(None,('built','framework/templates/react-ts, next-ts')),deps=['x.web.core'],shots=[('next-ts-app','App created from next-ts, running')],acceptance=[('Both templates build in CI',True)]),
F('x.web.demo','Web demo site','Web port','built','apps/demo, published by CI to the site branch and served from the VPS.',effort='S',
  ports=P(None,('built','apps/demo')),deps=['x.web.core','x.deploy.site'],links=[('axf.amberxai.com','https://axf.amberxai.com')],
  warnings=[('warn','Moving from xaf to axf.amberxai.com needs install.sh re-run on the VPS; then delete the xaf DNS record')]),
# ---------------- python
F('x.python.port','Python / PyQt6 port','Python port','planned','Port the kernel engines to Python, pass the conformance fixtures, add a PyQt6 UI layer, a Qt Widgets kit and a pyqt6 app template.',priority='P1',wave=2,effort='XL',
  ports=P(None,None,('planned','framework/python')),deps=['x.conformance','x.kernel'],
  acceptance=['Engines pass all fixtures in framework/spec/fixtures','PyQt6 shell renders the shared assets','axf init --template pyqt6'],
  recs=['Port engines in fixture order: theme → layout → components → UAC','Use dataclasses mirroring the Kotlin models'],tags=['porting']),
# ---------------- build engine
F('x.engine.cli','Build engine CLI','Build engine','built','axf init / validate / list / new-asset / schemas / templates / new-module / new-demo / modules / boilerplates / dev / serve.',priority='P0',
  ports=P(None,('built','framework/cli')),files=['framework/cli/axf.mjs','framework/cli/build-engine.mjs'],acceptance=[('CI sweep: every template + 16 boilerplates init and validate',True)]),
F('x.engine.install','Library installer + interactive wizard','Build engine','built','Libraries ship a library.json (params, manifest key, install steps); axf install asks for the parameters and writes manifest, gradle, App.kt and typed <Name>Setup.kt. Also runs at pre-build via --libraries / boilerplate libraries.',effort='M',
  ports=P(None,('built','framework/cli/libraries.mjs')),deps=['x.engine.cli'],shots=[('console-install-wizard','Install wizard in the console')]),
F('x.engine.uiport','Import third-party UI libraries → AmberX kits','Build engine','partial','axf import-ui clones (git/local) or records (maven/npm) a library, rewrites literals and Material/MUI roles to AXF tokens, saves kit-<id> + its ui-kit asset and applies it to the open project.',effort='L',
  ports=P(('built','kit-<id> modules'),('built','framework/cli/ui-port.mjs'),('planned','—')),deps=['x.uikits','x.engine.install'],
  warnings=[('warn','The token codemod handles common Compose / MUI / CSS patterns only; untested on a real third-party library'),('info','Generated kits keep the default components until overrides are written')],
  recs=['Try it on Compose Cupertino first and review tokens.map.json']),
F('x.engine.dev','Live reload (axf dev) + device hot reload','Build engine','partial','axf dev watches assets and long-polls changes to devices; the Android HotReloader re-registers changed assets live.',effort='M',
  ports=P(('built','HotReloader'),('built','dev-server.mjs')),deps=['x.engine.cli'],warnings=[('warn','Never tried end to end with a phone')]),
F('x.librarytemplates','Library templates (build, port, compile new libraries)','Build engine','built','Boilerplates for libraries: feature screens, service provider, data feature, device capability, integration, UI kit, background worker, blank — generating Android, web and Python ports, compiling each, and porting a library to another port from its library.json.',priority='P1',effort='L',
  ports=P(('built','framework/library-templates/*/android → lib-<slug>'),('built','framework/libs/<slug>'),('built','framework/python/axf_libs/<slug>')),deps=['x.engine.install','x.modules'],
  caps=['8 templates: feature screens, service provider, data feature, device capability, integration, UI kit, background worker, blank','Generate any mix of Android / web / Python ports from one set of parameters','axf compile-library: Gradle (or CI) for Android, tsc for web, compileall + import smoke test for Python','axf port-library: add a missing port later from the library\'s template','Console: Libraries → Library templates (gallery, wizard, compile and port buttons)'],
  acceptance=[('Every template generates and compiles for web and Python',True),'Every template generates for Android and compiles in CI','A real library (e.g. GPS tracker) built from a template and run on a device'],
  warnings=[('info','Android compile needs the Android SDK; locally it reports "ci" and GitHub Actions compiles it')],
  history=[('2026-10-17','Built: 8 templates × 3 ports, CLI, API routes, console tab; web + Python verified, Android in CI')]),
# ---------------- console
F('x.console.web','Web Dev Console (React/TS)','Dev Console','built','apps/console-web: Home, Tracker, Catalog, Libraries (framework + UI), Boilerplates, Plan, Demos, Modules, Components, Assets, output terminal, floating windows.',priority='P0',effort='XL',
  ports=P(None,('built','apps/console-web')),deps=['x.web.core','x.windows'],shots=[('console-home','Home'),('console-boilerplates','Boilerplates with live preview')],
  warnings=[('warn','Not deployed yet — run deploy/install-console.sh on the VPS')],links=[('console.amberxai.com','https://console.amberxai.com')]),
F('x.console.api','Console API (Python FastAPI)','Dev Console','built','Runs the build engine for the console (init, install, import-ui, status edits, boilerplates, plan), streams the terminal over SSE, manages dev servers, serves the console and panel.',effort='L',
  ports=P(None,('built','apps/console-web/server')),deps=['x.engine.cli'],acceptance=[('Smoke-tested in CI (init + install through the engine)',True),'Running on the VPS']),
F('x.console.plan','Planning section','Dev Console','built','This view: every framework feature with capabilities, ports, dependencies, acceptance, screenshots, previews, warnings, recommendations and history; list and board views; auto warnings for blocked dependencies and port gaps.',effort='L',
  ports=P(None,('built','apps/console-web/src/views/Plan.tsx')),deps=['x.console.web','x.console.api'],shots=[('plan-section','Plan: epics list + feature detail'),('plan-board','Plan: board view')],history=[('2026-10-17','Added and loaded with the catalog plus framework epics')]),
F('x.console.panel','Server control panel','Dev Console','built','Dev servers start/stop with logs, CI downloads (APK, Maven, console dist), command catalog, live output and a terminal into the console container.',effort='M',
  ports=P(None,('built','deploy/panel')),deps=['x.console.api'],shots=[('server-panel','Server panel running against the API')],
  warnings=[('warn','The terminal is a shell inside the console container, not the VPS host'),('warn','The claude.ai copy is read-only — use console.amberxai.com/panel')]),
F('x.console.repo','Console in its own private repo','Dev Console','planned','Split apps/console-web into a private repo that depends on a tagged framework version.',priority='P3',wave=3,effort='M',deps=['x.console.web'],notes='User: not yet.'),
# ---------------- deploy
F('x.ci','CI: build, test, publish','Deploy & CI','built','GitHub Actions: build-engine sweep, kernel tests, every Android module, showcase APK, Maven repo artifact + GitHub Packages, web console + Python API smoke, next-ts build; compile errors posted to an issue.',priority='P0',effort='M',
  links=[('Workflow',R+'/actions/workflows/android.yml')],acceptance=[('Green on main',True)]),
F('x.deploy.console','Console deployment (install-console.sh)','Deploy & CI','partial','One command on the VPS builds the console + API + panel container behind Coolify Traefik with HTTPS at console.amberxai.com, prints AXF_TOKEN and auto-updates every 5 minutes.',priority='P0',effort='S',
  deps=['x.console.api'],warnings=[('error','Not run on the VPS yet — console.amberxai.com serves nothing'),('warn','Docker image never built (no Docker daemon in the build sandbox)')],
  recs=['Run: curl -fsSL https://raw.githubusercontent.com/MossesX/AmberX-AXF/main/deploy/install-console.sh | bash']),
F('x.deploy.site','Demo site deployment','Deploy & CI','built','CI publishes apps/demo to the site branch; the VPS pulls it every 2 minutes behind Traefik.',effort='S',warnings=[('warn','Domain rename to axf.amberxai.com pending on the VPS')]),
# ---------------- showcase (wave 2)
F('x.showcase.packs','10 layouts, 10 light/dark theme pairs, 10 style packs','Showcase','planned','The showcase asset packs the first app was originally scoped for.',priority='P2',wave=2,effort='L',deps=['x.assets'],catalog=[]),
]
for lid,label,cats in [('media','Media (video, audio, streaming, camera)',['dv.media','dv.stream','c.video','c.vpsstream']),('location','Location (GPS, maps, trails)',['dv.loc','dv.maps','c.gps']),('editor','Editors (rich text, markdown, code)',['ui.editor','c.texteditor']),('ai','AI assistant (Claude, MCP)',['w.ai','w.mcp','c.ai']),('vps','VPS & deploy',['w.vps','w.coolify','c.deploy']),('github','GitHub',['w.github','cx.github']),('notifications','Notifications & push',['dv.notif','w.push']),('sensors','Sensors & connectivity',['dv.sensors','dv.ble','dv.nfc']),('files','Files & sync',['d.files','d.sync']),('charts','Charts & tables',['ui.charts','ui.tables'])]:
    feats.append(F(f'x.lib.{lid}',f'Library: {label}','Showcase','planned',f'Library lib-{lid} with a demo app; covers {", ".join(cats)}.',priority='P2',wave=2,effort='L',
        ports=P(('planned',f'lib-{lid}'),('planned','—'),('planned','—')),deps=['x.android.modules','x.librarytemplates'],catalog=cats))
json.dump({'$axf':'plan-seed@1','features':feats},open(__import__('os').path.join(__import__('os').path.dirname(__file__),'seed.json'),'w'),indent=1)
print(len(feats))
