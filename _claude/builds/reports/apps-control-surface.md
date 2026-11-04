# Apps control surface: every app on the API, MCP and CLI (`apps-control-surface`, Current, Fable)

Brett, Nov 3 2026 (voice, addendum to `molly-console-commands`): "Put EVERY app on the API, MCP and CLI" (Molly, axHub web,
AmberX, every future app via the framework template; plus an `apps_list` read). Nov 4 2026: Amber couldn't open AmberX's
notes / to-dos for him because the console has no AmberX screen and AmberX had no control surface: "All right, move that to
next in queue." Agent: Ping Paulie. Branch `claude/apps-control-surface`. Finishes `molly-console-commands` s6–s7 (#288
report: "Not done yet: s6-s7").

## What changed

**s1 (Fable) — the contract.** The Console commands engine (`framework/core/engines/console-commands.mjs`) is now every app's
control surface, not the console's alone:

- **control@1 `apps` domain** (`framework/core/engines/control-rules.mjs`, appended after `tokens.nav`): `apps.list` (every app, its
  clients online, how many screens / dialogs / settings / actions it reports; `select.q`, `select.online`), `apps.screens`,
  `apps.dialogs`, `apps.settings`, `apps.actions`, `apps.nav`, `apps.clients`. They are `console.*` with the app picked by
  `input.app` (act, get) or `select.app` (list): an id, label or alias. Permissions `control.apps.read | navigate | write | delete`.
  `console.*` = `apps.*` with the app fixed to the Dev Console. 30 targets, 7 domains. Snapshot `framework/schemas/control.json` and
  fixture `spec/fixtures/control.json` regenerated (12 new fixture commands, role `app-navigator`).
- **Apps registry** `framework/schemas/apps.json` (apps@1): Dev Console (`axf-console`), AmberX (`amberx-droid`), axHub web
  (`axhub-web`), Molly (`molly`), each with label, address, kind and aliases (`amberx`, `hub`, `molly`, `console`…). An app not
  listed still works the moment its client connects (it shows under its own id); listing gives it a name, a wake address and a
  row in `apps_list` while closed.
- **Engine:** `clientAppId` (a hosted client `molly/<app>` is that app; the console's old `console-web` id is the console),
  `resolveAppId` (id / alias / label → id), `consolePickClients(clients, to, now, app)` (recent = that app's client in front, else
  used last; other apps never match), `appsList` / `appSummary`, `commandApp`, messages carry `app`, `here.extra` (what an app
  adds: Molly's app on screen), `consoleCatalogFrom(…, { items })` (an app's own items), action permissions per domain, confirm
  tokens for destructive app actions bound to the app. No client of the app: `noConsole: true` with the app, its label and `url`
  (the broker wakes that address). Wire frames unchanged (`console-catalog@1`, `console-command@1`).
- **Framework library `framework/libs/control-surface`** (`ai.amberx.axf.control-surface`): `client.ts` (no React) is the
  Console commands client generalised — hello with the app's catalog (search index + settings tabs + action bus + the app's own
  items), heartbeats, stream, runs messages through the runtime, acks; host-aware (`<host>/<app>`, `front`, `bringToFront`); wake
  pick-up (`?axf-cmd=`); run-once per tab. `index.tsx` → `controlSurfaceLibrary` / `createControlSurfaceLibrary({ app?, transport?,
  extraItems?, extraHere?, run?, keys? })`, starts in `register`, Settings → Plugins → Remote control (on/off per device, toast),
  help entries. `library.json` (library@1). Type-checks with `npm run check:libs`.
- Spec: `framework/spec/CONTROL.md` → **Apps** (+ Follow Amber `app`); `framework/spec/PORTING.md` deferred Kotlin twin
  (`ControlSurfaceClient`); `framework/libs/README.md` section.

**s2 (Opus steps, same session) — the broker.** `apps/console-web/plugins/console-commands`:

- Server: catalogs remembered **per app** (audience → app → catalog; the early check against remembered catalogs feeds them
  all to the runner, which picks the command's app); the queue entry carries `app`, `label`, `url`; the wake opens **that app's
  address** with `?axf-cmd=<id>` (once per app per 45 s), `wake.py` takes a label for the veto notice ("Open AmberX on Brett's
  phone"); `hello` validates `app`; REST `GET /apps`, `POST /app/{open,dialog,settings,action,back,home,close}` (each takes
  `app`, `to`), `GET /app/{where,list,clients}`; `recent` rows carry `app`; capability `apps()`. Mounted at `/api/console` and the
  plugin mount as before.
- Runner + CLI `console.mjs`: loads the registry, runs the `console` and `apps` domains, `axf app <app> open|dialog|settings|
  action|back|home|close|where|list|clients …`, `axf apps [words] [--online]`; answers name the app. `framework/cli/axf.mjs`
  routes `app` / `apps` to it.
- MCP (`apps/console-web/server/mcp_server.py`): `apps_list`, `app_open`, `app_dialog`, `app_settings`, `app_action`, `app_back`,
  `app_where`, `app_list`, `app_clients`, `app_show` (`APP_TOOLS`); `ControlTarget` takes the `apps.*` targets; the server
  instructions tell Amber. Opening / reading tools are read-only annotated (axHub runs them at once); `app_action` stays a write.
- Follow Amber (`follow-amber`): `console_show` / REST `show` take `app`; another app opens through `apps.*` with the grants
  `control.console.navigate` + `control.apps.navigate`; the console's follow client only shows the note when another app opened
  it (`show` frame carries `app`); approvals stay console-only.
- The console's own client (`web/index.tsx`) now runs on the library (`startControlSurface` with the plugin's transport and
  keys, app id `axf-console`); its settings page lists **Apps on the surface**, open clients of every app, waiting and last
  commands (help entry `cc-apps`). Plugin 0.3.0, builtWith fable (replaces opus).

