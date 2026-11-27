# Plugin removal check 02: agents and sessions

Build `emergency-check-can-these-plugins-`, step s2. Report only: nothing was deleted or changed.
Checked on main at `3e39311dc` (Nov 25 2026); re-checked on main at `e1e8d3231` (Nov 27 2026): every file:line below still
matches, no verdict changed, six smaller references added under "Re-check, Nov 27". Plugins: `agent-slots`, `session-checkin`, `claude-handoff`, `axhub-handoff`
(all under `apps/console-web/plugins/`).

## Verdicts

| Plugin | Verdict | What depends on it | What to move, and where |
|---|---|---|---|
| `agent-slots` (Agent cap) | **MOVE FIRST** | Kept screens show its panels through slots: `apps/console-web/plugins/agent-swarm/web/index.tsx:13-14` (`swarm.settings.desks`, the cap settings in the Breakroom), `agent-swarm/web/cards.tsx:99` (`swarm.agent.status`, "Waiting for a desk"), `apps/console-web/src/views/BuildManager.tsx:148,178` (`build.queue.top`, the real queue). Capability `axf.agent-slots@1`, both optional: `claude-session/server/__init__.py:40,329` (agent picker), `build-orchestrator/server/__init__.py:123` (priority tags). `ui-review/test.py:391` reads `agent-slots/web/index.tsx` by path. `framework/schemas/settings-sources.json:16,18,22` names its settings tab and API as an edit and read path for Builds at once. | The plugin is the only screen for: the queue with Move up and Cancel, max heavy steps, memory guard, close-after, priority rules, and the "VPS memory for headless agents" systems-check item. Move those into `gate` (Builds → VPS Configuration → Build cap, `gate/web/BuildCapTab.tsx`), which already edits Builds at once and emergency slots, and let `gate` provide `axf.agent-slots@1` and fill the three slots. Then drop the `ui-review/test.py:391` entry and the two settings-sources lines. The engine `framework/cli/agent-slots.mjs` is not the plugin and stays. |
| `session-checkin` | **MOVE FIRST** (unhook; nothing has to be relocated) | The VPS runs its code on every Claude Code session: `/root/.claude/settings.json:50` (SessionStart, `checkin.mjs detect`) and `:139` (SessionEnd, `checkin.mjs end`), both pointing at `/opt/axf/apps/console-web/plugins/session-checkin/checkin.mjs`. CI runs its test: `.github/workflows/android.yml:221-222`. A kept screen links to its view: `console-terminal/web/nav.tsx:210` ("Session browser" → `rt.navigate('session-checkin')`). Readers of the hook's presence: `deploy/console-doctor.sh:66-67,102`, `systems-check/server/checks.py:431`, `systems-check/test.py:248,487`. | Before deleting: run `node apps/console-web/plugins/session-checkin/install.mjs --uninstall --target user` on the VPS (and on any other machine with the hook), or every session start and end runs a missing file. Same PR: remove the CI step, the `nav.tsx:210` link, the `host-session-checkin` item (console-doctor + systems-check + its two test lines), help entry `apps/console-web/src/assets/help/console.json:246`. If Brett still wants a session browser, the list view belongs in `console-terminal` (it already has its own session log, `console-terminal/server/__init__.py:304`); otherwise nothing moves. |
| `claude-handoff` | **SAFE** (four references go in the same PR) | No kept code imports it or calls its API, and it provides no capability service. References that fail CI if left: `apps/console-web/src/lazyEngine.ts:56` (`KNOWN_BANNERS`; `scripts/lazy-loader-check.mts:86` fails on a missing plugin), `apps/console-web/src/assets/context-menu/amber.json:95-98` (Amber menu → `claude-handoff.open`) together with `framework/spec/check-design-package.mts:183` which requires that item. Lists to prune: `framework/spec/chrome-baseline.json:6`, `framework/spec/json-data-writes.baseline.json:22-23`, `framework/spec/token-manifest-baseline.json:7`, help entry `apps/console-web/src/assets/help/console.json:288`, `apps/walkthrough-studio/src/studio/seed.ts:156`. | Nothing to move. It is the only writer of the handoff kit (`_claude/handoff/`) and of the hub's handoff runs (`<projects>/_shared/_data/handoff/`, `server/results.py:8`): after removal both freeze. The kit stays in the repo unless removed by hand (`git rm`, plugin.json `lifecycle.keeps`). Live data folder on the VPS: `/opt/axf/.axf-console/plugins/claude-handoff` (uninstaller removes it). |
| `axhub-handoff` | **SAFE** (remove with or after `claude-handoff`) | No kept code depends on it. One CI test names it: `apps/console-web/src/hubPages/test.mjs:121,229,231` (reads `axhub-handoff/web/index.tsx` and expects the axHub nav to reach it; run at `.github/workflows/android.yml:403`). Doc row: `apps/axhub-web/ARCHIVED.md:12`. | Nothing to move. Edit the three `hubPages/test.mjs` lines in the same PR. It only shows runs that `claude-handoff` wrote, so it is empty once that plugin is gone. The helpers it uses in `apps/console-web/src/hubPages/core.ts:231` (`handoffGauges`, `stepGroups`, `sessionsFor`) are console code, not the plugin; they become unused and can go in the same PR with their test block (`hubPages/test.mjs:204-209`). |

