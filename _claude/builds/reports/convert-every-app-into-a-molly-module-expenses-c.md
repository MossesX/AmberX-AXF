# Convert every app into a Molly module (`convert-every-app-into-a-molly-module-expenses-c`)

Brett (Nov 10 2026, 21:34): "Can we convert the apps to modules then?"

Branch `claude/convert-every-app-into-a-molly-module-expenses-c`, Opus, headless, one session. Phase 1: s1, s2, s3.

## Base

The two builds this one waits on are built but not merged: `molly-one-shell` (#395, the native mount seam
shell-surface@1) and `molly-sign-in-once` (#477, the credential seam). This branch merges both, so **it lands after
#395 and #477** (or carries them if it lands first). Merge conflicts resolved:

- baked framework copies (`apps/{molly,axhub-web,console-web}/axf.lock.json`, `apps/molly/src/axf/core/types.ts`):
  union of the two sides' optional asset types (`skin` from main + `demonstration`/`book`/`clip`/`docs` from #395); the
  baked `types.ts` is now byte-equal to `framework/core/types.ts`; lock hashes rewritten from the files on disk;
- `apps/molly/src/{App,main,actions}.tsx`, `molly.css`, `android.yml`: #395's native mount (no frames) plus #477's
  credentials and App connections; #477's `FrameDeck` references dropped (#395 removed frames).

## What was built

**s1: every app is a fenced Molly module** (`apps/molly/src/molly/native.tsx`, `Modules.tsx`)

- A module's manifest is its `src/molly/apps.ts` entry (id, label, icon, own address, sign-in) plus the surface it
  brings (screens, actions, settings, dialogs, routes). Console, axHub and AmberX load from their own servers
  (`/surface/<app>-surface.js`, from #395). New: a Molly plugin can provide an app's module **in-process**
  (`provideModule(owner, app, module)`); removing the plugin puts the server module (or "opens on its own") back.
- Isolation: a module load that hangs fails after 20 s; every call into a module (`screens`, `searchEntries`, `run`,
  `subscribe`, `connect`, `mountSurface`, `show`, `unmount`, `render`) is guarded; its screen renders inside an error
  boundary. A module that throws is marked *Stopped* with what broke, Molly logs which one, and its view shows Try
  again / Open on its own. Everything else keeps running (the desktop shot shows it: three server modules unreachable
  offline, Expenses running).
- Own settings: `molly.modules.<app>.enabled` (switch a module off: it unmounts, leaves the menus, opens on its own)
  and `molly.modules.<app>.surface` (load it from another https/localhost address; the old
  `localStorage['molly.surface.<app>']` still works).
- Modules screen (`#/modules`, View → Modules) and Settings → Modules: per module its state, source, sign-in, screens,
  on/off switch, Reload / Try again, Open, Open on its own; address field in Settings.
- **Expenses module** (`apps/molly/plugins/expenses`, plugin@1 with install/uninstall/help/commands): Expenses is a
  Next.js 16 app whose screens can't mount in Molly's React page, so its module is a Molly plugin that draws the
  ledger (spent / income / net, newest 50 entries, search) and Add entry with framework controls over
  `/api/expenses/v1`, signing in through #477's seam (app `expenses`). The standalone app is untouched.

**s2: the same reach without the UI** (Brett's sentence as its own step; it repeats s1, so it went on API reach)

- Actions: `molly.modules.open | list | status:<app> | enable:<app> | disable:<app> | reload[:<app>] |
  surface:<app>:<url|default>`; `expenses.open[:add] | list[:words] | totals | add:<amount>:<merchant>[:<category>[:<account>]]`.
  `list`/`status`/`totals` return data.
- CLI: `axf molly modules`, `axf molly module status|on|off|reload <app>`, `axf molly module address <app> <url|default>`,
  `axf molly expenses list [words] | totals | add <spec> | open [add]`.
- The Expenses plugin's `plugin.json` lists its commands (plugin-commands@1).

## How each part is reached

| Part | Deep link / UI | REST / MCP | CLI | Voice |
|---|---|---|---|---|
| Modules screen + settings | `#/modules`, View → Modules, Settings → Modules | console action `host:molly.modules.*` (control@1 `console.actions`, the host bridge from #395) | `axf molly modules`, `axf molly module …` | Gizmo / console commands via `host:`; no dedicated AmberX phrase yet |
| Expenses module | `#/expenses`, `#/expenses/add`, View → Add an expense | `host:expenses.*`; Expenses' own `/api/expenses/v1` + its 7 MCP tools are unchanged | `axf molly expenses …` | same as above |

The `host:` route needs a Molly with the Console module running (that is how #395 reaches Molly). Molly as its own
relay client is the open build `molly-gap-remote-actions`.

## Checks

- `npx -y tsx framework/spec/check-molly-modules.mts`: 48 checks (in CI, `android.yml`)
- `npx -y tsx framework/spec/check-molly-credentials.mts`: 148 (updated for the new `modules` page link)
- `npx -y tsx framework/spec/check-shell-surface.mts`: 271
- `node apps/molly/test.mjs`: CLI checks pass
- `cd apps/molly && npx tsc --noEmit -p . && npm run build`: clean
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass
- `AXF_PLUGINS_DIR=apps/molly/plugins node framework/cli/plugin-lifecycle.mjs check expenses`: clean

## Shots

`modules-{desktop,phone}.png`, `expenses-{desktop,phone}.png`, `expenses-add-{desktop,phone}.png` in this folder.
Taken from a local `vite preview` build with axHub's look and the Expenses API stubbed (sample rows; the 524 count is
stub data).

## Left / gaps

- Not live: lands after #395 and #477, then redeploy Molly. Expenses' server must allow Molly's origin (CORS) for the
  module to read the ledger from molly.amberxai.com. That is #477's open item for every app's backend.
- `molly-native-expenses` (pending gap build) is covered in part: ledger + Add entry are native. Paydays, reports,
  receipts and the assistant still open on the standalone app.
- Voice: no dedicated AmberX phrases for `molly.modules.*` / `expenses.*`. They are reached through Gizmo and the console
  command path.
- The console's own plugins, axHub screens and AmberX screens are modules through their surfaces (#395). Each console
  plugin is not split into its own Molly module. Per-plugin isolation inside the console module is the console's own
  plugin loader.
