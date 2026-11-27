# Look regression (look-regression@1)

Records everything the appearance system shows and answers, then diffs two records. Built for the skins-only
change (design packs, style packages and the colour / style / layout / behaviour themes folding into skins): the
baseline is recorded on main at tag `pre-skins-only-2026-11-09`, the rerun on the branch, and the diff decides
whether the branch may land. It is generic: any look change can use it.

## What one record holds

Static half (`static.json`, no browser):

- the validators and spec checks the look depends on (asset validation of the framework and every app, project
  manifests, check-theme, check-controls, toolbars, chrome assets, shared assets, skin / design-package /
  style-package / interface / appearance / hub-look / hubsync / looktokens / scale / layout-tokens / control /
  console-commands specs, the token-control, console-commands and plugin-commands plugin tests, the console MCP
  tool test, the console menu reach), each with ok / time / last lines;
- every asset id by type in `framework/assets` and in each app's baked copy;
- `framework/defaults.json`, and for every theme-like type (colour / style / layout / typography / density / sizing /
  behaviour themes, design and style packages, skins, interfaces) the sections and token counts of each asset;
- control@1: targets, tools, REST routes, every list target's rows (token ids, CSS variable names and default-look
  values; slot picks), every plugin's commands and reads (plugin-commands@1) and the tools projected from them;
- the console MCP tools (names, read-only / destructive, required arguments) and every read-only tool with no
  required argument called through the local runner;
- a sha1 of every data file a look migration may touch (assets, schemas, fixtures, catalog, plan, manifests, locks).

Browser half (`web.json` + `shots/<app>/<viewport>/*.png`), for console-web, molly, axhub-web, amberx-droid and
walkthrough-studio at desktop (1280×800) and phone (412×900), hub off, default look:

- a screenshot of home, of every screen or dialog the application menu reaches (desktop), and of every settings
  section, tab and nested tab with every collapsed card expanded (both viewports);
- page errors, console errors, failed requests;
- every computed `--fx-*` variable on `:root`, and every CSS variable referenced but never declared;
- the `axf*` localStorage keys (shape only) and a saved-settings round trip: pick another colour theme (or skin),
  reload, still applied; restore, reload, the look is the baseline again;
- the console's plugin list (every plugin loads) and its console-commands catalogue of deep-link targets
  (screens, dialogs, settings tabs, actions).

## Run

```
# build the apps first (what CI's console job does), then:
node framework/spec/look-regression/run.mjs record --out /root/axf-builds/_regression/<name>
node framework/spec/look-regression/run.mjs diff <baseline dir> <current dir> --allow expected.json --out <report dir>
node framework/spec/look-regression/run.mjs post <dir> --group "<build name>"     # key shots to UI Review → Screenshots
```

`PW_CHROMIUM=/root/.cache/ms-playwright/chromium-<n>/chrome-linux64/chrome` points the walker at an installed
Chromium when the playwright package in apps/console-web is a different revision. `--skip-static`, `--skip-web`,
`--apps`, `--viewports`, `--only <check>` narrow a record.

## Diff

Every difference is a finding `{area, key, kind, detail}`; the report (`report.md`) and `findings.json` list them
by area. A finding is expected when a pattern in the `--allow` file matches its key (`*` wildcard), per area:
`checks`, `assets`, `defaults`, `themes`, `control`, `tokens`, `mcp`, `data`, `web`, `errors`, `vars`, `storage`,
`settings`, `plugins`, `catalog`, `menus`, `shots`. Anything else is unexpected and the exit code is 1: the branch
does not land until the finding is fixed or declared expected with a reason in the PR. Screenshot findings carry
the changed-pixel ratio (threshold `--shot-threshold`, default 0.2 %) and a diff PNG (changed pixels in red).

Baselines live outside the repo (`/root/axf-builds/_regression/<name>`, PNGs are large); the JSON of the
pre-skins-only baseline is kept in `framework/spec/fixtures/look-regression/` so the numbers it holds (asset counts,
token names and values, catalogue ids) are reviewable in git.