## Evidence

### agent-slots

**What the plugin is.** Only the console's view: `web/index.tsx` (settings tab `agent-slots` with four panels, lines 293-298;
five slot fills, lines 300-306; menu entry Builds → "Agent cap and queue", `web/menu.ts`), `server/__init__.py` (routes
`status`, `settings`, `queue/{id}/up`, `queue/{id}/cancel`, `hard-limit`; service `axf.agent-slots@1`; systems-check item
`agent-slots-memory`). Its own `hooks.mjs:2-4` says it: the store belongs to the framework CLI and the cap keeps working
without the plugin. Its `dataDir` is empty by design. `plugin-lifecycle.mjs check agent-slots` is clean.

**What is framework code that only shares the name (stays, untouched by a removal):**

- `framework/cli/agent-slots.mjs` and `framework/cli/build-limit.mjs`: the cap, the queue, the heavy lock, the store in `~/.axf/agent-slots`.
- Users of that CLI, none of which touch the plugin: `deploy/claude-headless.sh`, `apps/console-web/plugins/build-orchestrator/pipeline.mjs:110` and `watchdog/sessions.mjs:62` (dispatcher), `agent-swarm/swarm.mjs:38` (`withSlot`), `gate/fixers/run-ci-checks.mjs:36`, `framework/cli/skins.mjs:479`, `ui-predict.mjs:124`, `stale-facts.mjs:161`, `check-settings-sources.mjs:97`, `reaper.mjs`, `dispatch-gate.mjs`, `deploy/watchdog/audits.mjs`, `deploy/lander/fix-session.mjs`, `deploy/install-build-limit.sh`, `apps/expenses/deploy/install.sh:132`.
- CI: `.github/workflows/android.yml:98` (`check-agent-slots.mjs`) and `:173` (`check-agent-slots-data.mjs`) test the engine, not the plugin.
- Postgres: table `agent_slots` (`services/axf-data/tables.py:763-768`) and the data path `console/agent-slots/state.json` belong to the engine.
- `CLAUDE.md:136` (Agent cap rule) describes the engine; `apps/console-web/plugins/README.md:69` is the plugin's marked doc line.

**What breaks or goes dark if the plugin is deleted as it stands:**

