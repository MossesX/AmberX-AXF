# s4: demo and dead code removed from the live console

## Found

- **orchestrator-demo plugin** (`apps/console-web/plugins/orchestrator-demo`, 42 files) was `enabledByDefault: true`.
  Its caption bar was mounted in the `app.frame.cover` slot on every console page. It polled
  `GET /api/plugins/orchestrator-demo/state` every 5 s while idle and every 1 s while a run played. Each poll ran
  `subprocess.run(["node", "runner.mjs", ...])` in the console server, so every open console tab started a Node
  process every 5 s, even when no demo had ever been started. The console also got a deep-link watcher, a Settings →
  Plugins tab, a page, MCP tools and voice phrases from it.
- Stale references to the plugin remained in `build-orchestrator/plugin.json` (lifecycle mentions of
  `orchestrator-demo/deps.mjs` and `test.mjs`), in the `axf` CLI usage (`axf demo orchestrator …`) and in the voice
  fixture (`framework/spec/fixtures/page-toolbar-voice.json`, 7 toolbar buttons).

## Fixed

- Removed the plugin with its own uninstaller (`plugin-lifecycle.mjs uninstall orchestrator-demo --all --no-state`).
  The uninstaller removed its folder and its README and CLI doc lines. `check orchestrator-demo --after-uninstall`: clean.
- **Why remove it:** Brett asked for orchestrator-demo by name (build brief, item 3). It was a scripted tour against
  throwaway `demo-*` builds and never touched real work, but its idle polling cost the live console a subprocess every
  5 s per tab.
- **Kept:** the framework demo-run@1 core and the demo-build@1 sandbox (`framework/core/live-demo.mjs`,
  `framework/core/demo-build.mjs`, their specs and checks). The builds store, the lander and the build-orchestrator
  plugin still use them. The plugin can be reinstalled from git history if it is wanted again.
- Removed the stale mentions and the `axf demo` usage line, and regenerated the voice fixture
  (`check-page-toolbar-voice.mts --write`: 90 buttons on 18 toolbars, passing).

## Checked, left alone

- `_template` is example code. The web glob and the server loader skip `_*` folders, so it never runs on the console.
- `demonstration-designer`, `glossary-index`, `plan-studio` / `plan-studio-2` and the `demo-preview` dev server are
  real features, not demo junk.
- No tracked `.orig`, `.rej`, `.bak` or `.tmp` files.

Checks: check-theme, check-controls, check-toolbars and check-chrome-assets all pass. There is no UI review because no
screen was changed; a plugin was only removed.
