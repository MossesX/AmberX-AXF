# Report: settings-iface-default-all

Brett (Nov 18 2026): settings interface, a locked default for EVERY asset and plugin.

Model: Opus, one session. Branch `claude/settings-iface-default-all-2`.

## What shipped

- **settings-iface@1** (`framework/core/engines/settings-iface-rules.mjs`, reference engine): every `settings` asset
  says who it is built for in the required field `data.builtFor`: `app` (the Settings page), `asset:<type>`,
  `plugin:<name>` or `chrome:<type>` (the chrome dialogs, chrome-settings@1). `asset-types.json` requires it and
  `core/validate.ts` checks its shape.
- **A default per owner:** 55 asset types ship `framework/assets/settings/default-<type>.json` (baked into every app
  that ships shared assets); 75 console plugins ship `plugins/<folder>/assets/settings/default-<folder>.json`. A plugin
  named like an asset type gets `default-<name>-plugin`. Framework libraries and anything else without a file get
  their default registered at run time, so every owner has one.
- **Backfill:** all 87 existing settings assets got `builtFor` (chrome copies → `chrome:<type>`, plugin files →
  `plugin:<folder>`, the page interfaces → `app`). Three data-store interfaces were missing the required `search` /
  `descriptions` and got them.
- **UI** (`framework/libs/settings/iface.tsx`): at the top of every plugin's settings (Settings → Plugins → <plugin>)
  and every asset type's card (new sub-tab Settings → Appearance → Asset types), one row shows the settings interface
  name greyed out with a lock, and a checkbox *Use another settings interface*. Ticking unlocks it and opens a
  **dialog** listing only the interfaces built for that plugin or asset type. Unticking goes back to the default.
- **Effect:** a plugin's tab renders through its picked interface layered over the page's (its `hide`, `levelOf` and
  `descriptions` apply; the page keeps layout, header, search and levels). The Settings page's own slot now offers
  only `app` interfaces, so the 130 new defaults never show up there.
- **No sharing:** the picker filters on `builtFor === owner`; `settings-iface.mjs check` fails a plugin file built for
  another plugin.

## API (REST / MCP / CLI / voice: console actions)

- `settings.iface:<asset|plugin>:<name>:<settings id|default>`: pick one; `default` = untick, back to the default.
- `settings.iface.choose:<asset|plugin>:<name>`: open the dialog.
- State: setting `axf.settings.iface.<kind>.<name>` (absent = locked on the default).

## Checks

- New: `node framework/spec/check-settings-iface.mjs` (fixture `framework/spec/fixtures/settings-iface.json`, added to
  CI), `node framework/cli/settings-iface.mjs check` (every default present, every settings asset has a valid
  builtFor, no cross-plugin files).
- Green: check-chrome-settings (326, fixture regenerated for `builtFor` in the custom copy), chrome-settings check,
  check-asset-overrides, check-control, check-console-commands, help-coverage (framework back to 100%; also wrote the
  two ChromeContext entries that were missing), shared-assets check, check-theme, check-controls, check-toolbars,
  check-chrome-assets.

## UI Review

Waiting in UI Review: item `r-20261118-67d6cc51`, group "settings-iface-default-all - Nov 18 5:45 AM", desktop + phone
shots of the Gate tab locked, the picker dialog and Appearance → Asset types (`apps/console-web/scripts/settings-iface-shots.mjs`).
The shot script picks a random port and fails loudly if its preview does not start: fixed port 7099 was served by another
session's preview and gave shots of the wrong build.

## Not done / notes

- No build record exists for `settings-iface-default-all` (or `-2`) in the orchestrator, so steps could not be ticked and
  `builds-live link` refused; PR #834 is linked here and in THREADS instead.

- Android twin deferred (Android port on hold), recorded in `framework/spec/PORTING.md`.
- apps/demo and apps/walkthrough-studio have stale baked framework copies on main (rebake status), so they did not get
  the new engine; they load their own settings assets, which were backfilled.
- A settings asset saved outside the repo without `builtFor` (none found) would now fail validation; run
  `node framework/cli/settings-iface.mjs backfill --write` on its folder.