- Breakroom settings fall back to "No agent cap installed" (`agent-swarm/web/index.tsx:14`); swarm cards lose "Waiting for a desk".
- The Build queue screen loses the live queue panel (`BuildManager.tsx:178`).
- The agent picker and build priority tags lose slot data (both handle a missing service: `claude-session/server/__init__.py:329-333`, `build-orchestrator/server/__init__.py:118-127`).
- No screen left to change max heavy steps, memory guard, close-after or priority rules, or to Move up / Cancel a queued run (CLI only: `node framework/cli/agent-slots.mjs set …`). Builds at once and emergency slots stay editable in `gate/web/BuildCapTab.tsx` (`gate/build-cap.mjs:5-23`).
- MCP and voice commands `hard-limit`, `set-hard-limit` and `status` go away (named as the read path in `settings-sources.json:22`).
- `ui-review/test.py:391-393` fails (file not found).
- The other two slot hosts, `activity/web/index.tsx:381` and `builds-page/web/ui.tsx:256`, are themselves on the removal list.
- `framework/spec/token-manifest-baseline.json:5` lists the folder (prune).

### session-checkin

**What the plugin is.** `checkin.mjs` (the Claude Code hook: `detect`, `end`), `lib.mjs`, `install.mjs` (wizard that writes
the hook into `.claude/settings*.json`; also the uninstaller, `--uninstall --target local|shared|user`), `server/__init__.py`
(routes `status`, `preview`, `install`, `uninstall`, `sessions`, `sessions/{id}`, `baseline`, `pricing`, `detect`), view
`sessions` / `session-checkin`, settings tab. It predates plugin-lifecycle@1: no `uninstall.mjs`, no `lifecycle` block, no
marked doc lines, and `plugin-lifecycle.mjs check session-checkin` reports stale references (the ones listed above plus
`_claude/memory/docs/session-checkin.md` and `framework/plan/plan.json:23501`).

**The live dependency is the host, not the repo.** `/root/.claude/settings.json` on the VPS has both hook entries (lines 50
and 139) with config `/root/.claude/session-checkin.json` (`unattended: log`). The repo's own `.claude/settings.json` has none.
Deleting the folder first leaves both hooks pointing at a missing file on every session, headless builds included.

**Data.** It writes `session-log@1` records to `<root>/<yyyy>/<mm>/<id>.json` under the hub's `sessions` folder or the repo's
`sessions/` (`lib.mjs:305-312,338-348`). The session archive next to it (`sessions/archive/…/cc-*.json`, `session-archive@1`,
Postgres table `sessions`, `services/axf-data/tables.py:789`) is written by claude-sync and the chat archiver, not by this
plugin, and stays. No Postgres table of its own. Prices come from `framework/schemas/model-pricing.json` (shared, stays); the
plugin's `baseline/` folder is read by nothing else.

**Other references (prune, none load code):** `framework/spec/token-manifest-baseline.json:11`,
`framework/spec/json-data-writes.baseline.json:51-52`, `framework/spec/fixtures/page-toolbar-voice.json:834-851` (regenerate),
`framework/spec/DESIGN-LANGUAGE.md:150`, `framework/cli/plugin-lifecycle.mjs:50` (a comment), `apps/console-web/plugins/README.md:14`,
`_claude/memory/STATUS.md:48`, `_claude/memory/docs/session-checkin.md`.

### claude-handoff

**What the plugin is.** `handoff.mjs` + `handoff-core.mjs` (kit builder, `hooks install|remove` for a SessionStart collect
hook), `server/__init__.py` (24 routes under `/api/plugins/claude-handoff/`), `server/results.py` (writes each assembly to the
hub's `_shared/_data/handoff/`), views `claude-handoff` and `claude-handoff-preview`, banner `claude-handoff`, settings tab,
seven actions, notify type `claude.handoff` (`notify.json`), toolbar assets `claude-handoff-files` and `claude-handoff-look`.
`plugin-lifecycle.mjs check claude-handoff` is clean, but it does not see the five references in the table.

**Checked and clear:**

- No import of `handoff-core.mjs`, `handoff.mjs`, `installer-core.ts` or `look-core.ts` outside the folder.
- No capability service, so no plugin can depend on it through `plugin_services`.
- No Postgres table: `handoff_runs` / `handoff_machines` exist only as a plan in `framework/spec/DATA-INVENTORY.md:154,183,193`, not in `services/axf-data/tables.py`.
- The collect hook is not installed on this VPS (`/root/.claude/settings.json` has no handoff entry). Another machine may have it; its `uninstall.mjs` (`hooks.mjs:9-11`) removes it there, so run the uninstaller rather than a bare folder delete.
- `framework/spec/check-ashes.mts:26-63` and `framework/libs/ashes/core.ts:90-91` use the name as test data and a comment only; nothing reads the folder.
- `deploy/watchdog/audits.mjs handoff` and `notes/handoffs/` in `services/axf-data` are unrelated uses of the word.

**Worth knowing:** build `handoff-2` already carries the step "Delete the old handoff system (THREADS.md, handoff notes,
claude-handoff plugin, rules, writers)" (`framework/plan/pending.json:4995`). `_claude/handoff/` is 2026-10-27 output and is
read by other pending work (`pending.json:7699`); removing the plugin does not remove it.

