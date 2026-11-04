# Urgent master cleanup — migration dry run

Generated 2026-10-31T23:38:05.331Z by `node framework/cli/builds-store.mjs migrate --dry`. Nothing was written. Store: `_claude/builds/store.json` (builds@1).

## What goes in

| Profile | Registered | Orchestrator builds | Pending items (union) | merged into a build | new records | Queue epics | merged | Recovered from git | Records in the profile |
|---|---|---|---|---|---|---|---|---|---|
| main-framework | yes | 6 | 109 | 5 | 104 | 54 | 6 | 27 | 185 |
| refactor | yes | 46 | 38 | 38 | 0 | 0 | 0 | 0 | 46 |
| angel | yes | 21 | 21 | 21 | 0 | 0 | 0 | 0 | 21 |
| breakroom | yes | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| urgent | yes | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 1 |

**Total: 240 build records, 1229 step records.** One record per build; a build that was in several profiles is one record tagged with each.

## Files read

- **main-framework**: `_claude/builds/orchestrator.json` (6 builds); `repo:framework/plan/pending.json` (109), `hub:framework/plan/pending.json` (109); queue `hub:framework/plan/build-queue.json` (53 in order); 54 plan epics; git history: 14 commit(s) with items
- **refactor**: `_claude/builds/profiles/refactor/orchestrator.json` (46 builds); `repo:framework/plan/profiles/refactor/framework/plan/pending.json` (38), `hub:framework/plan/profiles/refactor/framework/plan/pending.json` (0); queue `hub:framework/plan/profiles/refactor/framework/plan/build-queue.json` (0 in order); 0 plan epics; git history: 2 commit(s) with items
- **angel**: `_claude/builds/profiles/angel/orchestrator.json` (21 builds); `repo:framework/plan/profiles/angel/framework/plan/pending.json` (21), `hub:framework/plan/profiles/angel/framework/plan/pending.json` (21); queue `hub:framework/plan/profiles/angel/framework/plan/build-queue.json` (0 in order); 0 plan epics; git history: 1 commit(s) with items
- **breakroom**: `_claude/builds/profiles/breakroom/orchestrator.json` (1 builds); no pending list; queue `hub:framework/plan/profiles/breakroom/framework/plan/build-queue.json` (missing in order); 0 plan epics; git history: 0 commit(s) with items
- **urgent**: `_claude/builds/profiles/urgent/orchestrator.json` (1 builds); `hub:framework/plan/profiles/urgent/framework/plan/pending.json` (1); queue `hub:framework/plan/profiles/urgent/framework/plan/build-queue.json` (missing in order); 0 plan epics; git history: 0 commit(s) with items

## Merges and dedupes (20)

- `asset-designer`: main-framework: build-queue step x.assets.designer is the same build (pending planId) → one record
- `asset-browser`: main-framework: build-queue step x.assets.browser is the same build (pending planId) → one record
- `plugin-manager`: main-framework: build-queue step x.plugins.manager is the same build (pending planId) → one record
- `asset-templates`: main-framework: build-queue step x.assets.templates is the same build (pending planId) → one record
- `pending-list-manager`: main-framework: build-queue step x.console.pending is the same build (pending planId) → one record
- `lib-mcp`: main-framework: build-queue step x.lib.mcp is the same build (pending planId) → one record
- `design-package`: orchestrator build in refactor and main-framework: one record in both profiles (main-framework copy is newer and wins; the other is kept in copies)
- `arch-foundation`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `enterprise-branding`: orchestrator build in refactor and main-framework: one record in both profiles (main-framework copy is newer and wins; the other is kept in copies)
- `interface-roller`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `pending-grid-view`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `style-package-fable`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `apply-all-levels-fable`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `apply-all-levels`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `amberx-empty-shell`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `fresh-look`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `design-packages-10`: orchestrator build in refactor and main-framework: one record in both profiles (refactor copy is newer and wins; the other is kept in copies)
- `build-orchestrator`: orchestrator build in refactor and main-framework: one record in both profiles (main-framework copy is newer and wins; the other is kept in copies)
- `build-profiles`: orchestrator build in refactor and main-framework: one record in both profiles (main-framework copy is newer and wins; the other is kept in copies)
- `amberx-appearance-lock`: orchestrator build in refactor and main-framework: one record in both profiles (main-framework copy is newer and wins; the other is kept in copies)

## Conflicts (4) — how each is settled

- `design-package` (main-framework): pending item's 9 step(s) differ from the orchestrator's 9: orchestrator kept, pending copy saved in copies
- `enterprise-branding` (main-framework): pending item's 40 step(s) differ from the orchestrator's 46: orchestrator kept, pending copy saved in copies
- `design-package` (refactor): pending item's 9 step(s) differ from the orchestrator's 9: orchestrator kept, pending copy saved in copies
- `agent-swarm` (breakroom): status "queued" is not an orchestrator@1 status → pending (note added)

## Recovered from git history (27)

Items that existed in an older commit of a Pending list and are in no current list. They come in **archived** with a note, so nothing reappears as active by surprise.

