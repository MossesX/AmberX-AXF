# Molly

One interface for **AmberX**, **axHub** and the **Dev Console**, at https://molly.amberxai.com (build `molly-opus`,
Big Dog profile, Opus; a Fable version comes later as its own build).

- Each app stays its own app at its own address (`amberx.amberxai.com`, `axhub.amberxai.com`, `console.amberxai.com`,
  `expenses.amberxai.com`) and runs exactly the same on its own. **Inside Molly every app mounts natively**
  (`src/molly/native.tsx`, shell-surface@1, build molly-one-shell): Molly imports the app's surface module
  (`<app address>/surface/<app>-surface.js`, built by the app's `vite.surface.config.ts` from its `src/surface.tsx` on
  `framework/react/nativeSurface.tsx`) and shows its screens in Molly's own page, under Molly's one banner, menu, nav and
  settings. **No frames, no embedding** (Brett, Nov 8 2026). An app's relative API paths go back to its own server.
  Expenses is a Next.js app, so its module is a Molly plugin instead (`plugins/expenses`, below).
- Deep links: `#/<app>/<screen>` (for example `#/console/plan`) open straight on that app's screen.
- The look comes from axHub only (`developer.hub`), like every app; Molly ships the shared asset set at `src/axf/assets`.
  The apps mounted in Molly inherit Molly's look (their runtime is `hosted`). Molly's own assets are its nav menu, app
  menu and toolbar (`src/assets/*/molly.json`). The app list is `src/molly/apps.ts`.
- **Modules** (`src/molly/native.tsx` + `src/molly/Modules.tsx`, build convert-every-app-into-a-molly-module): every app
  is a module: its manifest is its `src/molly/apps.ts` entry (id, label, own address, sign-in) plus the surface it
  brings (screens, actions, settings, dialogs). A module comes from the app's own server (`surface`) or in-process from
  a Molly plugin (`provideModule`). Each one is fenced: `molly.modules.<app>.enabled` switches it off (it then opens on
  its own), `molly.modules.<app>.surface` loads it from another address (https or localhost; the older
  `localStorage['molly.surface.<app>']` still works), a load that hangs fails after 20 s, and every call into it runs
  guarded with its screen in an error boundary, so a module that throws shows its own Try again card and the rest of
  Molly keeps going. The Modules screen (`#/modules`, View → Modules) and Settings → Modules; actions
  `molly.modules.open` / `list` / `status:<app>` / `enable:<app>` / `disable:<app>` / `reload[:<app>]` /
  `surface:<app>:<url|default>`. Check: `npx -y tsx framework/spec/check-molly-modules.mts`.

- **Credentials** (`src/molly/credentials.ts`, molly-credentials@1): per app, the API base in force and the provider
  that signs a call, so a native screen reaches an app's backend from Molly's address without knowing its sign-in:
  the Console by its token (kept in this browser for Molly's origin), axHub by the browser's hub session (CSRF on
  writes), Expenses by its session or a pasted API token, AmberX nothing. `mollyApi(app)` / `mollyFetch(app, path)`
  from `src/molly/host.ts`; `molly.auth.<app>.base` overrides a base; a plugin may supply a provider
  (`setAuthProvider`). Actions `molly.auth.status` / `check` / `sign-in` / `sign-out` / `base` do everything without
  a screen. Today each app's server still has to allow Molly's origin (listed as their own builds).
- **App connections** (`src/molly/Connections.tsx`): the one sign-in screen, in the systems check's look (a row per app:
  status, how it signs in, one line; open a row to paste a token, sign in on the app's page, sign out or check again),
  and Settings → App connections (status, API addresses). Deep link `#/connections[/<app>]`, `molly.auth.open[:app]`,
  navigation and the Molly menu; every button runs a `molly.auth.*` action (`molly.auth.user:<app>[:name]` sets the user
  an Expenses token acts as).
- **Plugins** live in `plugins/<folder>/` (found by folder: `plugins/*/web/index.tsx` exporting `plugin`; deleting a
  folder removes it) and change Molly only through `src/molly/host.ts` (what an app's view shows, extra views, capability services).
- **xLayout** (`plugins/xlayout`, asset `src/assets/xlayout/molly.json`): Molly as ONE app. IDE mode puts the apps' screens in
  draggable, resizable, dockable panes (ten preset layouts with a preview, pane limit); drag any item from Go to anything
  onto a pane to open it there; each pane can be a tab group (right-click its tabs → Tab group on / off); three toolbars
  (show / hide, edge). Settings → Plugins → xLayout. <!-- axf-plugin:xlayout -->
- **Toolbar designer** (`plugins/toolbar-designer`, capability `axf.toolbar-designer@1`): picks what each toolbar holds
  from every app and screen and where each item opens (main area, floating window, pane); from its settings tab, View
  → Toolbar designer and right-click on any toolbar. <!-- axf-plugin:toolbar-designer -->
- **One shell** (`plugins/shell`): Molly as the one shell for every app. One menu over every app's screens, plugins,
  actions and settings (application menu → Go, Go to anything with `Ctrl+K`: grouped by app and category, slim sliding
  sub menus, search, favorites, recent), built from each app's registry (shell-surface@1 → menu-index@1) so a new plugin
  appears by itself; layout modes (one at a time, tabs, side by side, IDE) and named layouts; capability
  `axf.shell@1` for native app mounts. Settings → Plugins → One shell. <!-- axf-plugin:shell -->
- **Banners** (`plugins/banners`): Molly's one banner region. The Dev Console's live banners mount natively (its
  surface's reserved part `axf-banners`) in Molly's `app.frame.banners` slot; a screen a banner opens shows in Molly.
  Settings → Plugins → Banners (show the banners; each banner's own Banner settings). <!-- axf-plugin:banners -->
- **Expenses** (`plugins/expenses`): the Expense Tracker's Molly module. Its ledger (spent / income / net, newest
  entries, search) and Add entry drawn by Molly over the Expenses API with Molly's one sign-in; deep links
  `#/expenses`, `#/expenses/add`; actions `expenses.list` / `totals` / `add:<amount>:<merchant>[:…]` / `open[:add]`.
  Removing the folder puts Expenses back to opening on its own. <!-- axf-plugin:expenses -->

```bash
npm install && npm run dev      # :5173
docker build -t molly . && docker run -p 7490:8080 molly
```
