<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-web-settings-notify.md tokens=536 -->
## Added — embed@1 extension: what a host takes over (cross-port contract)

- **`takes`**: a host takes app functions over from the apps it embeds. Registry (open, `registerEmbedTake`):
  `settings` (hooks: `app.settings`, `settings.open[:tab]`, `nav:settings`, view `settings`, app-menu live list
  `settings`; has a page) and `notifications` (the app hands its notifications to the host). Carriers:
  `&axf-embed-take=settings,notifications` or a separate user-agent token `AXF-Embed-Take/settings+notifications`.
  Nothing named = nothing taken, so old hosts are unchanged.
- **Page mode**: `&axf-embed-page=settings` = the host shows that page of the app on its own; every chrome type is
  hidden, and the page's own function is never taken (the settings page opens its own tabs).
- **Messages** (`$axf: "embed@1"`): guest → host `open-settings {tab?}`, `notify {title, body?, tag?, level?, link?}`,
  `ready`; host → settings page `open-tab {tab}`. Checked and capped on both ends (`parseEmbedMessage` =
  Kotlin `EmbedTakes.parseMessage`); links only https or `view:` / `settings:`. Web: `postMessage` (host checks the
  sender's frame + origin; guest accepts only from its parent). Android: guest calls `AxfEmbedHost.post(json)`, host
  calls `AxfEmbedGuest.receive(json)`.
- **Runtime (web)**: `rt.hostTakes(fn)`, `rt.takenByHost({action|view|provider})`, `rt.postToHost(msg)`; `dispatch`
  and `navigate` hand taken hooks to the host instead of running them (a toast when no host answers).
- **Chrome drops taken hooks**: app-menu engine (`AppMenuEnv.taken`), `MenuList` (context menus), toolbar items, nav
  items, widgets (an action button goes; a logo/avatar/status loses its tap).
- **`AppShell`**: page mode; new `keep` prop (views kept mounted once shown — frames must never remount).
- Kotlin: `EmbedTakes` (host side + parser) and `Embed(takes, page)` (defaults keep the old shape);
  `EmbedTakesConformanceTest` (written without a compiler — CI compiles it). Guest side on Android deferred
  (`spec/PORTING.md`).
- Fixture `spec/fixtures/embed-takes.json` (new; `embed.json` unchanged). `check-embed.mts` 94 → **236** checks.
