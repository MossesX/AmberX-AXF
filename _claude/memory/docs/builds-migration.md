# Builds migration — dry run (Oct 27 2026, Fable phase of `builds-one-page`)

`node framework/cli/builds.mjs migrate` on the repo snapshot at this commit. Nothing was written; the Opus phase (s5) runs `--write` on the hub copy (`/projects/amberx-axf/_data`) and the repo snapshot. Spec: `framework/spec/BUILDS.md`.

## Counts

- features after: **605** (plan 605, tracker 446, queue 53, pending 110, orchestrator 6)
- attached to an existing entry: 66 (54 queue records, 6 pending items by planId/id, 6 orchestrator builds) · new `build` entries: 104 · catalog features filled from status.json: 47

## Status changes (the drift this build fixes)

- `x.plugins.manager`: planned → **built** — pending item plugin-manager (complete)
- `enterprise-branding`: planned → **in-progress** — orchestrator build enterprise-branding (running)
- `builds-one-page`: planned → **in-progress** — orchestrator build builds-one-page (running)

## Step lists merged

- `design-package`: {"from": "orchestrator", "ticks": 9, "kept": "done where either list said done"}
- `enterprise-branding`: {"from": "orchestrator", "had": 40, "orchestrator": 46, "kept": "orchestrator"}
- `enterprise-branding`: {"from": "orchestrator", "ticks": 5, "kept": "done where either list said done"}
- `builds-one-page`: {"from": "orchestrator", "ticks": 3, "kept": "done where either list said done"}

## Titles (plan title kept; the pending wording is in the entry's history)

- `x.plugins.manager`: plan “Plugin manager + settings tabs for every app” · pending “Plugin manager + settings tabs for every app (Fable rebuild)”
- `x.lib.mcp`: plan “lib-mcp: MCP client (and server) library for every AXF app” · pending “lib-mcp: MCP client library for every AXF app”

## Orphans (kept on the entry, nothing lost)

- pending `ai-assistant-plugin`: planId x.plugins.ai-assistant is not in the plan; kept on the entry
- pending `agent-manager-plugin`: planId x.plugins.agent-manager is not in the plan; kept on the entry
- pending `patches-wrapper`: planId x.app.patches is not in the plan; kept on the entry

## New entries (born on the Pending list or in the orchestrator)

`named-asset-rule`, `claude-pick-api-key`, `app-port-engine`, `lib-clone`, `ai-assistant-plugin`, `agent-manager-plugin`, `plugin-conflicts`, `banner-assets`, `widget-assets`, `build-pilot-contract`, `build-pilot-agents`, `axhub-agent-host`, `console-android-app-tabs`, `console-android-native-tabs`, `patches-wrapper`, `build-manager-history`, `axhub-web-hub-rules`, `patches-plugins`, `patches-plugins-fable`, `todo-manager-tabs`, `session-close-race`, `syscheck-autofix-jobs`, `syscheck-claude-on-fail`, `axhub-auto-approve-all`, `push-banner-pull-all`, `push-banner-claude-fix`, `autofix-through-mosses`, `vps-run-terminal-output`, `push-banner-branches-that-can-merge-cleanly`, `ai-keys`, `syscheck-live-keys-credits`, `credits-switch-ai-keys`, `walkthrough-studio`, `walkthrough-studio-fable`, `walkthrough-harvest`, `axhub-web-app-live-at-axhub-amberxai-com-banner-`, `axhub-web-rebuild`, `syscheck-rebake`, `walkthrough-studio-deploy`, `hubstore-voice-notes`, `hubstore-fable`, `patches-settings-banner-hide`, `patches-settings-banner-hide-fable`, `plugin-model-badges-update`, `plugins-menu`, `ashes-ui`, `build-list-estimates-usd`, `banner-group`, `banner-group-fable`, `axhub-web-console-look`, `voicevault-voice-notes`, `banner-working-icon`, `banner-working-icon-fable`, `settings-asset`, `settings-asset-fable`, `hubsync`, `hub-status-badge`, `appearance-asset-tokens`, `appearance-asset-tokens-fable`, `patches-app-plugins-grid`, `patches-app-plugins-pilot-axhub`, `patches-banners-console-only`, `codebase-changes-resume`, `vinny-offline-commands`, `vinny-app-tokens`, `handoff-session-button`, `handoff-session-threads`, `changes-grid`, `amberx-droid`, `context-menu-designer`, `shared-settings-interface`, `android-framework-update`, `activity-hold-continue`, `banner-details-reveal`, `voice-notes-tab`, `voicevault-mic-actions`, `widget-arrange`, `widget-arrange-fable`, `build-manager-sessions`, `axhub-pages-console-style`, `rebake-console`, `axhub-oauth`, `approval-reasons-go-pass`, `no-login-questions-headless-terminal`, `axhub-oauth-config-soft`, `banner-one-line`, `banner-one-line-fable`, `amberx-router-clash`, `banner-apply-all-keys`, `banner-apply-all-fable`, `apply-all-levels`, `apply-all-levels-fable`, `amberx-empty-shell`, `fresh-look`, `design-package`, `design-package-fable`, `design-packages-10`, `build-orchestrator`, `arch-foundation`, `pending-grid-view`, `enterprise-branding`, `interface-roller`, `builds-one-page`, `trim-asset`


## What the Opus phase does with this

1. `node framework/cli/builds.mjs migrate --write` in the console container (hub copy) and on a checkout (repo copy), then commit the snapshot; `*.pre-builds.json` copies stay beside the originals for one release.
2. Point the Python readers of `pending.json` / `build-queue.json` (alerts, activity, build-manager server) at the plan or keep them on the exports (they are rewritten on every save, so either works).
3. Decide the three orphan `planId`s: create the missing plan entries (`x.plugins.ai-assistant`, `x.plugins.agent-manager`, `x.app.patches`) or clear the links.

