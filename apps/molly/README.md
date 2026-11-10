# Molly

One interface for **AmberX**, **axHub** and the **Dev Console**, at https://molly.amberxai.com (shell: build
`molly-opus`, Opus; Fable version: build `molly-fable-version-the-one-interface-for-amberx`, Nov 10 2026, which added
molly-shell@1: app instances as tabs, every app's widgets, and the whole shell on the console API / MCP / CLI / voice).

- Each app stays its own app at its own address (`amberx.amberxai.com`, `axhub.amberxai.com`, `console.amberxai.com`,
  `expenses.amberxai.com`)
  and runs exactly the same on its own. Without plugins Molly only frames that address (plain URL, nothing hidden or
  merged); with xLayout the frames carry the embed@1 marker and Molly merges their chrome (below).
- Frames are kept alive (`src/molly/FrameDeck.tsx`): switching apps never reloads them. Reload or open the one on screen
  on its own from the Molly menu or toolbar.
- Deep links: `#/<app>/<route>` (for example `#/console/builds`) open straight on that app's route.
- **Tabs / instances** (molly-shell@1, `framework/core/engines/molly-shell.ts`): an app may be open more than once.
  The first copy is the app's own view (`console`), the next ones `console#2`, `console#3`… (eight per app), each its own
  kept-alive frame and view ("Console 2"); a deep link may name one (`#/console#2/builds`). Molly menu → Tabs → New tab
  (a nested menu: another copy of this app, or any app), Next tab, Close this tab, What is open; actions `molly.new-tab`,
  `molly.close-tab`, `molly.next-tab`, `molly.switch`, `molly.state`. In IDE mode every copy is a dock tab; closing one
  closes the other. The open list is kept per browser tab (session storage).
- The look comes from axHub only (`developer.hub`), like every app; Molly ships the shared asset set at `src/axf/assets`.
  Its own assets are its nav menu, app menu and toolbar (`src/assets/*/molly.json`). The app list is `src/molly/apps.ts`.
- The only changes outside this folder: axHub web's and AmberX's `frame-ancestors` now allow `https://molly.amberxai.com`.

- **Plugins** live in `plugins/<folder>/` (found by folder: `plugins/*/web/index.tsx` exporting `plugin`; deleting a
  folder removes it) and change Molly only through `src/molly/host.ts` (frame address, frame mount, what an app's view
  shows, extra views, capability services).
- **xLayout** (`plugins/xlayout`, asset `src/assets/xlayout/molly.json`): Molly as ONE app. The apps hide their banner,
  application menu, navigation, context menu and toolbar and send them as data; Molly shows one menu bar (a menu per
  app), one navigation (a section per app), one context menu (a right-click inside an app opens it too) and their
  toolbars. IDE mode puts the apps in draggable, resizable, dockable panes (ten preset layouts with a preview, pane
  limit); three toolbars (show / hide, edge). Settings → Plugins → xLayout. <!-- axf-plugin:xlayout -->
- **Toolbar designer** (`plugins/toolbar-designer`, capability `axf.toolbar-designer@1`): picks what each toolbar holds
  from every app and screen and where each item opens (main area, floating window, pane); from its settings tab, View
  → Toolbar designer and right-click on any toolbar. <!-- axf-plugin:toolbar-designer -->
- **Banners** (`plugins/banners`): Molly's one banner region. The Dev Console draws its own live banners and banner chips
  in a strip (its banner-strip page, `framework/react/bannerStrip.ts`) in Molly's `app.frame.banners` slot; a dialog or
  menu it opens covers Molly's window, a view it opens opens in the console's frame. Settings → Plugins → Banners
  (show the strip, show / hide each banner). <!-- axf-plugin:banners -->
- **Molly control** (`plugins/control`): every Molly screen, tab, settings tab, dialog and action reachable without the
  UI. Molly hands the console inside it its catalog (embed@1 `host-catalog`, molly-shell@1); the console announces it
  with its own, so `axf console open "console 2"`, `axf console action molly.new-tab console`, the MCP tools
  (`console_open`, `console_action`, `console_list`, `console_where`), REST `POST /api/console/open` and voice through
  AmberX reach Molly, and the console carries each command back up (`host-run`). `axf console where` answers with the
  console's screen and Molly's. Settings → Plugins → Molly control. <!-- axf-plugin:control -->

```bash
npm install && npm run dev      # :5173
docker build -t molly . && docker run -p 7490:8080 molly
```
