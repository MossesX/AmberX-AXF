# UI Review gate switch, default off

Build: `ui-review-gate-switch-default-off` · branch `claude/ui-review-gate-switch-default-off` · replaces #555.

Brett (2026-11-13 12:14): "UI Review must not be a gate. Add an on/off switch in UI Review settings, 'UI Review is a merge gate', default OFF. When off, PRs are never held for screenshots: release every PR held for UI Review now (#557, #553, #541, #536, #518, #517) into the merge queue. UI Review items still get filed so Brett can look, they just don't block. Build on/replace #555 (kicked out of CI) and fix its CI failures. Full API: REST, MCP, CLI, voice."

## Base

#555's 13 commits (`879e57848..77433c63b`) cherry-picked cleanly onto main `e3cbb24bf`. #555 removed the gate outright; this build turns that into a switch (`uiReview.gate`, default off) so the hold code comes back only behind `gateOn()`.

## #555's CI failures (checklist)

Source: merge-queue run [43389466264](https://github.com/MossesX/AmberX-AXF/actions/runs/43389466264) on `queue/batch` `cb3490b26`, which kicked #555 out at 08:09 UTC ("failed: Web Dev Console (React/TS) + Python API, Build engine sweep (Node)"). The 'CI build errors' issue (#1) holds only the latest failure (an unrelated AmberX module error), so the job logs are the record. The PR's own light checks all skipped.

- [ ] **Build engine sweep (Node):** `✗ console-web: help coverage fell to 99.9% (ratchet 100%): add help for the new controls (node framework/cli/help-coverage.mjs --draft console-web)`. #555 added the read-only *Not a gate* panel in Settings → Plugins → UI Review without help entries.
- [ ] **Web Dev Console (React/TS) + Python API:** `apps/console-web/scripts/theme-swap.mjs`: `✗ transparency tokens did not change between style themes` (every style theme reported opacity `0.4 / 0.66 / 0.06 / 0.1 / 0.45 / 0.88`). #555 changes no theme or style asset, so this is reproduced locally on this branch and on main before blaming it.
- [ ] Plugin checks rerun locally: `plugin-lifecycle.mjs check` for ui-review, push-banner, claude-settings, build-orchestrator; plugin-commands static routes; spec fixtures.
- [ ] Framework and console sweep rerun with `AXF_DATA_DIR=off`: check-theme, check-controls, check-toolbars, check-chrome-assets, `tracker.mjs --check`, console typecheck after a rebake.