**s3 — AmberX** (`apps/amberx-droid`): installs `createControlSurfaceLibrary` with its server proxy as the transport
(`/api/console/plugins/console-commands/…`, hub admins only, forwarded with the console token the server holds); the server
always forwards the `console-commands` folder. Screens (Approvals home, the plugins' Notes / To-dos / Lists / Inbox / Voice,
Settings tabs) and actions come from its own search index and action bus, so `app_show {app: 'amberx', target: 'to-dos'}` opens
them on the phone (the Android shell loads the same bundle; nothing new on the Android side). AmberX not open: the command is
queued and `amberx.open_url` opens `https://amberx.amberxai.com/?axf-cmd=<id>`. The `amberx_*` items tools are unchanged.

**s4 — Molly, axHub web, template, wall:**

- Molly: the library with `extraHere` (the app on screen: `here.extra.app` / `appLabel`), new action `molly.show:<app>`
  (navigation only). Its apps are already screens (views), xLayout's `xlayout.ide` / `xlayout.layout` / `xlayout.open`, the
  navigation and banners plugins' actions come through the catalog. Frames inside Molly keep their own surface (`molly/<app>`),
  nothing is relayed.
- axHub web: `controlSurfaceLibrary` (default transport: the console's `/api/console` with the browser's own hub session).
- Template `framework/templates/react-ts/src/App.tsx` installs it, so every `axf init` app is on the surface from day one.
- Console wall: `wall.same_site` (framework/python/axf_server/wall.py) + `SAME_SITE_CLIENT_ROUTES` in `main.py`: the control
  surface's **client routes only** (`hello`, `seen`, `ack`, `bye`) accept an https origin of the same registrable domain for an
  admin's browser session; every other write keeps same-origin. CORS `allow_credentials=True` (Starlette echoes the origin).
- Baked copies: `rebake.mjs apply` for `amberx-droid`, `axhub-web`, `molly` (control-surface + the engine + schemas; the only
  other drift was `libs/alerts/alerts-sw.js`); the console's `src/axf` got the changed files copied (CI re-bakes it anyway).

**s5 — voice:** the `app-voice-commands` build (running in parallel, Fable) owns the voice-command@1 rule and generator for
forFramework apps; it reads an app's API / MCP / CLI commands, so the `app_*` MCP tools, `/api/console/app/*` routes and `axf app`
CLI above are what it generates phrases from. Nothing duplicated here; `library.json` names the placeholder
`axf.control-surface.voice`.

## Tests

| Check | Before | After |
|---|---|---|
| `npx -y tsx framework/spec/check-console-commands.mts` | 66 | 100 (registry, aliases, hosted ids, app filter, apps.list, per-app recent/all/id, noConsole with address, confirm bound to the app, grants per domain) |
| `npx -y tsx framework/spec/check-control.mts` | 368 (23 targets) | 441 (30 targets, append-only kept) |
| `node apps/console-web/plugins/console-commands/test.mjs` | 7 | 8 (CLI `app` / `apps` words, runner on the apps domain, grants, noConsole from the registry) |
| `python …/console-commands/server/test_console_commands.py` | 72 | 88 (AmberX client, `/apps`, `/app/open` by alias, a console command never reaches AmberX, `/app/where|list|clients`, bad app id, queued command for a closed app wakes its own address) |
| `python apps/console-web/plugins/follow-amber/test.py` | 33 | 41 (`app`: apps targets + both navigate grants, REST, console words, noConsole, approvals console-only) |
| `python apps/console-web/server/test_mcp_tools.py` | — | 207 checks, 58 tools (10 app tools exist, read-only annotations, command shapes, `app_show`, instructions) |
| `python framework/python/axf_server/test.py` | 397 | 403 (`same_site`) |
| `node framework/spec/check-axf-server.mjs` | 90 | 90 |
| `tsc --noEmit` amberx-droid, axhub-web, molly, console-web; `tsc -p framework/libs/tsconfig.json` | pass | pass |
| `check-theme`, `check-controls`, `check-toolbars`, `plugin-lifecycle check console-commands`, `help-coverage`, `shared-assets check`, `axf validate --framework` | pass | pass |

`node framework/cli/plugins.mjs --check` fails on main already (asset-designer / asset-browser pending items), unrelated.

## Not done here / gaps

- **Live check of the cross-site path.** axHub web and Molly post to `console.amberxai.com/api/console/hello` with the hub
  cookie; the console accepts it (same-site client routes) and CORS echoes the origin. Whether axHub's sign-in wall (Traefik
  forwardAuth) passes the browser's CORS preflight (`OPTIONS`) is not verified here (no browser against the live containers in
  this session). If it doesn't, those two apps need an nginx proxy route to the console (AmberX's path, through its own server,
  does not depend on it). AmberX is the one Brett asked for first and is the robust path.
- Expenses and Gizmo live on unmerged PRs (#307, #296): they get the surface from the template / `rebake` when they rebase on
  main; not touched here.
- Kotlin `ControlSurfaceClient` for Android apps: deferred (Android on hold, PORTING.md). AmberX's Android shell carries the
  surface through its web bundle.
- `apps.json` is hand-kept; a new app the template builds is on the surface as soon as it connects but shows its id, not a
  label, until listed.
- UI Review: the only visible change is the console's Console commands settings page (an "Apps on the surface" list) and a
  "Remote control" sub-tab in every app's Settings → Plugins; no screenshots taken this session (no browser), so the PR says
  UI Review is pending for those two.
- Redeploy: merging to main redeploys the console (Coolify) and the apps pull their builds (AmberX, axHub web, Molly images
  rebuild from the repo); nothing manual queued here.