- `axhub-auto-approve-all` (main-framework) “AXHub app: Approve everything except vps.run; waiting → approved notifications with alarm sound” — from `framework/plan/pending.json@5ebf7179`
- `amberx-plugin-installer` (main-framework) “AmberX installs plugins from axHub (no console)” — from `framework/plan/pending.json@93814cf4`
- `axhub-connections` (main-framework) “axHub connections plugin + plugin-layout asset type + plugin-datasets@1; tmux, ntfy, Tailscale through axHub” — from `framework/plan/pending.json@783b599f`
- `axhub-connections-fable` (main-framework) “plugin-layout asset type + plugin-datasets@1 (Fable rebuild)” — from `framework/plan/pending.json@783b599f`
- `appearance-hidden-per-app-fable` (main-framework) “Fable rebuild: hidden bars per app in the appearance document” — from `framework/plan/pending.json@0fce2192`
- `patches-one-app` (main-framework) “Patches works as one app (suite mode): one banner, one menu, one search, one look” — from `framework/plan/pending.json@b3d22af4`
- `patches-one-app-fable` (main-framework) “Fable rebuild: Patches suite mode on every port (Kotlin twins + Patches Android as a suite host)” — from `framework/plan/pending.json@b3d22af4`
- `pilot-remove-console-duplicates` (main-framework) “Build Pilot: uninstall the plugins the Console also has (AI assistant + agent manager)” — from `framework/plan/pending.json@2296fcc6`
- `icon-picker-dialog` (main-framework) “Icon picker dialog for the axHub and Claude connection status plugins: Static tab + 50 animated icons with Static switches” — from `framework/plan/pending.json@7bfd79a9`
- `xselect-read-aloud` (main-framework) “X Select: Read aloud in Android's text selection menu (plugin + lib-readaloud + lib-selection)” — from `framework/plan/pending.json@c7fcbb07`
- `assistant-cli-errors` (main-framework) “Assistant: show the real Claude Code error instead of "exited with code 1"” — from `framework/plan/pending.json@7fca09e1`
- `patches-app-tabs` (main-framework) “Patches: any framework app can be a tab (lib-apps app directory feeds the tab group)” — from `framework/plan/pending.json@7fca09e1`
- `walkthrough-deploy` (main-framework) “Deploy Walkthrough Studio at walkthrough.amberxai.com behind the axHub wall” — from `framework/plan/pending.json@7fca09e1`
- `key-manager` (main-framework) “Key manager: named Claude subscription tokens + API keys, pick the active one from a dialog; drives the AI assistant and Claude Code on the VPS” — from `framework/plan/pending.json@7fca09e1`
- `push-banner-merge-all` (main-framework) “Push banner: Pending merges, Merge all (approved on axHub), Pull main into all” — from `framework/plan/pending.json@cf7b6424`
- `patches-approval-tap` (main-framework) “Patches: approval taps open the AXHub phone app” — from `framework/plan/pending.json@cf7b6424`
- `banner-plugins-patches` (main-framework) “Banner plugins run in Patches; console and Pilot draw none (Opus)” — from `framework/plan/pending.json@cf7b6424`
- `banner-plugins-patches-fable` (main-framework) “Banner plugins run in Patches (Fable rebuild)” — from `framework/plan/pending.json@cf7b6424`
- `build-descriptions-every-build-item-says-what-it` (main-framework) “Build descriptions: every build item says what it does” — from `framework/plan/pending.json@d8d11087`
- `container-access-plugin` (main-framework) “Container access plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`
- `snapshot-manager-plugin` (main-framework) “Snapshot Manager plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`
- `systems-check-plugin` (main-framework) “Systems check + What's new plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`
- `terminal-plugin` (main-framework) “Terminal plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`
- `feature-assist-plugin` (main-framework) “Feature assistant plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`
- `theme-manager-plugin` (main-framework) “Theme manager plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`
- `claude-badge-plugin` (main-framework) “Claude badge plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`
- `plugin-switches` (main-framework) “Plugin switches plugin (Fable rebuild)” — from `framework/plan/pending.json@249f8464`

## Refactor build queue

Git history of `framework/plan/profiles/refactor/framework/plan/build-queue.json` was searched commit by commit: it never held a step (order 0 in every commit). Refactor's plan.json never held a feature either, so the console's boot-time "Build queue created from the plan" re-created an empty queue each time. The Refactor builds themselves are safe: they are the Refactor orchestrator's builds and Pending items, all in the store above. The hub copy of the Refactor Pending list was empty (0 items) while the repo copy had them; the union keeps every one.

## Nothing lost — 3137 checks, 0 failed

Every orchestrator build, step, note and status, every Pending item (repo and hub copies), its steps and notes, and every queued epic is in the store, in its profile.

## After the migration

- The old files stay **read-only for one release** as they are now; nothing writes them (`orchestrator.mjs`, `pending.mjs`, `build-queue.mjs`, the console and the MCP tools read and write the store through projections).
- Every write is versioned: store `rev`, record `rev`, and one line per write in `_claude/builds/journal/` with each changed build before and after (`builds-store.mjs history <id>`, `restore <id> <rev>`).
- The console no longer re-creates the build queue from the plan on start; a queue is only created when none exists.
- `orch-sync` (the Orchestrator ↔ Pending bridge) is retired: there is one data set, nothing to sync.

