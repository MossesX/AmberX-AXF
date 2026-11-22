# Rename Gate & rules to VPS Configuration: build cap + veto passes live there

Build `rename-gate-rules-to-vps-configuration` · branch `claude/rename-gate-rules-to-vps-configuration` · Fable · Nov 21 2026

## What changed

**Builds → Gate & rules is now Builds → VPS Configuration.** One screen for how the VPS runs builds: Rules, Build
rules, Auto-lander, **Build cap** (new), **Passes** (new), History.

### s1: the rename

- Label everywhere: plugin name, nav, app menu, page head, settings tab (Settings → Plugins → VPS Configuration),
  toolbar asset, home card, notifications, help, README, the plugin list, the build-rules docs, RULES.md / CLAUDE.md.
- Addresses: the plugin folder (`gate`), plugin id, REST prefix (`/api/plugins/gate/`), CLI (`axf gate`), MCP tools
  (`gate_*`, `lander_*`), `view:gate`, `tab:gate.tabs`, and every `gate.*` action keep their names, so toolbars,
  fixtures, saved links and scripts are untouched. New addresses on top: `view:vps-configuration`
  (`console_show view:vps-configuration`, `console_open vps-configuration`) and the action `vps.open[:tab]`.
- Voice: "open VPS Configuration" (the view title and `vps.open`); "gate and rules", "gate", "build cap", "veto
  passes" are search keywords on the view, so the old words still find it.
- Glossary: a `VPS Configuration` term with the old names as aliases.

Decision: the console has no view-alias mechanism, and the toolbar asset, its fixtures and the page-toolbar voice
fixture are keyed to `view:gate`. `view:gate` therefore stays the screen and `view:vps-configuration` is a second
registered view that opens it, instead of renaming the id and regenerating four cross-port fixtures.

### s2: Build cap

`GET / POST /api/plugins/gate/build-cap` (`build-cap.mjs`, build-cap@1) puts three real settings side by side:

| Field | Where it lives | Who may change it |
| --- | --- | --- |
| Hard cap (`maxBuilds`, 4 today) | `framework/cli/build-limit.mjs` | Brett's signed-in console only |
| Emergency slots (`emergencySlots`, 2 today) | the same | Brett's signed-in console only |
| Steps in parallel (`stepsInParallel`, 6 today) | the orchestrator's pipeline settings | anyone with the console |

The tab shows what runs now, how many really run at once (the smaller of hard cap and steps in parallel) and a plain
note when they disagree. On the live VPS today it reads: "Steps in parallel is 6 but the hard cap is 4: only 4 run at
once." Owner-only fields are disabled with the reason; the route answers 403 to a session, MCP or voice, and refuses
the whole call when an owner-only key is in it. Values are range-checked before anything is saved.

Reach: REST above · MCP `vps_build_cap`, `vps_build_cap_set` · CLI `axf gate build-cap [set stepsInParallel <n>]` ·
voice / actions `vps.build-cap.open | status | set:<key>:<n>` · console-control `setting:vps.buildCap.maxBuilds |
emergencySlots | stepsInParallel`, buttons `vps-cap-save | vps-cap-reset | vps-cap-refresh`, deep link
`view:gate/tab:gate.tabs=build-cap`.

### s3: Passes

- The veto passes moved out of Token control: start a pass (scope, minutes held to the longest-pass setting, reason,
  irreversible deletes), approve / deny, revoke, undo, the per-scope list, recent passes and the longest-pass setting
  are the **Veto passes** sub-tab. Token control keeps the pass banner and a button that opens the new tab.
- The `axhub-passes` plugin is removed and folded in: its Passes and Go pass pages are the **axHub passes** and **Go
  pass** sub-tabs. The gate plugin now provides `view:axhub-passes`, `view:axhub-go-pass`, the actions
  `axhub-passes.open` / `axhub-go-pass.open` and the Apps → axHub menu entries, so the hub pages' own links
  (`go(rt, 'passes')`), old `#/passes` links and shortcuts still open them. Its help entries moved too.
- The passes still belong to the control@1 runner: the Token control plugin's `pass/*` routes, MCP pass tools and
  `axf pass …` are unchanged. The tab is a second client of the same routes, owner actions with Brett's session first.

Reach: REST `…/token-control/pass/status | grant | approve | deny | revoke | undo | settings` (unchanged) · MCP / CLI
the existing pass tools · voice / actions `vps.passes.open[:veto|hub|go] | status | grant:<minutes>[:<scope>] |
revoke[:<scope>] | max:<minutes>` · console-control `setting:vps.passes.scope | minutes | reason | irreversible |
maxMinutes | timeZone`, buttons `vps-pass-start`, `vps-pass-settings-save`, `vps-pass-approve-<scope>`,
`vps-pass-deny-<scope>`, `vps-pass-undo-<scope>`, `vps-pass-revoke-<scope>`, deep links
`view:gate/tab:gate.tabs=passes` and `tab:gate.passes.tabs=veto | hub | go`.

## Checked

- `node apps/console-web/plugins/gate/test.mjs` (23 checks: build-cap note / ranges / owner-only CLI refusal, passes
  have one home) · `python3 …/gate/server/test_routes.py` (39: build-cap validation and the 403) ·
  `test.build-rules.mjs`, `test_auto_lander.py`, `toolbar.test.mjs` · token-control `test.mjs` (22) ·
  `npx tsx apps/console-web/src/hubPages/test.mjs` (234).
- `tsc --noEmit`, `vite build`, check-theme, check-controls, check-toolbars (.mjs and .mts), check-console-control
  (.mjs and .mts), help-coverage `--check`, menu-reach, check-token-registry, check-gate-rules, check-build-rules,
  plugin-lifecycle check for every plugin.
- In a browser (`apps/console-web/scripts/vps-config-shots.mjs`, fixture replies): `view:vps-configuration` opens the
  screen, both new tabs open by deep link, their setting targets answer, desktop and phone. Four shots are in UI
  Review → Screenshots under this build's name.

Not exercised against the live console: saving the hard cap from Brett's signed-in session, and starting a real pass
from the new tab. Both go through routes that existed before and are unchanged; the new tab's own write for
`stepsInParallel` was not run against the live settings either, to leave the running pipeline alone.

## Clashes and leftovers

- `nov-20-fix-list-voice-console-cont` s2 (hard cap next to steps in parallel in this plugin) is this build's Build
  cap tab: noted on that build so it is not built twice. Its s1 (the orchestrator's `/pipeline/settings` allowlist
  lacks `stepsInParallel`) is still open; the Build cap tab does not need it (it writes through the pipeline CLI).
- `pass-approval-hook-deep-link-amberx-notification` (#681, fixing) links to Token control → Passes: noted on that
  build to point at `vps.passes.open` when it merges main in.
- `framework/catalog/status.json` still titles the feature "Gate & rules plugin"; it is shared hub data and was left
  for the catalog's own tooling. `tracker.mjs --check` reports one item without a status on main already, unrelated.
- Kotlin: nothing to port (console plugin only).