### axhub-handoff

**What the plugin is.** Web only: `web/Handoff.tsx` and `web/index.tsx` (views `axhub-handoff`, `axhub-handoff-run`; action
`axhub-handoff.open`; nav System → Handoff; menu Apps → axHub → Handoff; a default settings tab). No server part, no data, no
capability. It reads axHub's `/auth/api/handoff…` through the console's hub-pages relay (`@console/hubPages/api`); those
endpoints live on axHub and are not touched. `plugin-lifecycle.mjs check axhub-handoff` is clean.

**Not the plugin:** `apps/console-web/src/hubPages/` (relay, route, page helpers, `core.ts`) is console code shared by all the
axHub plugins and stays. `apps/axhub-web/` is the archived app (`ARCHIVED.md`).

## Order that works

1. `claude-handoff` and `axhub-handoff` together, with the reference edits listed (one PR).
2. `session-checkin`: uninstall the hook on the VPS first, then the folder and its references.
3. `agent-slots`: only after its panels, the capability and the health item live in `gate`.

## Re-check, Nov 27

Every cited line was read again on the current tree and the whole repo was searched again for the four folder names, plugin
ids, capability `axf.agent-slots@1`, the `/api/plugins/<folder>` prefixes and the settings-tab ids. The VPS hook file
`/root/.claude/settings.json` still has the two `session-checkin` entries (lines 50 and 139) and no handoff entry. Verdicts
stand. References the first pass did not list (none loads plugin code, none changes a verdict):

- `agent-slots`: the two consumers also declare the capability as optional in their manifests,
  `claude-session/plugin.json:23` and `build-orchestrator/plugin.json:24`. Leave both lines if `gate` takes the capability
  over; drop them if nothing provides it. The plugin also ships a Home card (`agent-slots/assets/card/home.json`, command
  `hard-limit`); it goes with the folder, so a Home layout that pinned "Agent cap" loses that card.
  `build-orchestrator/web/pipeline.tsx:174` (slots used / cap) reads the engine through the orchestrator, not this plugin.
- `session-checkin`: `sessions/README.md:4,10` tells the reader to browse with this plugin and its `checkin.mjs list`
  (reword). `framework/spec/fixtures/data-store-migration.json:381` names it as a writer label of the sessions folder (a
  label only; nothing checks that the plugin exists).
- `claude-handoff`: `framework/spec/fixtures/page-toolbar-voice.json` carries 15 entries for its two toolbars (regenerate
  the fixture), `framework/spec/DESIGN-LANGUAGE.md:147,151` lists it (prune), and
  `framework/spec/fixtures/data-store-migration.json:228,505` names it as a writer label (label only).
- `axhub-handoff`: `apps/console-web/src/hubPages/route.ts:17,23` maps the hub pages `handoff` and `handoff-run` to its
  views. It asks `pluginProviding` first, so an old `#/handoff/<run>` link opens nothing instead of failing; the two
  label entries can be pruned. `framework/catalog/status.json:2476` names it in the notes of the axHub fold-in feature
  (reword when it goes).

