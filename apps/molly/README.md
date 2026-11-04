# Molly

One interface for **AmberX**, **axHub** and the **Dev Console**, at https://molly.amberxai.com (build `molly-opus`,
Big Dog profile, Opus; a Fable version comes later as its own build).

- Each app stays its own app at its own address (`amberx.amberxai.com`, `axhub.amberxai.com`, `console.amberxai.com`,
  `expenses.amberxai.com`)
  and runs exactly the same on its own. Without plugins Molly only frames that address (plain URL, nothing hidden or
  merged); with xLayout the frames carry the embed@1 marker and Molly merges their chrome (below).
- Frames are kept alive (`src/molly/FrameDeck.tsx`): switching apps never reloads them. Reload or open the one on screen
  on its own from the Molly menu or toolbar.
- Deep links: `#/<app>/<route>` (for example `#/console/builds`) open straight on that app's route.
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

- **Voice control** (`plugins/voice-control`, capability `axf.voice@1`): control every app by voice from Molly. Tap the mic (toolbar, Molly menu) or type: "add 12.50 dunkin food", "list expenses", "open builds", "what can I say in Expenses?". Molly sends it to the Console frame, whose Voice commands plugin matches it against every app's voice commands (voice-command@1), asks when a slot is missing or the command deletes, runs it and answers (spoken back). A listener inside a framed app can hand Molly what it heard (voice-bridge@1 `utterance`). Settings → Plugins → Voice control. <!-- axf-plugin:voice-control -->

```bash
npm install && npm run dev      # :5173
docker build -t molly . && docker run -p 7490:8080 molly
```
