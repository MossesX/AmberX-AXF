# Report: per-instance-settings-window-picker

Brett (Nov 13 2026, 17:46): "every tab group and toolbar has its own settings interface, and within it you can select our settings interface"

Model: Opus, one session. Branch `claude/per-instance-settings-window-picker`.

## What shipped

- **s1 (c12a06c6f):** every tab group, toolbar, banner, nav menu and menu bar has its own chrome settings dialog. At the
  top of the dialog, *Settings interface for this one* picks the settings interface (settings asset) that this instance's
  dialog renders through. The kind's pick (the shared default unless the app picked its custom copy) is preselected.
  Changing it re-renders the dialog straight away. The pick is stored per instance under
  `axf.chrome.<type>.<instance>.interface`, so it survives a reload and follows skins (a missing asset falls back to the
  kind's pick, then the shared default). chrome-settings@1 engine: `chromeInstanceSettingsPick`,
  `chromeInstanceInterfaceList`. Spec fixture keys `instancePicks`, `instanceInterfaces`, `keys.instanceInterface`.
  Help entry `settings-interface-for-this-one`.
- **s2 (f80d00e6b):** library toolbars (`axf-ws-toolbar:<workspace>`) count as toolbar chrome too
  (`CHROME_TARGET_PREFIXES`), and unnamed toolbars and tab rows get a stable instance slug (`chromeInstanceSlug`),
  so every toolbar and tab row opens its own dialog. Settings → Plugins → Toolbars → All toolbars shows each toolbar's
  settings interface pick and has a *Settings…* button that opens the same dialog as its context menu.

## API (all four the same)

- Action `chrome.instance-interface:<type>:<instance>:<id|default|custom|inherit>`, listed in the control inventory as
  `function:chrome.instance-interface`.
- REST: `POST /api/console-control` (console actions). MCP: `console_control_*` / console action tools.
  CLI: `axf console …`. Voice (AmberX): the same action string.
- Open a dialog: `chrome.settings:<type>:<instance>`. Read the state: setting `axf.chrome.<type>.<instance>.interface`
  (empty = same as every one of its kind).

## Checks

Green: `check-chrome-settings` (291), `check-tab-group` (445), `check-control` (389), `check-console-commands` (101),
`check-tapconfirm` (80/80), `check-asset-overrides`, `check-theme`, `check-controls`, `check-toolbars`,
`check-chrome-assets`, `chrome-settings.mjs check`.

Already failing on main, not touched by this branch:
- `help-coverage --check`: console-web at 99.6%. The 6 controls without help are in `approvals-banner` and `molly-guide`.
- `shared-assets check`: the baked `assets/help/framework-drafts.json` in amberx-droid and molly is out of date and needs a re-bake.

## Not done

- UI Review screenshots: Playwright is not installed on the VPS (`playwright not found`), so the capture tool could not
  take desktop or phone shots. Brett, or a session on a machine with Playwright, needs to run
  `rebuild-shots.mjs --submit` for the chrome settings dialog and Settings → Plugins → Toolbars → All toolbars.
- Android twin deferred (Android port on hold), recorded in `framework/spec/PORTING.md`.
