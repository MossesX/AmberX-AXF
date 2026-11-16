# Report: per-instance-settings-picker-merge-main

Brett (Nov 13 2026, 19:37): "I definitely need that; every tab group, application menu, navigation menu, toolbar can have its own settings interface that changes only it, and they all have transparency"

Model: Opus, one session. Branch `claude/per-instance-settings-picker-merge-main`.

## What shipped

- **s1, merge:** `claude/per-instance-settings-window-picker` (PR #622) merged onto current main.
  - `framework/react/components/Overlays.tsx`: kept both sides' imports. From main: `CONTEXT_LEAD_PREFIX` and `withContextLead` from `core/engines/windows`. From the branch: `chromeInstanceSlug` from `chrome-settings-rules.mjs`.
  - `apps/console-web/src/axf/react/components/Overlays.tsx`: re-baked from the framework file.
  - `apps/console-web/axf.lock.json`: built from main's lock. Only the six baked files the branch touched were rehashed. `rebake apply` was not used because it would overwrite console-web's own existing edit to `libs/hub/veto.ts`.
  - `apps/console-web/src/control/inventory.json`: regenerated.
  - Latest `origin/main` merged in afterwards with no conflicts.
- **s2, coverage check against Brett's list:**
  - Every tab group, toolbar (including workspace toolbars), navigation menu, application menu (menu bar), banner and context menu has its own settings dialog and its own settings interface pick (`axf.chrome.<type>.<instance>.interface`).
  - **Gap 1, transparency:** no chrome kind has a transparency field yet.
  - **Gap 2, dialogs:** dialogs are not a chrome kind yet.
  - Both gaps are written up as a build note: pin Fable, because the fix changes the chrome-settings@1 contract and every chrome renderer.

## API (all four the same, from #622)

- Pick: action `chrome.instance-interface:<type>:<instance>:<id|default|custom|inherit>` (`function:chrome.instance-interface` in the control inventory).
- REST: `POST /api/console-control`. MCP: console action tools. CLI: `axf console …`. Voice (AmberX): the same action string.
- Open a dialog: `chrome.settings:<type>:<instance>`. State: setting `axf.chrome.<type>.<instance>.interface`.

## Checks (green after both merges)

`check-chrome-settings` (291), `check-asset-overrides`, `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, console-web `tsc --noEmit`, `control-inventory --check`.
Not run here: specs that import `react` (`check-windows` and others) fail with "Cannot find module 'react'" because there is no root node_modules on the VPS. CI runs them.

## Not done

- Per-instance transparency and a `dialog` chrome kind: follow-up (see the build note).
- UI Review shots: no new UI in this build. #622's shots are still waiting (Playwright is not installed on the VPS).
- Android twin: deferred, recorded in `framework/spec/PORTING.md` by #622.
