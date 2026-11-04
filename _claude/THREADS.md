# Threads and builds log

Every Claude session reads this file when it loads the project and keeps it current, so work can be picked up from
any session, account or machine. The repo is the source of truth; chat history is not.

**Read it before doing anything.** Then update it (edit the thread's row, or add one), set *Updated*, commit and push
with your branch, whenever:

- a thread is made, or a session starts something (a build, edit, fix, test run, push, pull or merge);
- a build completes, or anything fails;
- tests start, pass, fail, or stop part way (say where);
- a push or pull is needed, completes or fails;
- a PR is opened, needs merging, is merged, or the merge fails;
- a deploy is needed;
- the session runs out of credits or hits a usage limit (state `stopped`, the step it was on, how to resume);
- it needs Brett (state `blocked`, the exact question), or an item is queued.

Move rows to *Done* once their PR is merged or the work is dropped. Queued items stay queued until Brett says to run
them (project rule). Open PRs: check GitHub, not this file, before acting on one. If a session can't push, it says
so in its reply and puts the row in its change-log entry so the next session can add it.

**Every unfinished thread can be carried on from another account (Oct 26 2026, Brett):** each row that isn't done
has a block under *To carry on* with everything a new session on any Claude account needs and nothing from chat:
what was asked (in full), the model, the branch and what's already on it, what's left as steps, files to read first,
the checks to run, what it's waiting on (the exact question when it needs Brett), and a ready first message. Write
the block when the thread starts and update it at every step, before the session ends or runs out, so a cut-off
session loses nothing.

States: `working`, `testing`, `review` (PR open / needs merge), `deploy` (merged, needs a deploy), `queued` (waiting
for Brett's go), `blocked` (needs Brett), `failed`, `stopped` (cut off: out of credits, usage limit, session ended),
`on hold`, `done`.

## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|---|---|---|---|---|
| URGENT main CI green (Current `urgent-main-ci-green`, Opus; agent Earl the Ear, headless): main red on 4 jobs (7 failures, 3 hidden behind the first). Root causes: gen-fixtures.mts imported WIDGET_TYPES/TONES from widgets and chrome (chrome shadowed, widgets.json wrong → check-widgets + Kotlin ConformanceTest); xLayout `opens: false` with a view; KernelTest expected the old thin banner; repo profiles.json missing `current`; deploy test.sh used empty commits after the `_claude`-only skip; 4 unmarked build-orchestrator references (lifecycle). Plus s4: ci-main check names failing jobs, Auto fix queues new `ci-fix` job (Greenlight Gina) | review (auto-merge once green) | `claude/urgent-main-ci-green` | #284 | After merge: update waiting PRs (#265 #266 #268 #269 #271 #279) from main. Report `_claude/builds/reports/urgent-main-ci-green.md` | 2026-11-03 |
| Window resize fix (Current `window-resize-fix`, urgent, Opus; agent Landin' Lenny; Brett Nov 3 voice: "All floating windows need to be resizable" + Terminal settings Opens in = Dialog did nothing): handles in a grips layer straddling the border, touch-sized (row height on phones), corner grip on every frame; windows share one z layer so dialogs stay on top; `settings.open` honours a plugin's Opens in = Dialog. Merge on Brett's order | review (merging on Brett's order) | `claude/window-resize-fix` | (see PR) | Report `_claude/builds/reports/window-resize-fix.md`. Follow-up: remember window size (engine, Fable) | 2026-11-03 |
| Land everything (Urgent `land-everything`, Opus; Brett Nov 3 voice: "Just go. Get everything live."): 17 AmberX-AXF PRs + 3 axHub PRs landed on main and deployed; banner PRs #251 #254 and banners-one left for Brett | complete | `claude/land-everything` | — | Report `_claude/builds/reports/land-everything.md`. Brett: banner PRs, hub delete for kill-patches-pilot s7 | 2026-11-03 |
| Plugin commands, automatically (Urgent `plugin-commands-auto`; Brett Nov 3 voice): every plugin, existing and new, exposes all of its commands and reads through control@1 on REST `/api/control/<plugin>/<command>`, MCP `<plugin>_<command>` (+ `plugin_commands` / `plugin_read` / `plugin_run`) and CLI `axf <plugin> <command>`, made automatically from routes, actions, data folder and plugin.json `commands`; lifecycle check + CI enforce it. Opus. Base token-control-opus (#250) + console-commands (#249) merged in | PR open (all 6 steps done; UI Review waiting) | `claude/plugin-commands-auto` | [#263](https://github.com/MossesX/AmberX-AXF/pull/263) (merges after #250 and #249; UI Review r-20261103-3345d3d4) | axHub admin: allow `<plugin>_*`, `plugin_commands`, `plugin_read`, `plugin_run` on the `axf-console` service. Report `_claude/builds/reports/plugin-commands-auto.md` | 2026-11-03 |
| Model upgrades need Brett (Urgent `model-upgrade-approval`, Opus; Brett Nov 3, voice: "You can downgrade, but you can't upgrade."; replaces stopped `model-switch-approval`): downgrades pass + recorded; upgrades only by Brett's console click or axHub approval (`axf.orchestrator_upgrade_approve`, confirm); enforced in orchestrator core/CLI/server, launcher (`model-gate.mjs`), swarm planner; audit marked 3 self-approved upgrades + #247's switch | review | `claude/model-upgrade-approval` | #253 | axHub side: set `axf.orchestrator_upgrade_approve` to confirm and forward a signed approval header to downstream (axHub repo) | Nov 3 2026 |
| Console commands (Urgent `console-commands`; Brett Nov 3 07:16 ET voice): tell Amber to load screens — control@1 `console` namespace (open screen/dialog/settings tab, run action, back, list), live delivery to his open console, REST + MCP (axHub) + CLI `axf console …`. Opus. Builds on token-control (#246 + claude/token-control-opus) | PR open, UI review waiting (all 8 steps done) | `claude/console-commands` | [#249](https://github.com/MossesX/AmberX-AXF/pull/249) | auto-merge when CI green + UI Review approved; axHub: make sure service `axf-console` is registered and set console_* tools to allow (Brett, axHub admin) | 2026-11-03 |
| Token control plugin (Urgent `token-control`; Brett Nov 2 21:38 ET): API + MCP + CLI server/client for every theme/style/layout token (every layout param a token), wired to Claude + axHub; full control of AmberX tasks/to-dos/notes + Plan Studio + orchestrator; interactive docs. s1-s3 Fable, s4-s14 Opus. Folds in amberx-full-mcp-api (don't relaunch it) | waiting (Fable phase s1-s3 done; needs Brett's approval of the Fable → Opus switch, then s4-s14 on Opus) | `claude/token-control` | [#246](https://github.com/MossesX/AmberX-AXF/pull/246) (auto-merge when CI is green; the Opus phase continues on the same branch or a follow-up) | s1 layout tokens, s2 viewport attrs + layout-adopt + check-theme rule, s3 control@1 contract; next: `orchestrator.mjs act approve token-control 1`, then s4 | 2026-11-03 |
| What's new banner (Urgent `whats-new-banner`; Brett Nov 3, voice): banner ticker + unread count of features merged to main, panel grouped by date / build / app, search, details, read marks, settings. Plugin `whats-shipped` (display name What's new; the folder name avoids the systems check's own `whats-new` strip), feed whats-new@1 from merged PRs (GitHub, else git), builds store, reports, Codebase changes; deployed from deploy.yml runs or the `site` branch. Report `_claude/builds/reports/whats-new-banner.md`. | built, PR #260 open, waiting in UI Review r-20261103-8861306a | `claude/whats-new-banner` | #260 | Brett: approve the UI Review item; later switch the feed's rebuild trigger to orch-live-sync's builds-live events once on main (seam in `Sources.fingerprint`) | 2026-11-03 |
| Headless tabs (Urgent `headless-tabs`, 7 steps, Opus; Brett Nov 3, voice): every console terminal tab lives in a tmux session (re-attach + scrollback replay, Open in Moshi, detach vs Kill session); every headless run opens its own tab with agent · model · live cost + status dot (`deploy/claude-meter.mjs`, model-pricing.json, reconciled to total_cost_usd); split pane with the context chain (CLAUDE.md load order, imports, rules, Reads; rules typed out one at a time) | review (all 7 steps done; PR open, waits for UI Review) | `claude/headless-tabs` | [#259](https://github.com/MossesX/AmberX-AXF/pull/259) | Report `_claude/builds/reports/headless-tabs.md`. Brett: approve UI Review r-20261103-3sp5x01 (group `headless-tabs - Nov 3 9:44 AM`). Console needs a redeploy for tmux in the image. Tests: terminal 97/97, check-headless-tabs 30/30 | 2026-11-03 |
| Retire Patches and Build Pilot (Urgent `kill-patches-pilot`; Brett Nov 3, voice: "Patches is dead … Build Pilot dead"): removed both apps and every reference (repo, rules, store builds archived), VPS containers/Coolify apps after a snapshot to `/root/archive/retired-2026-11-03/`, axHub projects, axHub repo PR; MossesX/Build-Pilot archived | review (PR open, the push banner merges it) | `claude/kill-patches-pilot` | [#258](https://github.com/MossesX/AmberX-AXF/pull/258), axHub [#32](https://github.com/MossesX/axHub/pull/32) | report `_claude/builds/reports/kill-patches-pilot.md` | 2026-11-03 |
| Agent group chats on axHub (Breakroom profile; Brett Nov 3 voice): read-only redacted mirror of the Breakroom group chat on the hub (`agent-swarm/chats/` in amberx-axf `_data`, read with `axhub.memory_read`), a mentions-of-Brett filter (CLI + API), and a Breakroom "About Brett" view | PR open, UI Review waiting | `claude/agent-chats-hub` | (see PR) | push banner merges once CI + UI Review pass | 2026-11-03 |
| Notes vault (Urgent `notes-vault`, Opus; Brett Nov 3, voice): every hand-saved note (handoffs, session logs, plans, install notes, saved commands) moved into `/projects/_shared/_claude/notes/` with hub versions kept + `notes/INDEX.md`; console plugin `notes-browser` (Plugins → Notes) + capability `axf.notes@1`; md-studio s11 Notes scope | review (s1–s6 done; PR open, the push banner merges it; UI Review waiting) | `claude/notes-vault` | [#256](https://github.com/MossesX/AmberX-AXF/pull/256) | Report `_claude/builds/reports/notes-vault.md`. Brett: settle the `claude-sync` holds for the moved files in other checkouts (keep hub = delete local) | 2026-11-03 |
| Orchestrator live sync (Urgent `orch-live-sync`, Opus, 7 steps; Brett Nov 3, voice: "every completed step must reach the orchestrator and appear on main immediately"): store writes go live to main as status-only commits (`framework/cli/builds-live.mjs`), newer-wins merge, `built` = awaiting merge, reconciler (`builds-reconcile.mjs`, session start + 10-min cron), banner item `builds-live`, THREADS Live build log | review (all 7 steps done; PR open, the push banner merges it) | `claude/orch-live-sync` | [#255](https://github.com/MossesX/AmberX-AXF/pull/255) | Backfill live on main: dock-engine/token-control/theme-editor built, urgent-builds archived, xlayout 12/12; reconciler fixed 43 builds; 28 orphan PRs + 2 branches flagged. Report `_claude/builds/reports/orch-live-sync.md`. Brett: none needed | 2026-11-03 |
| AmberX app backups (Urgent `amberx-backup-fix`, Opus; Brett Nov 3, voice): `amberx-app-backup-1` restart-looped since ~Oct 3 because backup.sh had CRLF line endings (Windows upload). Fixed live on the VPS (LF script, CR-stripping entrypoint, 26 h healthcheck), fresh dump verified by a full scratch restore, new systems-check item `amberx-backups` | review (VPS fix live; PR open, the push banner merges it) | `claude/amberx-backup-fix` | opening | Brett: carry `.gitattributes` (`*.sh text eol=lf`) + the compose `backup` changes into the AmberX source repo on Windows, or the next deploy.ts upload reverts the compose. Old dumps archived in /opt/amberx-app/backups-archive. Report `_claude/builds/reports/amberx-backup-fix.md` | 2026-11-03 |
| Fable rebuild: agent swarm (Breakroom `agent-swarm-fable-rebuild`, 7 steps, Fable s1–s6 + Opus s7; Brett Nov 3, voice: "finish the Breakroom profile"): the swarm's seven contracts into `framework/core/engines/swarm-rules.mjs` (one registry, normalizers, field-naming validators, JSON Schemas, snapshot `schemas/swarm.json`, fixture `spec/fixtures/swarm.json`, `check-swarm.mts` in CI; plugin re-exports them), then planner, context packer, card/avatar check, group chat contract, vibe engine, differences report | review (all 7 steps done; PR open, the push banner merges it) | `claude/agent-swarm-fable-rebuild` | [#247](https://github.com/MossesX/AmberX-AXF/pull/247) | s1: contracts in the framework. s2: planner on the model policy, `fallback` agent, folder-vs-glob overlap, one agent one job across builds. s3: best-hit snippets, folder outlines (real brief 4321 → 352 tokens). s4: avatar as a part list from the card rules. s5: chat contract `swarm-chat.mjs`. s6: vibe engine `swarm-vibe.mjs`; `check-swarm.mts` 223 checks. s7: report `_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md` + LOG.md; no shots (the sandbox console cannot render without axHub; same pixels anyway). Brett: none needed | 2026-11-03 |
| Token control plugin (Urgent `token-control`; Brett Nov 2 21:38 ET): API + MCP + CLI server/client for every theme/style/layout token (every layout param a token), wired to Claude + axHub; full control of AmberX tasks/to-dos/notes + Plan Studio + orchestrator; interactive docs. s1-s3 Fable, s4-s14 Opus. Folds in amberx-full-mcp-api (don't relaunch it) | queued (needs a Fable session) | `claude/token-control` (not made) | - | s1 on Fable | 2026-11-02 |
| Token control plugin (Urgent `token-control`; Brett Nov 2 21:38 ET): API + MCP + CLI server/client for every theme/style/layout token (every layout param a token), wired to Claude + axHub; full control of AmberX tasks/to-dos/notes + Plan Studio + orchestrator; interactive docs. s1-s3 Fable, s4-s14 Opus. Folds in amberx-full-mcp-api (don't relaunch it) | PR open (all 14 steps done; UI Review item r-20261103-f9cd2905 waiting) | `claude/token-control-opus` (contains `claude/token-control`) | [#250](https://github.com/MossesX/AmberX-AXF/pull/250) (+ Fable phase [#246](https://github.com/MossesX/AmberX-AXF/pull/246)); push banner auto-merges when CI is green | plugin `apps/console-web/plugins/token-control`: runner + REST `/api/control` + MCP `control_*`/`amberx_*`/`plan_park` + CLI `axf control/token/note/todo/task/list/plan/build` + JS client + page (Tokens/Try it/Docs/Audit); tests in CI | 2026-11-03 |
| Theme veto pass (Urgent `theme-veto-pass`; Brett Nov 3 voice): timed pass so token changes skip the axHub veto ("allow theme changes for the next 30 minutes"); grant approved once by Brett, server-side expiry, deletes never covered, banner countdown, audit + undo, read tools read-only, axHub contract | PR open (all 7 steps done; UI Review waiting) | `claude/theme-veto-pass` (on `claude/token-control-opus`; **merge after #250**) | [#262](https://github.com/MossesX/AmberX-AXF/pull/262) | control@1 target `pass.scopes` + `core/engines/control-pass.mjs`; plugin `token-control` 0.2.0 (`lib/pass.mjs`, `web/pass.tsx`); MCP `token_pass_*`; CLI `axf token pass …`; contract CONTROL.md → Veto passes (for axHub build `axhub-veto-pass`) | 2026-11-03 |
| Pass all (Urgent `pass-all`; Brett Nov 3 voice: "It's 30 minutes to do whatever I tell you"): pass scope `all` is the default (every command, every plugin, every axHub call; ordinary deletes skip the confirm; irreversible only with `include_irreversible`); chip "Everything: 29:41 left"; undo lists what it can't roll back; axHub contract for `axhub-pass-all` | done (all 5 steps; UI Review `r-20261103-7cd5aa8b` waiting) | `claude/pass-all`, fast-forwarded onto `claude/theme-veto-pass` | [#262](https://github.com/MossesX/AmberX-AXF/pull/262) | merges with #262 | 2026-11-03 |
| Fable rebuild: agent swarm (Breakroom `agent-swarm-fable-rebuild`, 7 steps, Fable s1–s6 + Opus s7; Brett Nov 3, voice: "finish the Breakroom profile"): the swarm's seven contracts into `framework/core/engines/swarm-rules.mjs` (one registry, normalizers, field-naming validators, JSON Schemas, snapshot `schemas/swarm.json`, fixture `spec/fixtures/swarm.json`, `check-swarm.mts` in CI; plugin re-exports them), then planner, context packer, card/avatar check, group chat contract, vibe engine, differences report | review (all 7 steps done; PR open, the push banner merges it) | `claude/agent-swarm-fable-rebuild` | [#247](https://github.com/MossesX/AmberX-AXF/pull/247) | s1: contracts in the framework. s2: planner on the model policy, `fallback` agent, folder-vs-glob overlap, one agent one job across builds. s3: best-hit snippets, folder outlines (real brief 4321 → 352 tokens). s4: avatar as a part list from the card rules. s5: chat contract `swarm-chat.mjs`. s6: vibe engine `swarm-vibe.mjs`; `check-swarm.mts` 223 checks. s7: report `_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md` + LOG.md; no shots (the sandbox console cannot render without axHub; same pixels anyway). Brett: none needed | 2026-11-03 |
| Shared dock engine (Urgent `dock-engine`, Fable): split/float/re-dock/drop zones/10 layout presets on the windows engine; used by MD Studio, xLayout (replaces its s3), Theme Editor | queued (needs a Fable session) | `claude/dock-engine` (not made) | - | run first | 2026-11-02 |
| Shared dock engine (Urgent `dock-engine`, Fable): split/float/re-dock/drop zones/10 layout presets on the windows engine; used by MD Studio, xLayout (replaces its s3), Theme Editor | review (built s1-s4 on Fable, headless run `molly-fable`; orchestrator complete; PR from `claude/molly-fable`, push banner merges) | `claude/molly-fable` | [#245](https://github.com/MossesX/AmberX-AXF/pull/245) | `core/engines/dock.ts`, dock-layout@1 (10 starters baked into every app), `react/windows/DockHost.tsx`, `spec/fixtures/dock.json`, `spec/check-dock.mts`; UI Review: waiting, item r-20261103-80e15b02 in group "molly-fable - Nov 3 6:46 AM" (console Libraries → Docked comparisons + Pane layout dialog, desktop + phone) | 2026-11-03 |
| MD Studio plugin (Urgent `md-studio`, Opus; Brett Nov 2 21:30 ET): md browser/editor, scope column Project/Claude/Repo, docking tabs, reference branches + click-to-split, 3 views + IDE view, snippets, Claude-file wizards | queued (after dock-engine) | `claude/md-studio` (not made) | - | waits on dock-engine | 2026-11-02 |
| Theme Editor plugin (Urgent `theme-editor`, Opus; Brett Nov 2 21:30 ET): colour + style sections, every token, copy/save/load, multi-view toolbar; reuses Theme manager's tree (web capability `axf.token-tree@1`) | PR open, waiting in UI Review (r-20261103-6a35ef38); orchestrator complete | `claude/theme-editor` | #243 | auto-merges once UI Review approves + CI green; dock engine adoption later | 2026-11-03 |
| Walkthrough random looks (Brett Nov 2 14:36 ET: random design pack for stack chapters 5-10; recording-only look, axHub look untouched). Orchestrator `walkthrough-random-look` (Refactor, Opus) | working (re-recording on the VPS) | `claude/walkthrough-random-look` | - | re-record cli,console,plugins,builds,guardrails,agents | 2026-11-02 |
| xLayout: Molly as ONE app (Brett Nov 2 13:46 ET: one banner, app menu, nav, context menu across AmberX + axHub + Console; IDE switch with draggable/resizable/dockable panes, pane limit, 10 preset layouts with preview; up to 3 plugin toolbars, Toolbar designer from settings hook + right-click any toolbar; open in main/floating/pane). Orchestrator `xlayout` (Big Dog), s1-s3 Fable, s4-s12 Opus. Replaces queued 'Molly: one app' | review (all 12 steps built: Fable s1-s3 on `claude/molly-fable` #245, Opus s4-s12 on `claude/xlayout-opus` #252; UI Review waiting, group "xlayout - Nov 3 7:28 AM"; push banner merges #245 then #252) | `claude/xlayout-opus` | [#252](https://github.com/MossesX/AmberX-AXF/pull/252) (after [#245](https://github.com/MossesX/AmberX-AXF/pull/245)) | Brett: UI Review approve / changes; then redeploy AmberX, axHub web, Console so the live guests merge | 2026-11-03 |
| Molly: one interface for AmberX, axHub and the Dev Console (Brett Nov 2: combine them into one interface, keep them separate apps; Opus version named Molly at molly.amberxai.com, Fable version later) | deploy | `claude/project-thread-nxdu3m` | #230 merged | first VPS install failed (old GitHub token); installer now uses the GitHub App broker (follow-up PR); DNS A record molly needs Brett; UI Review shots | 2026-11-02 |
| Whole-stack walkthrough plugin (Brett Nov 1: ~90 min narrated walkthrough of framework, console, AmberX, axHub, VPS, MCP in Amber's voice; AmberX plugin with editable voice + downloadable video) | review | `claude/project-thread-646cjb` | #229 | built; next: merge, then record on the VPS (`WALKTHROUGH=stack bash apps/amberx-droid/walkthrough/rebuild.sh`, veto call); plan `_claude/memory/docs/walkthrough-everything.md` (12 steps, ~7 h, Opus). Queued (waits for go): orchestrator `orch-step-click`, Brett can't click Build orchestrator steps | 2026-11-01 |
| One default look from axHub + design theme precedence (Brett Nov 1: new default style + colour theme every app inherits, combined into a default design theme; a loaded design theme wins, a later style/colour pick overrides only its part; app Settings → Appearance selection only, plugin settings untouched; banners didn't compress). Opus build merged (#228); **Fable review + banner contract** relaunched Nov 3 as `one-look-default-2` (the Nov 1 headless run died on the weekly limit) | review | `claude/one-look-default-2` | #244 | Fable review of the precedence contract (swap of the package slot loads it, Restore = default package in full, applied = the slot, retired `appearance-package` slot), thin banner's day/night switch moved into the framework copy (per-app overrides dropped, fixtures regenerated), check-hub-look on the three real apps (110 checks); app builds + tests green, UI Review shots waiting (group "One look - Nov 1"), report `_claude/builds/reports/one-look-default.md`; PR #244 open, push banner merges it when CI is green. Kotlin twin deferred (PORTING.md) | Nov 3 2026 |
| One look from axHub + every app ships every shareable asset (Brett Nov 1: "apps only get appearance from axhub period", "any theme change applies to all", "ship all assets that can be shared"; Patches, demo, Walkthrough left out). No follow switch, no console look tabs, look settings in appearance@1, shared set baked at src/axf/assets (claude.ai session, Opus: the Fable headless build hit the weekly limit) | review | `claude/hub-look-all-assets` | #225 | Fable review of the appearance@1 `settings` contract + `shared` flag; Kotlin twin deferred (PORTING.md). Report `_claude/builds/reports/hub-look-all-assets.md` | Nov 1 2026 |
| Fable review of Opus-built foundation work (Brett Nov 1: Opus or Fable only, never Sonnet; Fable reviews first, rebuilds only what it flags): builds@1, UI Review schema, help@1, job-type@1 + agent cap, session@1, agent swarm data model (Fable, headless VPS) | review (branch pushed; Brett's session lands it with build_land) | `claude/fable-review` | — | Verdicts: builds@1 fix (store self-validator + `framework/spec/BUILDS.md`), UI Review fix (one time zone rule), job-type fix (model-policy@1: Opus or Fable only; starters, roster, planner, plan picker), help@1 OK, session@1 OK, agent cap OK, agent swarm → pending `agent-swarm-fable-rebuild` (Breakroom; agent-card@1 taken out of scope). Shared rule line added; RULES.md hub conflict resolved (local was the superset). Report `_claude/builds/reports/fable-review.md` | 2026-11-01 |
| Fable launch (Brett Nov 1): `vps.build_start` takes `model: fable` (CLI alias → claude-fable-5-1); models from the ssh service's `config.buildModels` (default opus, fable; no sonnet); `build_list` shows the model (axHub #111, headless VPS, Opus) | done, live | `claude/fable-launch` → main (axHub, 998f03f) | — | redeployed 11:06 UTC; live Fable build via build_start answered claude-fable-5-1, stopped | Nov 1 2026 |
| Asset conformance (Brett Oct 31): handwritten + generated UI code conforms to the hot-swappable asset system; check-theme/check-controls extended to every web UI + Kotlin, file:line + token to use, frozen Android/Patches baseline, axf init gate, briefs carry the rule (headless VPS, Opus) | stopped (push blocked) | `claude/asset-conform` (committed locally in /root/axf-builds/asset-conform) | none yet | Push failed: no GitHub credentials on the VPS (banner item `blocked:push:asset-conform`). To carry on: from a host with a token, `git push origin HEAD:claude/asset-conform` (push banner opens the PR; Brett's Oct 30 rule is PR-only, so prefer that over the brief's direct push to main). Report `_claude/builds/reports/asset-conform.md`. Left: Android Kotlin (286 findings, baselined) once Android is off hold; Patches CSS (14) once unpaused | 2026-10-31 |
| Veto complete (Brett voice Oct 30): 90 s countdown; Approve now + Shelve next to Deny (axHub decision #104); the veto banner plugin owns notices, veto screen and a configurable alarm and loads in AmberX too; AmberX phone: notice buttons Deny / Approve / Shelve, tap = veto screen, alarm through silent mode (VPS launch, Refactor, Opus) | review | `claude/veto-complete` (AXF on #176, axHub on #19) | PRs being opened (veto calls) | Built + tested; live `vps.run` / `vps.logs` already on 90 s. Left: CI green on both PRs → auto-merge; axHub redeploy brings Approve now / Shelve + the 90 s default for every #103 call; install the new AmberX APK (Android CI) | 2026-10-30 |
| AXP backup + :3200 flap (Opus): xchat/devstudio/demo code to private MossesX repos (copies in /root/axp-backup, gitleaks clean, nightly axp-backup.timer); demo nginx resolves the devstudio IPv4-only | waiting on Brett (repo creation refused by the gh token) | `claude/axp-backup` | — | Brett: create MossesX/axp-xchat, axp-devstudio, axp-demo (Private, empty) — axp-backup-finish.timer pushes within 15 min and turns the nightly on. Flap fixed live Nov 1. Report /root/axp-backup/REPORT.md | 2026-11-01 |
| Help mode (help-mode, Opus, headless): ? switch + F1 + Help menu + Settings + AmberX voice; help@1 packs; tooltips on every control (hover / phone ? badges / long-press), What is this?, screen intros once per screen; coverage CLI + CI ratchet; packs for the framework, console + 47 plugins, axHub web | done (pushed to main) | `claude/help-mode` → main | — | 15 shots in UI Review → Screenshots "Help mode - Nov 1". Next: edit the 700 console drafts into plain English (plugin help.json), app packs for AmberX web + Walkthrough Studio. Report `_claude/builds/reports/help-mode.md` | 2026-11-01 |
| GitHub App for the whole stack (`github-app`, Opus, headless): one-click GitHub App (manifest flow: Create → Install on All repositories → Authorize as Brett), token broker `framework/cli/github-token.mjs` (installation tokens minted from the app key, renewed at 50 min; user token refreshed, rolled), console keeper puts `GITHUB_TOKEN` on the app (old PAT = fallback), git credential helper + gh wrapper on the VPS, health items, `axf repo create`; axp-backup finish timer creates its 3 repos once authorized | done (waiting on Brett's 3 taps) | `claude/github-app` → main | — | Brett: Settings → Plugins → GitHub, 3 taps. Follow-up: axHub's github connector on the app. Report `_claude/builds/reports/github-app.md` | 2026-11-01 |
| Chat viewer (chat-viewer, Opus): every session (claude.ai text + voice via export upload or the hub drop folder "sync my chats", Claude Code JSONL incremental, headless build logs) as session@1 in SQLite + FTS5; check for updates on load (new / continued / changed, versions), redaction on ingest, DataGrid list, search → jump, bubbles, export; two-voice audio export (Piper free, OpenAI / ElevenLabs) with chapters, on the hub; console plugin + AmberX "Chats" | done (tests green) | `claude/chat-viewer` → main | — | Re-run `install-console.sh` once for the read-only session mounts; tap Set up free voices. Screenshots: UI Review → Screenshots "Chat viewer - Nov 1". Report `_claude/builds/reports/chat-viewer.md` | 2026-11-01 | <!-- axf-plugin:chat-viewer -->
| AmberX walkthrough video (Brett Nov 1: like the demo.amberxai.com one): narrated chapters in Amber's voice, recorded on the live app with demo data at 412×915, player in AmberX (Home card, AmberX menu, Help, `walkthrough.open:<chapter>`), media behind the wall at `/api/walkthrough/*`, one command `walkthrough/rebuild.sh` + console button (Molly guide → Re-record) | done (on main) | `claude/amberx-walkthrough` | — (pushed to main) | 9:12, 15 chapters, live at AmberX → Walkthrough. Shots in UI Review group "AmberX walkthrough - Nov 1". Re-record when the Quiet switch lands. Report `_claude/builds/reports/amberx-walkthrough.md` | 2026-11-01 |
| Agent jobs (Breakroom `agent-jobs`, Opus, headless): recurring work goes to hired agents. `job-type@1` asset type + six starters; six-agent crew (Reel Rhonda, Ping Paulie, Snap Sully, Landin' Lenny, Janitor Joey, Earl the Ear); router `node framework/cli/agent-job.mjs <job-type>` (owner, duty + budget, brief + own notes only, claude-headless launch as `axf-<agent>-<job>`, run booked on the agent); Breakroom Jobs view + one-tap hire; RULES section; install_steps Part J | done (pushing to main) | `claude/agent-jobs` | — (direct push, Brett's brief) | Report `_claude/builds/reports/agent-jobs.md`. UI Review Screenshots group "Agent jobs - Nov 1". Follow-ups: cron for `due --run`, hook `build.finished` → lander | 2026-11-01 |
| Activity banner fix (banner-fix, Opus, headless): ghost command lines closed (PostToolUse re-registered for root + axfbuild, headless runs ensure hooks, Stop/SessionEnd close a session's open lines, 5-min expiry, lines go with their session), reads not counted as Merging/Deleting, one row per session, banner folded to its counts line and ≤30% open, GitHub reads through axHub (the 403 was the token's rate limit), holds read the builds store, systems-check items activity-hooks + activity-github | done (on main af027d6e) | main (direct push, Brett's brief) | — | Report `_claude/builds/reports/banner-fix.md`; shots in UI Review → Screenshots, group "Banner fix - Oct 31 night" | 2026-11-01 |
| Agent cap + queue (agent-cap, Opus, headless; orchestrator `agent-cap` in Breakroom): configurable max running agents (6), heavy test/build lock (3), memory guard (2 GB), FIFO+priority queue that starts by itself, finished sessions auto-close; `framework/cli/agent-slots.mjs` + `deploy/claude-headless.sh` + swarm; `agent-slots` plugin (settings, banner chip, Builds-page queue, desks, systems-check item) | done (tests green) | `claude/agent-cap` → main | — | Report `_claude/builds/reports/agent-cap.md`; screenshots in UI Review → Screenshots, group 'Agent cap - Nov 1'. Gaps: heavy lock is opt-in per command (brief asks for it); banner chip shows only while the activity banner is up. Old finished `axf-*` tmux sessions close on the first launch after deploy. To carry on: in /root/axf-builds/agent-cap run `node framework/spec/check-agent-slots.mjs`, `python3 apps/console-web/plugins/agent-slots/test.py`, then `git fetch origin && git merge origin/main && git push origin HEAD:main` <!-- axf-plugin:agent-slots --> | 2026-11-01 |
| Expandable approval rows (approval-expand, Opus, headless): caret far right, details in place (reason, exact call + copy, who asked, tool/policy/risk, timeline, result + output tail, Deny/Approve inside), stays open on refresh; one shared lib-approvals row in the axHub list, console banner, AmberX view, title-bar popover, and the app-menu "Waiting for approvals" dropdown (menu rows `expand`, AppMenu `registerMenuRowDetails`); axHub grid rows open on tap with the same panel | done (on main 5e9b3475) | main (direct push, Brett's brief) | — | UI Review r-20261101-396ffb92 waiting. Report `_claude/builds/reports/approval-expand.md` | 2026-11-01 |
| Watch live (Brett: "Watch live = HOT RENDER"): a Watch live link on every running build (Build manager, Build orchestrator) and approval details pops up the screen the session is changing, element outlined, hot-rendering; headless launcher starts previews, console proxies /preview behind auth, `axf focus` | testing | `claude/watch-live` | — (pushes to main) | waiting for approval-expand on main, merge, retest, push; Brett: UI Review r-20261101-ksry601 | 2026-11-01 |
| Who asked, on every approval (Brett: "every approval just says vps.run"): axHub decision 109 records the source (Claude.ai / Claude Code / Headless / Console / Agent / System) + session/build/agent name + MCP client on every held/confirm request; console, agents and headless builds send `X-Axhub-Session`; approvals grid (DataGrid: Source, Who, What, Requested, Countdown; sortable, source filter), dropdown rows, request page and AmberX hub view show it (headless `approval-source`, Opus) | done | `claude/approval-source` (AXF + axHub), pushed to main | — | axHub redeploys from main (Coolify); UI Review shots not taken (headless) | Nov 1 2026 |
| Watch live (Brett: "Watch live = HOT RENDER"): a Watch live link on every running build (Build manager, Build orchestrator) and approval details pops up the screen the session is changing, element outlined, hot-rendering; headless launcher starts previews, console proxies /preview behind auth, `axf focus` | review | `claude/watch-live` | — (pushed to main) | approval-expand never reached main within the 90 min wait: when it lands, add `<WatchLiveFor>` to its expanded row details; Brett: UI Review r-20261101-ksry601 | 2026-11-01 |
| UI Review → Screenshots tab (headless VPS, Opus): ad-hoc screenshots store (`ui-screenshot@1`), intake API (JSON/multipart, token) + `axf shot` CLI + Upload, DataGrid grouped by app/screen/source/day, thumbnails, full-screen viewer with before/after slider, copy link, delete, Send to review; `Breakroom check:` items migrate out of the review queue; RULES + build briefs say use `axf shot` | stopped (built + tested, push blocked: VPS GitHub token 401) | `claude/shots-tab` (local in /root/axf-builds/shots-tab, merged with origin/main e46b8079, not pushed) | — | Also fixed main's red theme + output-recorder lifecycle checks. To carry on: new token → console Keys, then in that worktree `git fetch origin && git merge origin/main`, rerun ui-review tests + check-theme, `git push origin HEAD:main`. Banner `blocked:github-token-shots-tab`. Report `_claude/builds/reports/shots-tab.md` | 2026-11-01 |
| UI Review → Screenshots groups (shot-groups, headless VPS, Opus): every screenshot in one named, timestamped group (`shot-group@1`); intake + `axf shot --group` (same name same day reuses; auto `<session> - <YYYY-MM-DD HH:mm>`); tab opens on the group list (cover, time, count, source; search name/date/app/source), Rename / Merge / Select+Move / Delete; ungrouped shots (Breakroom check) migrate into `<prefix> - <date time>` groups; shared rule: ask Brett for the group name, headless = build name | done (tests green) | `claude/shot-groups` → main | — | Report `_claude/builds/reports/shot-groups.md`. Gaps: no move-from-viewer | 2026-11-01 |
| UI Review: one schema (review-schema, headless VPS, Opus): everything in UI Review (queue + Screenshots, any source) is `ui-review-item@1` / `ui-review-group@1` — name, group, createdAt, kind, source, sender, app, screen, viewport, files, status; every intake refuses missing fields by name (API, multipart/Upload, review.mjs, shot.mjs, rebuild-shots --submit, ui-review@1.submit, Send to review); stores validate on every write; migration (dry run → apply, server runs it on start); CI `check-ui-review.mjs`; shared rule line | done (tests green) | `claude/review-schema` → main | — | UI Review r-20261101-b57bz01 waiting. Report `_claude/builds/reports/review-schema.md`. Live data migrates when the new console starts (dry run: 17 records, 0 left) | 2026-11-01 |
| Urgent: master cleanup — one builds store (builds@1) for every profile, versioned writes, no queue re-create on start; Builds page (Builds + Steps views, rename, drag, divide, harvest / split into N, Restore default, draft until Apply); live progress bars + banner %; push banner duplicate-PR fix (headless, Urgent profile, Opus) | blocked (push) | `claude/urgent-builds` (local only: /root/axf-builds/urgent) | — (not pushed: the VPS host has no GitHub token; banner alert `blocked:push:claude/urgent-builds` has the steps) | UI Review `r-20261101-itzed01` waiting; follow-up: fold the old Build manager / Pending / Queue / Fable rebuilds pages into the Builds page and remove them | 2026-11-01 | <!-- axf-plugin:builds-page -->
| Approve / Deny in the application menu (Brett: Approvals → Waiting for approval shows each call with no buttons): green Approve + red Deny on every waiting row of the app menu's live list, live countdown on held calls, row flips to Running / Denied in place then drops off, no list reload; done once in the framework app menu (row `buttons`, provider `act`) + lib-approvals `installApprovalsMenu`, used by axhub-web, AmberX and the console's approvals banner (headless VPS, Opus) | blocked (push: VPS GitHub token dead, 401) | `claude/menu-approve` (local in /root/axf-builds/menu-approve, merged with main, not pushed) | direct to main (brief) | Built + tested (75/75 local CI block, 4 app builds); also fixes two checks red on main (check-theme `#108` comments, output-recorder lifecycle mention). Flicker fix never reached main (its push is blocked the same way); merged main as it stood. Banner item `blocked:push-menu-approve`. To carry on: new GitHub token → console Keys banner `GITHUB_TOKEN`; push `/root/axf-builds/flicker` first, then here `git fetch origin && git merge origin/main`, `npx -y tsx framework/spec/check-approvals-menu.mts`, `git push origin HEAD:main`. Test `framework/spec/check-approvals-menu.mts` (jsdom). Report `_claude/builds/reports/menu-approve.md` | 2026-11-01 |
| Session recording through axHub (rec-control, Opus, headless): axHub service `amberx` over AXPP (`recorder_start` = straight approval, stop/status allow; axHub #108) + AmberX `AxppLink` drives the existing Audio Output Recorder (session part names, groups, notification) + shared rule | deploy | main (direct push, Brett's brief) | — | Install the new AmberX APK from CI; Coolify redeploys the hub. Report `_claude/builds/reports/rec-control.md`. Open: the opt-in mic switch doesn't exist (recorder has no mic path), UI Review shots for the grouped list | 2026-11-01 |
| Agent swarm (Breakroom `agent-swarm`, 19 steps, Opus, all done): headless specialist agents, leases, runner, cost meter, statuses, salaries, cards, chat; + ID cards as assets (`agent-card@1`, 4 starters, gallery, designer), DataGrid Agents/Cost tables; fixed main's red CI (engine sweep profile pin, voice.ts tsc, output-recorder Node 22 import) | done (pushed to main Oct 31) | `claude/agent-swarm` | [#196](https://github.com/MossesX/AmberX-AXF/pull/196) | Report `_claude/builds/reports/agent-swarm-2026-10-31.md`. Brett: pick the default card (Swarm → ID cards → Make default); resolve the held hub copy of the Breakroom orchestrator. Fable rebuild parked (`agent-swarm-fable-rebuild`, Breakroom) | 2026-10-31 |
| Approve now in axHub web (Brett's screenshot: veto row with only Deny, header "Nothing waiting" with 1 waiting): green Approve now next to Deny on every waiting row, banner and request page (equal pair, big targets, title cuts first); notice `?do=` pick honoured (marked + focused, one tap); header counts held calls (VPS headless, Opus) | blocked | `claude/approve-now-web` (ae513a64, not pushed: no GitHub credentials on the VPS) | — | **axHub server redeploy** still needed: the live hub runs afffc6e (Oct 29), 6 commits behind main (#103-#105), so it has no approve-now route; banner item `blocked:axhub-redeploy`. Report `_claude/builds/reports/approve-now-web.md` | 2026-10-31 |
| axHub web approvals screen flicker (Brett, phone: whole screen flashing "Reading the hub" during a veto countdown): the waiting screen only before the first look read, look applied once per real change, blips keep the list, rows memoised so the countdown ticks only its number; same for AmberX's hub view (VPS headless, Opus) | blocked | `claude/axhub-web-flicker` (merged with main, all local checks green; not pushed: the VPS GitHub token is dead, 401) | — | **To carry on:** once a new GITHUB_TOKEN is in the console Keys banner: `cd /root/axf-builds/flicker && git fetch && git merge origin/main && (cd apps/axhub-web && npx tsx scripts/refresh-check.mts) && git push origin HEAD:main`. Banner item `blocked:push-axhub-web-flicker`. Report `_claude/builds/reports/axhub-web-flicker.md`; Kotlin twin deferred (PORTING.md) | 2026-11-01 |
| AmberX: one listener, no repeat "Note saved", no ding loop (proven from hub notes: AmberX re-saving its own mis-heard "Note saved to Inbox" via always-armed + AI notes; Android replaying retained wake events on open; Chrome hands-free restarting with its ding) — one owner per device, handled event ids, Quiet switch, Sound and microphone settings (Opus) | done (pushing to main) | `claude/amberx-listeners` | — | AmberX test.mjs 2045→2101, veto banner 11/11, tsc + vite build, theme/controls/pages/validate green. Shots in UI Review → Screenshots "AmberX listeners - Nov 1". Install the new APK (CI `amberx-debug.apk` → hub Apps). Waiting on Brett: go to delete 122 duplicate loop notes (dry run `_claude/builds/reports/amberx-listeners-notes-dryrun.md`). Report `_claude/builds/reports/amberx-listeners.md` | 2026-11-01 |
| AmberX recorder: opt-in mic so both sides of a session get recorded (recorder-mic, Opus, headless): "Record my mic too" (off by default), `recorder_start` `mic` arg + approval "Playback + MIC", stereo chunks L=mic R=playback, mic-busy fallback (marked + notification), Stop mic, released on stop, no new listener | deploy | main (direct push, Brett's brief) + axHub `claude/recorder-mic` (push banner opens the PR) | — | output-recorder 18→24, JUnit TwoTrack 9 + RecorderControl mic, AmberX 2143/2143, axHub 517/517 (Node 22). Install the new AmberX APK (CI `amberx-debug.apk`); axHub branch must merge for the approval title. Shots: UI Review → Screenshots "Recorder mic - Nov 1" (no native notification shot: no emulator). Report `_claude/builds/reports/recorder-mic.md` | 2026-11-01 |
| AmberX Mic off kill switch + let go of the mic for other apps (Brett: "turns the green dot off my phone"; Claude voice call couldn't get the mic) (headless, Opus) | done (branch pushed; Brett lands it with build_land) | `claude/amberx-mic-kill` | — | Native `MicGuard` (one gate: wake listener, classic loop, one-shot, Speak, recorder mic), quick-settings tile "AmberX mic", Mic off/on on the notification; page gate `micguard.ts` (getUserMedia + SpeechRecognition); Home switch, banner chip, toolbar, menu, Settings; hands-free yields to calls/VoIP/other apps and comes back. Cause: always-on wake listener never yielded + `02e951c2` re-sends voice config on every sound/device change (re-grabs). test.mjs 2192/2192, tsc, vite, theme, controls, validate green; JUnit MicRulesTest in CI. **New APK required** (Android CI dispatched on the branch, run 41328213281 → `amberx-debug.apk`). Shots in the report folder (not sent to UI Review: no console token here). Report `_claude/builds/reports/amberx-mic-kill.md` | 2026-11-01 |
| AmberX fix: voice loop ("nothing in Inbox" spoken over and over: speech gate, mic held while talking, echo dropped, empty states silent) + screen recording blocked (no FLAG_SECURE; opt-in "Hide sensitive screens from recordings", off by default) (headless, Opus) | stopped (push blocked: VPS GitHub token invalid) | `claude/amberx-fix-loop-securescreen` (local in /root/axf-builds/amberx-fix, merged with origin/main f7170f65 at c9a80e50, retested, not pushed) | — | Built + tested; merged with main and retested (test.mjs 2037/2037, tsc, theme, controls, lifecycle, validate). Both pushes (HEAD:main and the branch) fail: `remote: Invalid username or token`; axHub denied headless; banner item raised. To carry on: new GitHub token → `gh auth login -h github.com`, then in that worktree `git fetch origin && git merge origin/main`, `npx -y tsx apps/amberx-droid/test.mjs`, `git push origin HEAD:main` + push the branch; CI builds the APK. Report `_claude/builds/reports/amberx-fix-loop-securescreen.md` | 2026-10-31 |
| AmberX look fix (Brett recording Oct 31): shared look restored on the hub (data split at the 23:36 axHub redeploy), AmberX may frame approval pages (axHub #107) + Open-on-the-hub fallback, readable ntfy pushes that ring once per phase (headless VPS, Opus) | done | `claude/amberx-look-fix` → main (AXF + axHub) | direct to main (Brett asked) | Report `_claude/builds/reports/amberx-look-fix.md`. Follow-up: find what split `/projects` into `/projects/projects` at 23:36 | 2026-10-31 |
| Every change through a PR, pulled up to date with main before it merges (push banner 0.5.0: autoPr, no direct merges, behind → pull → wait for CI → merge, oldest first, one merge per round, branch protection on main / systems check Auto fix) (VPS build session, Refactor, Opus) | review | `claude/pr-only-merge` (on `claude/veto-everywhere` = #176) | opened through the push banner (veto call) | Merges by itself once #176 is in and CI is green; then the console redeploys and the next round opens PRs for every branch. Orchestrator build `pr-only-merge` (refactor) | 2026-10-30 |
| Compact the whole app (Angel `app-compact`): framework-wide tighter page heads, buttons, chips, cards, tables; count strips; Plugin Manager one column on phones (claude.ai, Opus) | pr-open | `claude/angel-app-compact` | — | Merge; follow-up pass for per-screen button walls | 2026-10-30 |
| Layouts: repeating slots (Angel `layout-repeating-slots`, Opus) | review | `claude/layout-repeating-slots` | [#191](https://github.com/MossesX/AmberX-AXF/pull/191) | Merge once CI (Kotlin) is green | 2026-10-31 |
| Compact every plugin page (Angel `screens-compact`; lead + 3 sub-agents on branches -plugins-a/b/c) | pr-open | `claude/angel-screens-compact` | — | Merge. Next: Angel `ui-all-assets` (slimmed to typography / density / component-sizing assets; Fable s1–s2 first) | 2026-10-30 |
| One place changes everything (Angel `ui-all-assets`): typography@1 / density@1 / sizing@1 — s1–s2 Fable (#181, merged); s3–s5 Opus (Oct 31, headless): tighter compact defaults, every screen/plugin/lib/AmberX reads the tokens, check-theme rule `scale`, theme-swap swaps the three types; also fixed main's red CI (lifecycle stale refs, menu-reach) | done (pushed to main Oct 31) | `claude/ui-all-assets` | — | Report `_claude/builds/reports/ui-all-assets-2026-10-31.md` (before/after shots beside it). Next: UI Review submission of the shots | 2026-10-31 |
| Compact every plugin page (Angel `screens-compact`; lead + 3 sub-agents on branches -plugins-a/b/c) | done (merged Oct 30, #180) | `claude/angel-screens-compact` | — | Merge. Next: Angel `ui-all-assets` (slimmed to typography / density / component-sizing assets; Fable s1–s2 first) | 2026-10-30 |
| Compact the whole app (Angel `app-compact`): framework-wide tighter page heads, buttons, chips, cards, tables; count strips; Plugin Manager one column on phones (claude.ai, Opus) | done (merged Oct 30, #178) | `claude/angel-app-compact` | — | Merge; follow-up pass for per-screen button walls | 2026-10-30 |
| Feature matrix UI tightened: every build and feature is one tap-to-open line (plain-English title, kept count, time, $ cost); opens to a plain description, cost, model and the technical text (claude.ai, Refactor, Opus) | pr-open | `claude/feature-matrix-compact` | [#172](https://github.com/MossesX/AmberX-AXF/pull/172) | Merge approval once CI is green. New items without plain text fall back to their own name (a `plain` field in feature-matrix@1 would be a Fable contract change) | 2026-10-29 |
| Settings redesign (Angel `settings-compact`): tap-in section list, one-line level bar, flat hairline groups, dropdown design package; + Angel builds `plugin-floatable` (queued, Fable first) (claude.ai, Opus) | pr-open | `claude/angel-settings` (also brings the Angel profile from `angel/home-cards-queue`) | [#175](https://github.com/MossesX/AmberX-AXF/pull/175) | Merge, then next Angel build | 2026-10-30 |
| Plan Studio (Angel `plan-studio`): plan@1 plans entered by hand, categories, 6 views, Catalog of every plugin/app/library with have/planned features, plain-English AI, AmberX voice planning, Turn into a build; Docs Studio + Selling It + ClipX imported parked (Opus) | review (push + PR waiting on a veto call) | `claude/plans` | — (veto call opens it) | Veto call pushes `claude/plans`, opens the PR, closes draft #159 ("Moved to Plan Studio as the parked plan Docs Studio", branch kept). Then CI → merge approval. Don't merge yourself | 2026-10-30 |
| Compact the whole app (Angel `app-compact`): framework-wide tighter page heads, buttons, chips, cards, tables; count strips; Plugin Manager one column on phones (claude.ai, Opus) | pr-open | `claude/angel-app-compact` | — | Merge; follow-up pass for per-screen button walls | 2026-10-30 |
| Settings redesign (Angel `settings-compact`): tap-in section list, one-line level bar, flat hairline groups, dropdown design package; + Angel builds `plugin-floatable` (queued, Fable first) (claude.ai, Opus) | done (merged Oct 30) | `claude/angel-settings` (also brings the Angel profile from `angel/home-cards-queue`) | [#175](https://github.com/MossesX/AmberX-AXF/pull/175) | Merge, then next Angel build | 2026-10-30 |
| Build Breaker console plugin: every ask Brett made (390, build-asks@1), one line each, per-app + per-plugin grids + timeline, permanent Build context menu (Opus) | review (pr-open) | `claude/build-breaker` | [#174](https://github.com/MossesX/AmberX-AXF/pull/174) | Waiting on CI + Brett's merge; then sessions keep the asks current with the plugin's `asks.mjs add / set-status` | 2026-10-29 |
| Look refactor from scratch: design-pack rounds in the Design packs section of UI Review (View → Design packs; the plugin became UI Review Oct 30, picks kept) until Brett picks 3, then rebuild every default style asset from them; Build Breaker plugin (every ask in history) + Build context menu (claude.ai, Opus + Fable where needed) | in-progress | `claude/design-packs`, `claude/build-breaker` | [#173](https://github.com/MossesX/AmberX-AXF/pull/173), [#174](https://github.com/MossesX/AmberX-AXF/pull/174) merged Oct 30 | Waiting on Brett's 3 picks in Design packs; then orchestrator build in the newest profile | 2026-10-29 |
| Feature matrix UI tightened: every build and feature is one tap-to-open line (plain-English title, kept count, time, $ cost); opens to a plain description, cost, model and the technical text (claude.ai, Refactor, Opus) | done | `claude/feature-matrix-compact` | [#172](https://github.com/MossesX/AmberX-AXF/pull/172) | Merged Oct 30 2026. New items without plain text fall back to their own name (a `plain` field in feature-matrix@1 would be a Fable contract change) | 2026-10-29 |
| Design packages do nothing + developer apps look different (orchestrator `shared-look-fix`, Refactor, Opus) | done | `fix/design-package-shared-look` | [#170](https://github.com/MossesX/AmberX-AXF/pull/170) | Console goes back to Main when a look is applied; scoped views no longer leak the GizmoX tab's slots/palette to axHub; console, AmberX, axHub web and Walkthrough Studio ship the same 26 design packages + 25 style packages with identical theme copies. Merged Oct 29 14:56 EDT. Console + apps pick it up on their next deploy | 2026-10-29 |
| Console Home cards (card@1 assets plugins carry; Home detects, shows/hides, always rendered; card layouts; cards for 31 data plugins) | queued (Angel profile, nothing built) | – | – | Orchestrator build `home-cards` (angel): Fable s1–s5 card contract + engine → approval → Opus s6–s18 Home, layout toolbar, cards. First message: `Start orchestrator build home-cards (angel) in AmberX-AXF: Fable phase. Read the brief with AXF_BUILD_PROFILE=angel node orchestrator.mjs brief home-cards, and the matrix angel:orchestrator:home-cards.` | 2026-10-29 | <!-- axf-plugin:build-orchestrator -->
| No sub-agents in the AI assistant: CLI Task/Agent tool always denied (orchestrator `assistant-no-subagents`, Refactor, Opus) | done | `claude/assistant-no-subagents` | [#167](https://github.com/MossesX/AmberX-AXF/pull/167) | Merged + deployed Oct 29 02:16 EDT; also fixed Mosses build-mode crash (env scrub flag from #164 removed) | 2026-10-29 |
| Mosses builds in the AI assistant: Edit/Write/Bash in the /axf git checkout + git push / open PR tools (orchestrator `mosses-build-tools`, Refactor, Opus) | done | `claude/mosses-build-tools` | [#164](https://github.com/MossesX/AmberX-AXF/pull/164) | Merged + deployed Oct 29 00:02 EDT (console updated). Mosses: start a fresh chat on the Claude Code provider | 2026-10-29 |
| Basic filter plugin (claude.ai AmberX Framework chat) | done | `claude/basic-filter` | [#155](https://github.com/MossesX/AmberX-AXF/pull/155) merged | Merged Oct 28 13:04, console redeployed. `refactor-all` s27 (basic-filter s7) is already done | 2026-10-28 |
| Plugin theme override + Plugins ladder (claude.ai AmberX Framework chat) | queued (in refactor-all) | `claude/plugin-theme-override` | [#161](https://github.com/MossesX/AmberX-AXF/pull/161) merged | #161 merged Oct 28 ~15:55 (Brett's one exception to the STOP ORDER): Plugins ladder + Disable + submenu flip are on main. Left: refactor-all s68–s70 (Fable), s72–s75 (Opus) | 2026-10-28 |
| **One build: `refactor-all`** (every unfinished Refactor step in one build, matrix `refactor-all`) | done (merged + deployed Oct 29 02:40 EDT) | `claude/refactor-all` | [#166](https://github.com/MossesX/AmberX-AXF/pull/166), [#168](https://github.com/MossesX/AmberX-AXF/pull/168) (voice wake), axHub [#18](https://github.com/MossesX/axHub/pull/18) — all merged | Console, AXHub web, Patches web, the hub and AmberX web all redeployed; `vps.run`/`logs` on the veto policy (Vinnie). AmberX Dockerfile fix e74303f2 (copy emptyState.tsx). Note: /opt/amberx-web pulls from the /opt/axf mirror, not GitHub — a fresh main reaches it only after /opt/axf updates. Left for Brett: install the new AmberX APK (CI artifact app-apks / hub Apps page); first run downloads the Vosk model | 2026-10-29 |
| axHub runs approved calls itself (send once, never wait) | PR open | `claude/hub-runs-approved` (axHub) | [axHub #14](https://github.com/MossesX/axHub/pull/14) | Orchestrator build `hub-runs-approved` (refactor, Opus, 3 steps, ~1.25 h; MossesX/axHub). Do before `veto-window` | 2026-10-28 |
| Run unless blocked: 2-min countdown, then urgent alarm (red banner + loud AmberX ring), 1-min grace, runs; Block anytime | queued (held) | – | – | Orchestrator build `veto-window` (refactor, Opus, 5 steps, ~2.2 h; axHub + AXF + AmberX alert settings) | 2026-10-28 |
| Feature Matrix plugin (skip/keep matrix per build, one dataset grid, hooks in every builds grid, Apply updates every table) | queued (new thread) | – | – | Orchestrator build `feature-matrix` (refactor, 8 steps ~3.8 h: Fable s1–s2 contract + apply engine, Opus s3–s8 plugin). builds-one-page archived (Brett: removed). Start in its own chat with the first message below | 2026-10-28 |
| Windows-style Terminal (Claude Code tabs + connections + profiles) + window snap/resize + settings level toolbar & level editor | review (Opus phase) · waiting on Fable switch | `claude/windows-terminal` | [#158](https://github.com/MossesX/AmberX-AXF/pull/158) | Orchestrator build `windows-terminal` (refactor): **Opus s1–s5 done** (Terminal v0.3.0, report rebuilds/windows-terminal.md); PR open → merge approval once CI passes. Next: **Fable s6–s12** (window edge resize/snap/frameless, levels contract, level toolbar + editor) after Brett approves the switch. Held: `postponed-gestures` (drag from anywhere). Change log chg-20261028-427e401aac | 2026-10-28 |
| Approval history with costs (Console + axHub) | queued (held) | – | – | Orchestrator build `approval-costs` (refactor, Opus, 5 steps, ~2.25 h; AXF + MossesX/axHub). cut to history + costs Oct 28 (wait/resume dropped) | 2026-10-28 |
| axHub GitHub write tools (create/update file, branch, commit; each needs approval) | queued (held) | – | – | Orchestrator build `axhub-github-write` (refactor, Opus, 3 steps, ~1 h; work in MossesX/axHub). From the Oct 28 fix wizard; VPS writes only when needed | 2026-10-28 |
| Share Search: programmable grid toolbar plugin (search/filter bar, 5 buttons, advanced search, attach prompt) | queued (held) | – | – | Orchestrator build `share-search` (refactor, 8 steps, ~3.9 h: Fable s1–s2 contract, Opus s3–s8). Brett: "send to orchestrator and hold off on build" — don't start until he says | 2026-10-28 |
| AmberX: install the AI assistant + agent manager (console plugins, unchanged) | done | `claude/amberx-assistant-agents` | [#156](https://github.com/MossesX/AmberX-AXF/pull/156) | Merged Oct 28; amberx.amberxai.com picks it up on the 5-minute update. Orchestrator build `amberx-assistant-agents` (refactor, Opus). Same chats/agents as the console via AmberX's server; moves to axHub with `axhub-agent-host` | 2026-10-28 |
| AmberX AI connection: fix Save key + several Claude tokens (Test each, primary) | done | `claude/amberx-claude-tokens` | [#157](https://github.com/MossesX/AmberX-AXF/pull/157) | Merged Oct 28; amberx.amberxai.com picks it up on the 5-minute update. Save never reached the server; errors now show next to the button. New Claude plan tokens list: add name + access + optional refresh (saved and tested in one tap), Test / Test all, star = primary. Server `POST /api/ai/profiles`, `POST /api/ai/primary/{id}`; 141 server tests pass. Orchestrator build `amberx-claude-tokens` (refactor, Opus) | 2026-10-28 |
| AmberX voice command center + Molly (288 commands, chains, wizards; Developer via Molly; narrated console walkthroughs) | done | `claude/amberx-voice-center` | [#153](https://github.com/MossesX/AmberX-AXF/pull/153) merged | Merged Oct 28 15:21 UTC. After merge: the 5-minute update redeploys AmberX + the console; the AmberX installer copies the console token so Molly connects | 2026-10-28 |
| AX Notes Fable build (PR #136, `fable/ax-notes`) | done | `fable/ax-notes` | #136 closed | Closed by Brett Oct 28 ("Kill 136 and keep going"); branch kept. The Opus notes build (#144) is what's live | 2026-10-28 |
| Systems check: Fix failed dialog (Claude badge + account, approve Mosses → headless Claude Code; dead connection → error, fix, VPS command, Vinny Auto fix) | merged | `claude/banner-fix-fallback` | #151 | Orchestrator build `banner-fix-fallback` (refactor, Opus, 3 steps; s1+s2 done, s3 CI + merge). Built in the AX Notes claude.ai chat (Brett's pick) | 2026-10-28 |
| Console banner overlap fix: attached widgets snap, never overlap (all web apps) | done | `fix/banner-snap` | [#149](https://github.com/MossesX/AmberX-AXF/pull/149) merged | Merged Oct 28; the 5-minute update redeploys the console | 2026-10-28 |
| Push notifications from the AmberX Android app (replaces AXHub app) | done | `claude/amberx-push` | [#154](https://github.com/MossesX/AmberX-AXF/pull/154) | Orchestrator build `amberx-push` (refactor, Opus): AmberX watches approvals + console alerts, on by default; Patches + AXHub app quiet while AmberX is installed. Merged Oct 28; needs the new AmberX/Patches/AXHub APKs on the phone | 2026-10-28 |
| AmberX voice monitor fix: misses words, swear filter, no live text, constant tone | done | `claude/amberx-voice-fix` | [#147](https://github.com/MossesX/AmberX-AXF/pull/147) merged | Merged Oct 28. Native change: install the new AmberX APK from axHub → Apps. CI's AmberX job now reports its errors to the CI build errors issue | 2026-10-28 |
| Fix merge-pr.sh: `docker exec` without `-i` sent nothing to the console, so approved merges did nothing | done | `claude/fix-merge-pr-stdin` | [#145](https://github.com/MossesX/AmberX-AXF/pull/145) merged | – | 2026-10-28 |
| AmberX voice notes, lists, tasks + AI router (amberx.amberxai.com) | done | `claude/amberx-notes` | [#144](https://github.com/MossesX/AmberX-AXF/pull/144) merged | Live Oct 28 02:34 UTC (FastAPI server answering, wall-signed only). Left for Brett: add an AI provider in Settings → Plugins → AI connection | 2026-10-28 |
| AmberX look fix + Lock the look + Get the look from axHub switches | review | `claude/amberx-appearance-lock` | #126 | Merge after CI; the 5-minute update redeploys amberx.amberxai.com | 2026-10-27 |
| AmberX hands-free listening + ActiveX-style detection overlay (level graph, dB, quick settings) | merged | `claude/amberx-handsfree` | #141 | Orchestrator build `amberx-handsfree` (refactor, Opus): s1–s3 done, CI is the first Java compile; then merge approval | 2026-10-27 |
| Merge approvals: ready PRs go to Brett as an axHub approval; Approve on the first screen of the approval page | merged | `claude/merge-approvals` | #131 | Merge through its own merge approval once CI passes | 2026-10-27 |
| Empty banner strip stays after the last banner item is removed (fix) | review | `fix/banner-strip-collapse` | #133 | Merge after CI; the 5-minute update redeploys the console | 2026-10-27 |
| Build profiles + Build profiles plugin (Main framework, Refactor) | review | `claude/build-profiles` | see GitHub | Merge after CI; then the console shows the profile chip. Refactor is the saved pick; today's refactor/upgrade work imported into it (pending: arch-foundation, enterprise-branding, interface-roller, design-package-fable, apply-all-levels-fable + 5 done; orchestrator: arch-foundation, enterprise-branding, interface-roller, design-package). Main keeps its copies with a note | 2026-10-27 |
| Slim CLAUDE.md: Status moved to `_claude/memory/STATUS.md` (CLAUDE.md 250K → 13K chars) | merged (#125) | `claude/move-status-out-of-claude-md` | #125 | New status lines go in STATUS.md; plugin lifecycle `mentions` include it | 2026-10-27 |
| Build orchestrator plugin + repo build tracker | merged (#122) and live; holds 4 builds, the other open lists not imported yet | 2026-10-27 |
| 10 more design packages (Midnight Pro, Terminal Lime, Ember Studio, Sage Reader, Coral Play, Neon Night, Arctic Calm, Fresh Night, Quiet Focus, Ink Terminal) | merged (#124), live | 2026-10-27 |
| AmberX Design Package + Behaviour theme (replaces Appearance package) | merged in #124 (carries #123), live on console, axHub web, Patches web, AmberX; Fable rebuild parked (`design-package-fable`) | 2026-10-27 |
| Fresh look: new default style theme + `fresh` appearance package | review | `claude/fresh-look` | #119 | Merge after CI, then apply `fresh` on axHub | 2026-10-27 |
| Enterprise design + branding engine (AmberX app + GizmoX console refactor, 700+ brand assets; includes Design Package) | review (tracker only) | `claude/enterprise-branding-3` | #128, #138, #166 merged; tracker PR see GitHub | **All 46 steps done.** s27–s40 were built inside `refactor-all` (its s28–s40, numbering one ahead) and merged in #166 on Oct 29; Oct 30 session found nothing left to build, re-ran the checks on main (all green) and ticked the orchestrator (Refactor + main profiles) + pending item. Merge the tracker PR, then move this row to Done | 2026-10-30 |
| Architecture foundation (attachment: contracts, Pydantic migrator, plugin boundary, lifecycle broker, docs) | queued | – | – | Orchestrator build `arch-foundation`: Fable s1-s7 → Opus s8-s12 | 2026-10-27 |
| Three interfaces in GizmoX tabs + interface roller for every app | in progress | `opus/interface-roller` (stacked on `opus/enterprise-branding`) | [#139](https://github.com/MossesX/AmberX-AXF/pull/139) | Orchestrator build `interface-roller` (15 steps, 10 done): Fable phase 1 merged (#129); **Opus phase 2 done Oct 27** (s6–s10: GizmoX Night + AmberX Signature interfaces, console tabs Main · GizmoX Night · AmberX Signature). Next: phase 3 s11–s14 (roller plugin, lib-interface-roller, install in every web app). See *To carry on* | 2026-10-27 |
| Build orchestrator: Builds grid like Pending builds, step subgrids | PR open | `opus/orchestrator-grid` | – | Grid view = framework DataGrid grouped by category (Build + one-line summary, Status, Next, Steps, Time, Cost, Added; Left hideable); each row expands to a steps subgrid per phase (tick, model chip, group, time, cost, move/remove, approve switch) + the build card actions | 2026-10-27 |
| Pending builds grid view (attachment) | queued | – | – | Orchestrator build `pending-grid-view`: Opus only, 6 steps | 2026-10-27 |
| AmberX Design Package (Fable rebuild of the Opus build) | queued | – | – | Folded into orchestrator build `enterprise-branding` phase 1, group *Design package (Fable rebuild)* (s5r1-s5r6) | 2026-10-27 |
| Connections plugin (every connected app, 7 layouts) | queued | – | – | Asked Oct 26, never started. See *To carry on* | 2026-10-26 |
| Separate Console and Patches asset visibility | on hold (Patches paused Oct 28) | `claude/project-thread-k6ckjv` | #94 | Needs Brett's answer in the thread | 2026-10-25 |
| Fix git merge conflicts | blocked | – | – | Needs Brett's answer in the thread | 2026-10-25 |
| Add icon picker dialog for status plugins | blocked | – | – | Needs Brett's answer in the thread | 2026-10-25 |
| Add Push banner action log | on hold | – | – | Held by Brett | 2026-10-25 |
| Store project rules in repo | queued | – | – | Rules file `_claude/rules/PROJECT-RULES.md` | 2026-10-25 |


## To carry on

### Model upgrades need Brett (`model-upgrade-approval`, Urgent, Opus)
- **Asked (Brett, Nov 3 2026, voice):** a build may switch to a lower model on its own (recorded); switching to a higher model needs Brett's explicit approval (console click or axHub confirm, never veto, never self-approved). Ranking in model-policy (Fable above Opus). Enforce in orchestrator approve/phase logic, console server, launcher/build_start/agent jobs, briefs; axHub approval path; audit; tests; PR.
- **On the branch:** `framework/core/model-policy.mjs` (`switches`, `modelRank`, `switchKind`), `framework/core/model-switch.mjs`, `framework/cli/model-gate.mjs` (launch gate, audit, mark-self), orchestrator core/CLI/server/UI, console MCP tool `orchestrator_upgrade_approve`, `deploy/claude-headless.sh` gate + brief line, swarm planner gate, rules/decisions/README/CLAUDE.md, tests.
- **Left:** PR merge (push banner). axHub side (axHub repo, not this one): make sure the `axf` service's `orchestrator_upgrade_approve` policy is `confirm`, and have axHub forward a signed "approved by Brett" header on held calls so the console can tell an axHub-run call from a direct one with the console token.
- **Checks:** `node apps/console-web/plugins/build-orchestrator/test.mjs` (the repo-store small-steps check fails on store data: agent-cap, help-mode, stack-walkthrough, orch-step-click have steps without estimates; not from this build), `python3 apps/console-web/plugins/build-orchestrator/server/test_upgrade.py`, `node apps/console-web/plugins/agent-swarm/test.mjs`, `node framework/spec/check-model-policy.mjs`, `node framework/cli/model-gate.mjs audit --all`. <!-- axf-plugin:agent-swarm --> <!-- axf-plugin:build-orchestrator -->
### Notes vault (`notes-vault`, Urgent, Opus) — branch `claude/notes-vault`
- Asked: gather Brett's scattered saved notes into one place, a quick notes browser plugin, a Notes section for MD Studio.
- Done: notes moved on the hub (write new, delete old with versions kept), INDEX, orch-live-sync note, `notes-browser` plugin (server on axHub memory-dir semantics, 28-check `test.py`), md-studio s11, report, UI Review shots.
- Left: PR merge (automatic). After merge, other checkouts may hold the moved files in `claude-sync` (deleted on the hub): keep hub.
- Checks: `python3 apps/console-web/plugins/notes-browser/test.py`, `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `help-coverage.mjs --check`. <!-- axf-plugin:notes-browser -->
### Orchestrator live sync (`orch-live-sync`)
Done (PR open). If a later session must carry on: read `_claude/builds/reports/orch-live-sync.md` (Known gaps). Follow-ups worth a build: wire `builds-live.mjs heal` into the push banner's *Pull failed* path; let the GitHub App bypass protection for `_claude/`-only commits if main protection ever tightens; attach the 28 orphan PRs to builds or close them. Checks: `node framework/spec/check-builds-live.mjs`, `node framework/cli/builds-live.mjs status`, `node framework/cli/builds-reconcile.mjs`.

### Fable rebuild: agent swarm (`agent-swarm-fable-rebuild`, Breakroom, Fable) — branch `claude/agent-swarm-fable-rebuild`
- **Asked in full (Brett, Nov 3 2026, voice):** "go on agent-swarm-fable-rebuild, finish the Breakroom profile." Run every step the orchestrator brief lists (7), tick each with `AXF_BUILD_PROFILE=breakroom node apps/console-web/plugins/build-orchestrator/orchestrator.mjs act step agent-swarm-fable-rebuild <sN> done`, commit + push often, open the PR at the end (the push banner merges it), UI Review shots for any visible change. Opus or Fable only, never Sonnet; Fable reviewed first (`_claude/builds/reports/fable-review.md` §6) and this rebuild does only what it flagged (agent-card@1 stays). <!-- axf-plugin:build-orchestrator -->
- **Done so far:** s1 — `framework/core/engines/swarm-rules.mjs` (+ `.d.mts`): registry `SWARM`, normalizers + validators for agent@1, agent-skill@1, swarm-roster@1, swarm-state@1, swarm-job@1, swarm-run@1 (kinds build / job), swarm-report@1, `parseReport`, `budgetTokens`, `jsonSchemas()`; `axf schemas` writes `schemas/swarm.json` + 7 JSON Schemas; fixture `spec/fixtures/swarm.json` + `spec/check-swarm.mts` (110 checks, in `android.yml`); the plugin's `web/swarm-core.mjs` re-exports the framework's contract (own copies removed), `runner.mjs` and `jobs-core.mjs` build runs through `normRun`; PORTING.md deferred-gap line. s2 — planner: `requiredTier` = the step's pin (any spelling, coerced) else `modelForWork` from model-policy@1 (dead Haiku/Sonnet word lists removed); `matchAgent` sends a zero-score step to the most capable agent (largest budget), not the cheapest; `leasesOverlap` catches a folder lease vs a glob rooted inside it; `planJobs` sequences one agent to one job at a time across builds and shapes every job with `normJob`; `fixerJob` on the policy default; 5 new tests (85 total). s3 — packer: `extractSnippet` scores hit lines (one per distinct task word, +1 for a definition line; words on more than a quarter of the file's lines are skipped) and keeps the best within the 120-line cap, printed in file order; `folderIndex` / `indexBlocks` give area jobs an outline of each leased folder (own files + subfolders with counts, 60 lines shared across folders), `swarm.mjs listFolder` walks folders skipping build output; prefix wording allows reading inside leased folders; swarm-roster@1 gained `fallback` (agent for unmatched steps; validated; schema + fixture). Measured: prefix 442 tokens, skills 120–225, the real s3 brief 4321 → 352 prompt tokens. 87 tests. s4 — card layout: `AgentCard.tsx` draws only `cardModel` + `.fx-idcard` tokens (confirmed, no change). Avatar: geometry and paints moved from `cards.tsx` into `core/engines/agent-card-rules.mjs` (`AVATAR_HAIR`, `AVATAR_FACE_SHAPES`, `AVATAR_GEAR_PARTS`, `AVATAR_PAINTS`, `avatarColors`, `avatarModel` → `{ box, face, hair, gear, hue, tokens, parts[] }`, paints are roles or theme tokens, never colours); the React `Avatar` renders the part list; `AGENT_CARD_SAMPLE` gained `avatar` (and its favourite model is Opus, not Sonnet); fixture `agent-card.json` gained `avatar` (sample, junk, every face, every gear, hue bands) and `check-agent-card.mts` replays it + sweeps every face×gear×hair (84 checks). Same pixels as before (same paths, same classes), so no UI Review item. s5 — `core/engines/swarm-chat.mjs` (+ `.d.mts`): `SPEAKERS` / `JOB_KINDS` / `messageErrors` (field-naming), `chatOn` + `post(state, msgs, at, filter)` (switches; the vibe engine is the filter hook), `namer` (roster / map / function), builders `assignLine`, `leaseLines(plan, names, overlap)`, `reportLines`, `mergeLines`, `statusLine`, `payLine` (raise / dock / topup / bonus), `brokeLine`, `disciplineLines` (suspend / suspension-over / back-from-leave / rehire / quit), `hiredLine`, `newCardsLine`, `waitingLine`, `assignJobLine`, `unassignedLine`; banter: `BANTER`, `BANTER_MOMENTS`, `banterLine`, `reactors`, `banterPrompt`, `parseBanter` (caps as constants). The plugin core, `jobs-core.mjs`, `jobs.mjs` and `swarm.mjs` build every line through them (inline Boss strings removed). Fixture `spec/fixtures/swarm-chat.json` replayed in `check-swarm.mts` (messages, every builder, banter, post). PORTING.md line. s6 — `core/engines/swarm-vibe.mjs` (+ `.d.mts`): `VIBE_WORDS` (cuss levels + replacements, sarcasm, drama, slang, identity guard), `VIBE_WEIGHTS`, `VIBE_LEVELS`, `ACRONYMS`, `PREVIEW_LINES`; `settingsFor`, `scoreVibe`, `cleanCussing`, `calmDown`, `vibeFilter`, `reactionsFor`, `banterToday`, `banterAllowed`, `reactCount`, `previewLine`, `vibeShade`; the plugin core re-exports them and feeds `vibeFilter` to the chat engine's `post`. Fixture `spec/fixtures/swarm-vibe.json` (scores, cleaning, calming, every filter rule, reactions, the daily budget, preview, shade) replayed in `check-swarm.mts` (223 checks). PORTING.md line.
- **s7 (Opus-pinned; written by this Fable session on Brett's "do every step"):** report `_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md`, LOG.md entry, `shots.json` kept (the sandbox console shows only "Waiting for axHub" under Playwright, so the captures were discarded; same pixels by construction). `plugin.json` lists `_claude/THREADS.md` as a managed mention so the lifecycle check accepts the path references in this block.
- **Steps left:** none. The PR is open; the push banner merges it when CI is green. If CI is red, fix on this branch (`check-swarm.mts` runs in `android.yml` next to `check-job-type.mts`).
- **Read first:** `framework/core/engines/swarm-rules.mjs`, `framework/spec/check-swarm.mts`, `apps/console-web/plugins/agent-swarm/web/swarm-core.mjs`, `apps/console-web/plugins/agent-swarm/test.mjs`. <!-- axf-plugin:agent-swarm -->
- **Checks:** `npx -y tsx framework/spec/check-swarm.mts` · `node apps/console-web/plugins/agent-swarm/test.mjs` · `node framework/spec/check-model-policy.mjs` · `cd apps/console-web && npm run typecheck`. <!-- axf-plugin:agent-swarm -->
- **Waits on:** nothing. **First message:** "Carry on agent-swarm-fable-rebuild (Breakroom) on Fable from s2: `AXF_BUILD_PROFILE=breakroom node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief agent-swarm-fable-rebuild`." <!-- axf-plugin:build-orchestrator -->

### dock-engine, md-studio, theme-editor (profile Urgent)
- Asked in full: the orchestrator builds' detail (Brett Nov 2 2026 21:30 ET). Order: dock-engine (Fable) first; md-studio after it; theme-editor any time.
- First messages: "Carry on dock-engine (Urgent) from s1 on Fable: `AXF_BUILD_PROFILE=urgent node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief dock-engine`." <!-- axf-plugin:build-orchestrator -->
  theme-editor: done (Nov 3 2026, PR #243, waiting in UI Review). Nothing to carry on unless Brett asks for changes there.
  "Carry on token-control (Urgent) from s1 on Fable: `AXF_BUILD_PROFILE=urgent node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief token-control`." <!-- axf-plugin:build-orchestrator -->
  "Carry on theme-editor (Urgent) from s1 on Opus: `AXF_BUILD_PROFILE=urgent node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief theme-editor`." <!-- axf-plugin:build-orchestrator -->
  token-control: see its own block below (Fable phase done Nov 3 2026).

### Theme veto pass (orchestrator `theme-veto-pass`, profile Urgent) — branch `claude/theme-veto-pass`
- Asked (Brett Nov 3 2026, voice, GO given): a timed override: "allow theme changes for the next 30 minutes" makes token changes run with no veto for that window. Grant approved once (traces to Brett), expiry server-side, deletes never covered, banner chip with live countdown (revoke / extend, warning 2 min before), audit + THREADS line per grant and change, `pass.undo`, read tools annotated read-only + recommended axHub policy, contract with axHub build `axhub-veto-pass`.
- State (Nov 3 2026): **all 7 steps done**, PR open on base `claude/token-control-opus` (merge after #250). Report `_claude/builds/reports/theme-veto-pass.md`. PR [#262](https://github.com/MossesX/AmberX-AXF/pull/262). UI Review item `r-20261103-dbed7dea` (group "theme-veto-pass - Nov 3 10:41 AM") waits for Brett.
- Checks: `node apps/console-web/plugins/token-control/test.mjs`, `python apps/console-web/server/test_mcp_tools.py`, `npx -y tsx framework/spec/check-control.mts`, `node framework/cli/check-theme.mjs`, `node framework/cli/check-controls.mjs`, `node framework/cli/help-coverage.mjs --check`, `cd apps/console-web && npx tsc --noEmit`. <!-- axf-plugin:token-control -->
- **Waits on:** axHub side (`axhub-veto-pass`, axHub repo) to read the signed `GET /api/plugins/token-control/pass` and forward Brett's approval; until then a pass shows and logs but axHub still vetoes. **First message (only if review or CI asks for changes):** "Carry on theme-veto-pass (Urgent) on branch claude/theme-veto-pass: read _claude/builds/reports/theme-veto-pass.md, then fix what the review / CI says." <!-- axf-plugin:token-control -->

### Pass all (orchestrator `pass-all`, profile Urgent) — branch `claude/pass-all` → `claude/theme-veto-pass`
- Asked (Brett Nov 3 2026, voice, correcting theme-veto-pass): "It's not supposed to be 30 minutes for theme changes. It's 30 minutes to do whatever I tell you." control@1 pass scope `all` as the default (any command through API, MCP or CLI on every plugin); narrow scopes stay; ordinary deletes covered, irreversible ones only with `include_irreversible`; grant still needs Brett once; axHub build `axhub-pass-all` matches; chip "Everything: 29:41 left"; undo rolls back what it can and lists the rest; docs/help/CLI/tests; push onto `claude/theme-veto-pass` and note it on PR #262.
- State (Nov 3 2026): **all 5 steps done**, commits fast-forwarded onto `claude/theme-veto-pass` (PR #262 carries them; noted on the PR). Report `_claude/builds/reports/pass-all.md`. UI Review item `r-20261103-7cd5aa8b` (group "pass-all - Nov 3 11:08 AM") waits for Brett.
- Checks: same as theme-veto-pass above (token-control test.mjs 20, check-control 260, test_mcp_tools 138). <!-- axf-plugin:token-control -->
- **Waits on:** axHub `axhub-pass-all` (contract: `framework/spec/CONTROL.md` → Veto passes → Deciding a held call). **First message (only if review or CI asks for changes):** "Carry on pass-all (Urgent) on branch claude/theme-veto-pass: read _claude/builds/reports/pass-all.md, then fix what the review / CI says." <!-- axf-plugin:token-control -->

### Token control (orchestrator `token-control`, profile Urgent) — branch `claude/token-control-opus`
- Asked (Brett Nov 2 2026 21:38 ET, in full in the orchestrator build's detail): a new plugin with a powerful API, MCP and CLI server/client that can change every single token (theme, style, layout; every layout parameter is a token), connected to Claude and axHub; API and MCP control every aspect of AmberX tasks, to-dos and notes and the console planner (Plan Studio + Build orchestrator); extensive interactive documentation; folds in the dead VPS build amberx-full-mcp-api (never relaunch it separately).
- State (Nov 3 2026): **all 14 steps done**. Fable phase s1-s3 on `claude/token-control` (PR #246); Opus phase s4-s14 on `claude/token-control-opus` (PR #250, which merges main and contains #246). UI Review item `r-20261103-f9cd2905` (group "token-control - Nov 3 7:23 AM") waits for Brett; the push banner merges once CI is green and the review is approved.
- What landed: see STATUS.md "Token control plugin" and `apps/console-web/plugins/README.md`. Token sets write `axf.tokens.<set>` overrides into the axHub look (`framework/core/engines/control-tokens.mjs`, applied in `runtime.compileStyles`); AmberX via the notes core (generated `lib/amberx-core.gen.mjs`; rerun `gen-amberx-core.mjs` when `apps/amberx-droid/.../notes/web/core.ts` changes); planner via capabilities `plans@1` / `orchestrator@1`.
- To carry on (only if the review asks for changes or CI fails): branch `claude/token-control-opus`; checks `node apps/console-web/plugins/token-control/test.mjs`, `npx -y tsx framework/spec/check-control.mts`, `node framework/cli/check-theme.mjs`, `node framework/cli/check-controls.mjs`, `node framework/cli/plugin-lifecycle.mjs check token-control`, `cd apps/console-web && npx tsc --noEmit`. Shots: `/tmp/tc-shots/shots.json` pattern with `rebuild-shots.mjs --env AXF_APPEARANCE_HUB=off`. <!-- axf-plugin:token-control -->
- Follow-ups worth a build (not started): axHub `list_services` couldn't be checked from this session (permission), so confirm `control_*` shows through axHub's console service; per-asset overrides (`axf.tokens.<set>.<asset id>`) exist in the engine but no transport writes them yet; Kotlin twin deferred (Android on hold). <!-- axf-plugin:build-orchestrator -->
- **dock-engine is built** (Nov 3 2026, headless Fable run `molly-fable`, branch `claude/molly-fable`): `framework/core/engines/dock.ts` (dock@1: pane tree, drop zones, pane limit, splitters, snapshots), asset type dock-layout@1 (`framework/assets/dock-layout`, ten starters, baked into every app), `framework/react/windows/DockHost.tsx` (DockHost / DockPaneView / DockDropOverlay / Pane layout dialog), `WindowManager` dock methods, actions `windows.redockInto` / `windows.layout`. Checks: `npx -y tsx framework/spec/check-dock.mts`, check-theme, check-controls. UI Review: submitted headlessly (item r-20261103-80e15b02, group "molly-fable - Nov 3 6:46 AM": Libraries → Docked comparisons with two panes + splitter, Pane layout dialog; desktop + phone), waiting for Brett.
- First messages: "Carry on md-studio (Urgent) from s1 on Opus: `AXF_BUILD_PROFILE=urgent node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief md-studio`" (build on DockHost: `DockHost`, `wm.splitGroup`, `wm.dropTab`, `wm.applyPreset`, dialog `dock-layout`). <!-- axf-plugin:build-orchestrator -->

### xLayout (orchestrator `xlayout`, profile Big Dog) — branches `claude/molly-fable` (#245) + `claude/xlayout-opus` (#252)
- Asked (Brett Nov 2 2026 13:46 ET, in full in the orchestrator build's detail): Molly must look like ONE app. Plugin xLayout renders a single banner, application menu, navigation menu and context menu over the whole page, merging AmberX, axHub web and the Dev Console; IDE-style switch (draggable, resizable, dockable panes, pane limit, ~10 preset layouts with preview before apply); plugin toolbars (up to 3, show/hide + default location in the plugin's settings); Toolbar designer dialog (its OWN plugin `toolbar-designer`, reached through a capability service) opened from a settings hook and from right-click on any toolbar, items from every plugin/screen, opening in main area, floating window or (IDE on) a pane. Standalone apps stay exactly as they are. Patches is paused: don't touch it.
- **Fable phase done (Nov 3 2026, headless run `molly-fable`):** s1 `framework/core/engines/xlayout.ts` + asset type xlayout@1 (host-only, `shared: false`; starter `framework/assets/xlayout/molly.json`; validator, schema, `spec/fixtures/xlayout.json`, `spec/check-xlayout.mts`); s2 `framework/core/engines/chrome.ts` (chrome@1: `ChromeBundle`, `parseChromeBundle`, `mergeChrome`, `routePick`, `chromePicks`), embed@1 takes `nav-menu` / `context-menu` / `toolbar` / `widgets` (web + Kotlin registry) and messages `chrome` / `chrome-request`, runtime guest side `rt.shareChrome()` (sends nav / context / toolbar / app menu as data; `runSharedMenuItem` runs picks back), `spec/fixtures/chrome.json`, `spec/check-chrome.mts`; s3 covered by dock-engine (DockHost, dock@1).
- **Opus phase done (Nov 3 2026, branch `claude/xlayout-opus`, PR #252):** Molly plugins `apps/molly/plugins/xlayout` (chrome host `web/host.ts`, IDE workspace + layout picker `web/workspace.tsx`, toolbars `web/toolbars.tsx`, Settings → Plugins → xLayout, capability `axf.xlayout@1`) and `apps/molly/plugins/toolbar-designer` (capability `axf.toolbar-designer@1`); Molly hooks `src/molly/host.ts`; embed@1 `context` message (guest right-click → host menu); re-baked molly, amberx-droid, axhub-web, console-web. All checks green (see PR). UI Review items r-20261103-f6e42c05, r-20261103-0824dcee, r-20261103-11a5597c waiting (group "xlayout - Nov 3 7:28 AM").
- Left: Brett's UI Review verdict; after #245 and #252 merge, redeploy AmberX / axHub web / Console so the live apps send their chrome (older builds keep their own). Gaps: guest banner widgets not drawn by Molly; Android twin of `context` deferred (PORTING).
- Read first: `framework/core/engines/xlayout.ts`, `framework/core/engines/chrome.ts`, `framework/core/engines/dock.ts`, `framework/react/windows/DockHost.tsx`, `framework/core/runtime.ts` (`shareChrome`, `listenToHost`), `apps/molly/src` (App.tsx, molly/FrameDeck.tsx, molly/apps.ts), `framework/spec/PORTING.md` (xLayout row), the Patches rule in `_claude/rules/RULES.md` (Patches only; Molly may merge chrome).
- Checks: `npx -y tsx framework/spec/check-xlayout.mts`, `check-chrome.mts`, `check-dock.mts`, `check-embed.mts`; `node framework/cli/check-theme.mjs`; `check-controls.mjs`; `node framework/cli/plugin-lifecycle.mjs check <folder> --after-uninstall`; `cd apps/molly && npm run build`; `npx -y tsx framework/spec/gen-fixtures.mts` after any engine change.
- Waits on: Brett's UI Review decision on the three items; nothing else.
- First message (only if UI Review asks for changes): "Carry on xlayout (Big Dog) on Opus: apply the UI Review changes on branch `claude/xlayout-opus` (PR #252); `AXF_BUILD_PROFILE=big-dog node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief xlayout`." <!-- axf-plugin:build-orchestrator -->

### Molly (`molly-opus`, Big Dog, Opus) — branch `claude/project-thread-nxdu3m`, PR #230
- Asked: "Can we combine amberx, axhub, and console into 1 interface but still keep separate apps"; "Build new build profile for it called Big Dog"; "Do it in opus, I'll do another one in fable later, call the opus one molly at molly.amberxai.com". Brett said go (Nov 2) and that it can run without his approval.
- Done: profile `big-dog`; app `apps/molly` (manifest, shared assets, nav/app-menu/toolbar assets, kept-alive frames in `src/molly/FrameDeck.tsx`, deep links `#/<app>/<route>`, Dockerfile + nginx, CI build step); axHub web + AmberX `frame-ancestors` allow molly. Steps s1–s8 ticked. <!-- axf-plugin:build-orchestrator -->
- Left: s9 deploy (Coolify app from `apps/molly/Dockerfile`, DNS A record `molly` → VPS, DNS log line, redeploy axHub web + AmberX for the header), s10 UI Review shots.
- Checks: `cd apps/molly && npm run build`; `node framework/cli/shared-assets.mjs check --all`; `node framework/cli/project.mjs validate --all`.
- First message: "Carry on molly-opus (Big Dog) from s9 on branch claude/project-thread-nxdu3m."

### Whole-stack walkthrough plugin (Refactor, Opus) — branch `claude/project-thread-646cjb`
- **Asked (Brett, Nov 1 2026):** "Build a guided browser narrated walkthrough like the one in amberx app but 90 minutes long about the whole framework, console, amberx, axhub, vps, mcp server everything explain how incredibly unique, powerful, and valuable it is use cussing and ri accent street slang thick download as video too." Then: "Wanna be able to edit voice make it a plugin for amberx with downloadable video."
- **State:** built, PR #229; left: merge, record on the VPS, UI check of the live player (`UI_CHECK=1`) → UI Review. Resume: `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next stack-walkthrough`. <!-- axf-plugin:build-orchestrator -->
- **Read first:** `_claude/memory/docs/walkthrough-everything.md` (chapters, steps s1–s12), `apps/amberx-droid/walkthrough/README.md`.
- **First message:** "Run the whole-stack walkthrough plugin build from `_claude/memory/docs/walkthrough-everything.md`, starting at s1."


### One default look + design theme precedence — Fable review (`claude/one-look-default-2`, Fable; relaunch of `one-look-default`)
- **Asked (launcher, Nov 3 2026):** relaunch of the headless build `one-look-default` (brief `/root/axf-builds/one-look-default/.brief.md`: banners didn't compress, new default style + colour theme, default design theme, precedence rule, selection-only Settings) on branch `claude/one-look-default-2`; don't redo what PR #228 (Opus) landed; Fable review of the appearance@1 / precedence contract the Opus build left open.
- **Model:** Fable (headless VPS). One session, no sub-agents.
- **On the branch:** framework `banner/amberx-thin` carries the day/night `theme-switch` (the three per-app overrides deleted, `banner.json` fixture regenerated, shared assets re-baked); runtime: `swap('design-package', id)` loads the package, `restoreDefaultAppearance` ends by applying the manifest's default package in full (`applyDesignPackage(id, { quiet })`), `appliedDesignPackage()` = the `design-package` slot; `APPEARANCE_NEVER` += `appearance-package` (fixture row `retired-slot`); `check-hub-look.mts` runs the three real apps on one in-memory hub (110 checks); spec `APPEARANCE-SOURCE.md` (precedence rules 1–5 + why overrides ride `settings`), `PORTING.md` Kotlin gaps; apps re-baked.
- **Left:** nothing for this session. PR #244 is open (push banner merges it when CI is green); UI Review items in group "One look - Nov 1" wait for Brett. If CI is red: fix on the branch. Open question in the report: a Design theme pick resets plugin look settings (design-package@1 whole-look semantics).
- **Checks:** `npx -y tsx framework/spec/check-hub-look.mts`, `check-design-package.mts`, `check-appearance.mts`, `check-help.mts`, `node framework/cli/shared-assets.mjs check`, `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `npx -y tsx framework/spec/gen-fixtures.mts` (no diff), `npx tsc --noEmit` + `npx vite build` in the three apps.
- **Waits on:** UI Review (group "One look - Nov 1") and CI on #244. The push went through `github-token.mjs credential` (the fallback token); the GitHub App itself isn't set up on this host.
- **First message:** "Carry on thread 'One default look + design theme precedence — Fable review': check CI on PR #244 (claude/one-look-default-2), fix anything red, and read the open question in `_claude/builds/reports/one-look-default.md` → Known gaps."

### One default look + design theme precedence (`claude/one-look-opus`, Opus; merged as PR #228)
- **Asked (Brett, Nov 1 2026):** "How come the refactor didn't compress banners. I need a new default style and color theme that GizmoX, amberx, and axhub all inherit from axhub. Change in one changed all. Then I need the 2 new themes to be combined into a default design theme. When a design theme is loaded the individual style and color themes are not applied. Only when something changes is the design pack overridden with the individual packs. Remove all appearance and theme editing abilities from the settings interface that is read from axHub and changes every apps interface only allow selecting design, style, and color themes." Then "Build it on opus now fable later", "I only wanted it removed from settings for the apps not plugins", "The banner plugins are supposed to store their style and colors on a hub so they render the same everywhere."
- **Model:** Opus in claude.ai (VPS account out of weekly credits until Tue Nov 3). **Fable review: one-look-opus** — review only the list under "For the Fable review" in the report.
- **On the branch:** `hub` style theme, `hub-night` colour theme, `hub-default` design package (default in all three apps); precedence engine + runtime; Settings → Appearance = Design / Style / Colour pickers + Restore; Sliders, per-asset tokens and rolls retired; banners compact by default; specs, tests, fixtures, report.
- **Left:** UI Review screenshots (phone + desktop, group "One look - Nov 1"); Fable review; Kotlin twin when Android resumes.
- **Checks:** `npx -y tsx framework/spec/check-design-package.mts`, `npx -y tsx framework/spec/check-hub-look.mts`, `npx -y tsx framework/spec/check-appearance.mts`, `npx -y tsx framework/spec/check-help.mts`, `node framework/cli/shared-assets.mjs check`, `npx -y tsx apps/amberx-droid/test.mjs`, `npx tsc --noEmit` in the three apps.
- **First message:** "Carry on thread 'One default look + design theme precedence': check PR CI for claude/one-look-opus, fix anything red, take the UI Review shots, then run the Fable review listed in _claude/builds/reports/one-look-opus.md."

### One look from axHub + shared assets (`claude/hub-look-all-assets`)
- **Asked (Brett, Nov 1 2026):** "The apps should only get appearance from axhub period." "If you select design package in one app it changes it for all! Any theme change applies to all." "They all gotta ship all assets that can be shared bruh!" "Scrap patches and demo and walkthrough" (from this build).
- **Model:** built on Opus in claude.ai (Brett picked it; headless Fable was out of weekly credits until Tue Nov 3). Follow-up: Fable review of the contract parts.
- **On the branch:** everything in `_claude/builds/reports/hub-look-all-assets.md`. PR open; auto-merge takes it when CI is green.
- **Left:** if CI is red, fix it on the branch. Then a Fable review (appearance@1 `settings`, `shared` flag). Kotlin twin when Android work resumes.
- **Checks:** `npx -y tsx framework/spec/check-hub-look.mts`, `node framework/cli/shared-assets.mjs check`, `node framework/cli/help-coverage.mjs --check`, `npx -y tsx apps/console-web/scripts/menu-reach.mts`, app tests, `npx tsc --noEmit` in the three apps.
- **First message:** "Carry on thread 'One look from axHub + shared assets': check PR CI for claude/hub-look-all-assets, fix anything red, then run the Fable review of the appearance@1 settings contract."

### Fable review of Opus-built foundation work (`fable-review`, Fable) — branch `claude/fable-review`
- **Asked (Brett, Nov 1 2026):** every headless build since Oct 31 ran on Opus (launcher could not start Fable; fixed, axHub #111). Rule: Opus or Fable only, never Sonnet; Fable for foundation work. Fable REVIEWS the Opus-built foundation work first and only rebuilds what it flags: one builds store, UI Review schema (+ shot-group@1), help@1, job-type@1 + agent cap, session@1, agent swarm data model (fold into the pending `agent-swarm-fable-rebuild`). Small fixes in the branch; rebuilds as orchestrator builds; the model rule into shared RULES.md; report `_claude/builds/reports/fable-review.md`; THREADS + STATUS; merge origin/main, push the branch, never main.
- **Done:** report written with a verdict per item; fixes: `framework/core/model-policy.mjs` (+ `.d.mts`, snapshot `framework/schemas/model-policy.json`, `framework/spec/check-model-policy.mjs` in CI) wired into job-type-rules, the six job-type starters, asset-types.json, the swarm core + roster, `plan.mjs`; `validateStore` in `framework/plan/builds-store-core.mjs` + `builds-store.mjs verify` + `framework/spec/BUILDS.md`; UI Review `REGISTRY.timeZone` with zone-aware `dayKey` / `stamp` / `groupId` in the JS core, `groups-core.mjs` delegating to it, the Python mirror (`schema.py` `local_time`, `screenshots.py` delegating); rebuild notes + s1/s4 on `agent-swarm-fable-rebuild` (Breakroom); shared RULES.md model line (hub conflict resolved, local kept); decisions.md, STATUS.md.
- **Checks:** `node framework/spec/check-model-policy.mjs` (12), `check-builds-store.mjs` (36) + `builds-store.mjs verify`, `check-ui-review.mjs` (64), ui-review `test.mts` (23) + `test.py` (155), `npx -y tsx framework/spec/check-job-type.mts` (95), `agent-swarm/test.mjs` (80), check-help (214), check-agent-card (61), check-session (37), check-agent-slots (56), `axf validate --framework`, check-theme, check-controls, console tsc after a CI-style re-bake.
- **Left:** Brett's session lands the branch (`build_land`). Held hub copies Brett still picks: THREADS.md (hub had one extra row, "Fable launch", now merged here), the builds store + orchestrator exports (repo rev 77 is a superset of hub rev 14), STATUS.md, changes/ entries. Rebuild to run on Fable when Brett says: `AXF_BUILD_PROFILE=breakroom node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief agent-swarm-fable-rebuild`. <!-- axf-plugin:build-orchestrator -->
- **First message to carry on:** "Land claude/fable-review (AmberX-AXF): read _claude/builds/reports/fable-review.md, run the checks it lists, merge origin/main if behind, and land it with build_land. Then resolve the held hub copies with claude-sync resolve."

### GitHub App (`github-app`, Opus) — branch `claude/github-app`, on main
- **Asked:** one GitHub App for the stack (no more dying tokens; repo creation), one-click setup, broker, every caller on it, health + banner, then finish the axp-backup push.
- **Done:** broker + plugin + helpers + checks; VPS helpers installed (`/usr/local/bin/axf-git-cred`, `/usr/local/bin/gh`); `/root/axp-backup/bin/finish.sh` creates the 3 private repos with the app's user token on its next 15-min run after Brett authorizes, then pushes (secret scan in backup.sh unchanged).
- **Waits on Brett:** console → Settings → Plugins → GitHub: Create GitHub App → Install (All repositories) → Authorize as Brett.
- **Left (follow-up thread):** axHub's github connector still uses its own token (MossesX/axHub: add app auth via the same JWT exchange, test with pnpm test on node:22, redeploy via Coolify). The axp-backup branch's repo copy of finish.sh (`deploy/axp-backup/`) doesn't have the repo-create step; the live copy does.
- **Checks:** `node framework/spec/check-github-app.mjs`, `python3 apps/console-web/plugins/github-app/test.py`, `node framework/cli/github-token.mjs status --live`. <!-- axf-plugin:github-app -->
### AmberX walkthrough video (`amberx-walkthrough`, Refactor, Opus) — branch `claude/amberx-walkthrough`
- **Asked (Brett, Nov 1 ~3 AM):** a walkthrough video of the AmberX app just like demo.amberxai.com's, made with the same tooling; chapters (home/approvals, command center, dictate + voice notes, ask my notes, terminal, settings, audio out + session recording, Molly, overlay, hub links), Amber narration, highlights, demo data only, phone layout; Walkthrough entry on Home, app menu, Help; media on the server behind auth; one command + console button to re-record.
- **Built:** `apps/amberx-droid/walkthrough/` (script.mjs chapters, seed.mts demo data, demo-hub.mjs request layer, record.mjs, tts.mjs, assemble.mjs, check.mjs, ui-check.mjs, run.sh, rebuild.sh); AmberX plugin `src/plugins/walkthrough` (player) + Home card; server `GET /api/walkthrough/{file}`; console Molly guide → "Re-record the AmberX walkthrough" (veto vps.run through Vinny).
- **Done (Nov 1):** 9:12 video published; to change it: `bash apps/amberx-droid/walkthrough/rebuild.sh` on the VPS (work dir /opt/amberx-walkthrough-rec, publishes to /opt/amberx-web/.app/data/walkthrough); tests `npx -y tsx apps/amberx-droid/test.mjs`, `python3 apps/amberx-droid/server/test_server.py`, the Molly guide plugin's test.py. Report `_claude/builds/reports/amberx-walkthrough.md`.

### Who asked, on every approval (axHub decision 109) — branch `claude/approval-source` (AXF + axHub)

- **Asked (Brett, Nov 1 2026, headless brief):** every approval just says "vps.run"; show WHO asked and WHAT it is. (1) axHub records the caller on every held/confirm request: source = claude.ai / Claude Code / headless / console / agent / system, from the OAuth client or token, the MCP initialize clientInfo and an optional `X-Axhub-Session` header (strict pattern, ≤ 60); stored with the approval, in the approvals API; tests. (2) AXF: console token callers send `console`, headless builds their `--name` (`AXF_SESSION`, deploy/claude-headless.sh), agents their name. (3) UI: axhub-web list, the Waiting for approvals dropdown, the request page, AmberX's hub view: Source badge, Who, reason title first, tool chip, Requested, countdown; columns sortable/filterable via the framework grid; framework controls + tokens; update in place. (4) Tests green, merge origin/main, push to main in both; report `_claude/builds/reports/approval-source.md`.
- **Model:** Opus. **Worktrees:** `/root/axf-builds/approval-source/{hub,axf}`, branch `claude/approval-source` in both.
- **Done:** all of (1)–(3) committed locally; axHub 487/487 tests (Node 22), AXF checks in the report.
- **Left:** push. This VPS has no working GitHub credential (the console's GITHUB_TOKEN and the gh token answer 401; the headless launcher never passed `GIT_CONFIG_*` into tmux, fixed on this branch). From a machine with access: in each worktree `git fetch origin && git merge origin/main`, rerun the tests, `git push origin HEAD:main`. If menu-approve landed first, expect a conflict in `framework/libs/approvals/react.tsx` (`Row`): keep both (its buttons + this build's meta line), then re-bake (`node framework/cli/rebake.mjs apply apps/<app>` for console-web, axhub-web, amberx-droid, walkthrough-studio).
- **Read first:** axHub `docs/veto.md` §5 "Who asked", `packages/server/src/call-source.ts`; AXF `framework/libs/hub/source.ts`, `apps/axhub-web/src/views/Approvals.tsx`, `_claude/builds/reports/approval-source.md`.
- **First message to carry on:** "Push the approval-source build (AXF + axHub, branch claude/approval-source in /root/axf-builds/approval-source): merge origin/main, rerun tests, push to main; read _claude/THREADS.md → To carry on."

### Watch live (`watch-live`, Refactor, Opus) — branch `claude/watch-live`
- **Asked:** Watch live = hot render. Link on each approval row (expanded details) and each running build in the Build manager / orchestrator; pops up (floating window desktop, full-screen sheet phone) the exact screen the session changes, changed element scrolled to + outlined, hot-rendering as files change; every web app, every hot-swappable asset (no reload), Android screens via the web port with a next-APK note. Greyed "No live preview" otherwise.
- **On the branch:** everything built and tested (`framework/spec/WATCH-LIVE.md`, report `_claude/builds/reports/watch-live.md`).
- **Left (pushed to main Nov 1 01:4x UTC):** once `approval-expand` is on main: put `<WatchLiveFor text={…}/>` into the new expanded approval row details (approvals-banner), retest (`check-watch-live.mts`, `test_previews.py`, console tsc + build, theme/controls/lifecycle), `git push origin HEAD:main`.
- **First message:** "Carry on Watch live from _claude/THREADS.md: merge origin/main into claude/watch-live, add the link to the approval rows' expanded details, retest, push."
### Every change through a PR (push banner 0.5.0)

- **Asked (Oct 30 2026, Brett, voice):** "I want everything to need a PR and to pull against main before it's merged." Push banner 0.5.0: autoPr (a PR for every branch ahead of main, setting on), merge-branch refused (Open PR instead), auto-merge oldest first, pull main into a PR behind it and merge only when 0 behind + CI green on the new pinned head, one merge per round, conflicting pulls → Pull failed; branch protection on main where the token may (systems check item with Auto fix otherwise, never loosened).
- **Done:** branch `claude/pr-only-merge` (on `claude/veto-everywhere`): `apps/console-web/plugins/push-banner/` server + web + test.py (132 checks), `systems-check/server/derive.py` reads `axf.syscheck.items@1:<name>` items, `boilerplate-shots.yml` pushes to `bot/boilerplate-shots` instead of main, shared rule "Automatic merge" widened, plugins README. Checks: test.py, console tsc, check-theme, check-controls, plugin-lifecycle check push-banner pass; systems-check test.py fails at "bad proposals rejected" on the base commit too (not this build). <!-- axf-plugin:push-banner -->
- **Left:** CI on the PR → auto-merge (after #176). After deploy: watch the systems check for "Branch protection" rows (AmberX-AXF is private: protection may need GitHub Pro or a token with Administration write).
- **First message to carry on:** "Check the push banner 0.5.0 PR (branch claude/pr-only-merge): CI state, fix any failure, report."
### Plan Studio (`plan-studio`, Angel, Opus)

**Asked (Brett, Oct 30 2026, voice):** a planning studio to store and view every plan, entered by hand with all the info,
categorized; every plugin and app listed with its features checked off as have or planned (full brief: the orchestrator
build `plan-studio` in the Angel profile and `_claude/memory/docs/plan-studio/README.md`). + plain-English AI (14:20) +
AmberX voice planning (14:22).
**Branch `claude/plans`:** all 12 steps built and committed (plugin `apps/console-web/plugins/plan-studio`, seeds, tests, <!-- axf-plugin:plan-studio -->
docs, screenshots, shared rule "put it in a plan for later"). The build sandbox had no GitHub credentials, so the push
was sent as one veto call (vps.run: `git push` from `/root/axf-builds/claude-plans`, `gh pr create`, `gh pr close 159`).
**Left:** (1) if the veto call failed or was denied: from the VPS shell, `cd /root/axf-builds/claude-plans && git push -u
origin claude/plans`, open the PR (title "Plan Studio: every plan in one place + Catalog + plain-English AI + AmberX
voice planning"), close draft PR #159 with the comment "Moved to Plan Studio as the parked plan Docs Studio" (keep the
branch). (2) CI green → merge approval (shared rule). (3) After merge: submit the screenshots to UI Review; `claude-sync
sync` (shared RULES.md changed). (4) The console seeds the three plans into the hub's `_data/plan-studio/` on install
(amberx-selling-it.json is already there).
**Checks:** `python3 apps/console-web/plugins/plan-studio/test.py`, console `npx tsc --noEmit && npx vite build`, <!-- axf-plugin:plan-studio -->
`npx -y tsx apps/amberx-droid/test.mjs`, `node framework/cli/check-theme.mjs`, `check-controls.mjs`,
`check-plugin-pages.mjs`, `plugin-lifecycle.mjs check plan-studio`, `npx -y tsx apps/console-web/scripts/menu-reach.mts`.
**First message:** `Carry on Plan Studio (Angel, orchestrator plan-studio) in AmberX-AXF on branch claude/plans: read
THREADS.md "Plan Studio", push if not pushed, open the PR, close #159 as moved, then merge approval once CI passes.`
### Build Breaker plugin

- **Asked (Oct 29 2026):** a console plugin "Build Breaker" listing every ask Brett made across the whole project in plain English: page head with totals (asks, built, pending, planned, removed, waiting, time, $ by model); toolbar with search, status (multi) / model / date filters, sort, group-by, expand / collapse all, tabs All · Apps · Plugins · Timeline; an Apps container (a collapsible grid per app) and a Plugins container (a grid per plugin); one-line rows (title, date, time with ≈ when approximate, status badge with icon, time · cost · model badge) that open to the description, his own words, sources, branch / PR links and the Feature matrix; app menu Builds ▸ Build Breaker (Feature matrix already there); a permanent Build item on every context menu with every build page. Model Opus.
- **Done:** branch `claude/build-breaker` — the plugin folder (manifest, lifecycle scripts, server `GET asks`, CLI `asks.mjs`, web page, `test.mjs`), seed `data/asks.jsonl` (390 asks), README line. Checks: tsc, check-controls, check-theme, check-plugin-pages, plugins.mjs --check (main profile), lifecycle check, self-test.
- **Left:** CI on the PR, then Brett merges. Later sessions record new asks with the plugin's `asks.mjs add --title … --app …` and change status with `set-status <id> <status>`, then commit `data/asks.jsonl`.
- **First message to carry on:** "Check the Build Breaker PR (branch claude/build-breaker): CI state, fix any failure, report."

### Plugin theme override + Plugins ladder — in refactor-all (was stopped by the Oct 28 STOP ORDER, since removed)

- **Asked (Brett, Oct 28 2026):** a theme override for every plugin's UI over the axHub theme (Appearance tab container with every layout, colour, style and animation token; several editing views; switch from right-click, toolbar, app menu) + application menu **Plugins ▸ All plugins ▸ <plugin> ▸ Interface · Settings · Documentation · About · Disable**. Cards: profile Refactor; every plugin UI; a setting picks the Disable look (check mark or plain toggle); submenus flip left only when there's no room.
- **Done (not merged):** s7 Plugins ladder + s8 Disable item / info dialog / framework `MenuSub` flip — branch `claude/plugin-theme-override` (WIP commit c9613386), PR #161 retitled WIP, CI green on c10129f2. Self-test `plugins-menu/test.mts` 43.
- **Left:** (#161 merged Oct 28, s71 done) Fable s1–s3 (refactor-all s68–s70: plugin-theme@1 contract, scoped engine + fixture, React layer), Opus s4–s6, s9 (refactor-all s72–s75). Matrix `refactor-all` items `plugin-theme-override:*` (keep).
- **Clash to settle in refactor-all:** held build `share-search` (grid-attach@1, toolbar + filter dialog on grids) overlaps the merged Basic filter plugin + lib-datagrid datasets (`framework/libs/datagrid/datasets.ts`); build on datasets.ts rather than a second registry.
- **Orchestrator build `plugin-theme-override`** only ever existed on the branch; on main its steps live in `refactor-all`.

### Refactor: everything left, one build (`refactor-all`)
- **Oct 29 2026 01:13 EDT (Brett): AmberX voice tone.** "AmberX voice control constantly triggers tone but ActiveX doesn't" → hybrid: silent Vosk wake listener while idle, Google recognizer for one utterance after the trigger, tones muted, trigger-phrase settings like ActiveX. Steps s87–s89 built by an Opus sub-agent on `refactor-all/amberx-voice-wake`; PR open (see GitHub), CI compiles the Java first; merge approval once green; then a new AmberX APK on the phone (first run downloads the ~40 MB Vosk model). Doc `_claude/memory/docs/amberx-voice-wake.md`.
- **Run log (Oct 28 2026 21:27 EDT →, claude.ai session_01XfLJCQwCCLDvSmBFSsLFsi, Brett: "Run refactor all with sub agents" / "Build refactor all according to matrix" / "Start with terminal with sub agents and deploy it"):** matrix applied — kept: windows-terminal s17–s23, handsfree s26, enterprise-branding s28–s40, plugin-theme-override s72–s75, assistant-approvals s77–s80, veto-approvals s81–s86 (added 21:35); everything else `skip`. All switches approved by Brett up front. One sub-agent per group in its own worktree (Fable agents on Fable steps, Opus on Opus), merged into `claude/refactor-all`. **Done:** Terminal group → PR #165 (supersedes #158; report `_claude/memory/docs/rebuilds/windows-terminal-fable.md`); veto approvals → axHub PR #18 (`claude/veto-approvals`, on top of #14) + AXF side (`framework/libs/hub/veto.ts`, AmberX approvals plugin + Terminal view, banner, AXHub web); plugin theme override (`framework/libs/plugintheme`, doc `_claude/memory/docs/plugin-theme-override.md`); assistant approvals (`framework/libs/approvals`, doc `_claude/memory/docs/assistant-approvals.md`). **Done 23:30 EDT:** enterprise-branding s28–s40 merged too; PR #166 open for the whole branch. **If #166 needs work:** merge `refactor-all/branding` into `claude/refactor-all` (expect conflicts in AmberX plugins ai/approvals/monitor, console settings, approvals-banner, STATUS.md — keep both), `rebake.mjs apply --force` for every app but Patches, run the checks (check-theme, check-controls, check-windows, check-settings-ui, check-plugintheme, check-approvals, check-feature-matrix, console typecheck+build, amberx test.mjs), tick s28–s40, open the PR for `claude/refactor-all` → main, send the merge approval; then axHub #18 merge approval, hub redeploy, `axhub services veto vps run 180 30` + `logs`. Live hub note: AmberX has no push transport yet; the phone polls the approvals feed every 10 s while something is held.
- **Added Oct 28 2026 19:19 EDT (Brett, claude.ai): approvals in the assistant title bar.** "Make approvals pop up in the assistants title bar click to approve" — one mechanism for the Dev Console assistant and the AmberX app assistant (both powered by axHub). Steps s76–s80 (Fable s76 approval-badge@1 contract; Opus s77 shared lib `framework/libs/approvals`, s78 console assistant title bar, s79 AmberX assistant title bar + push opens it, s80 checks/shots/PR); matrix items `assistant-approvals:s1–s5` (keep). Reuse the approvals-banner feed; title-bar widgets snap, never overlap.
- **Asked (Brett, Oct 28 2026 15:26 EDT):** "Stop everything from every session right now except the documentation. Put everything left to build into 1 single build in a new session. Send the build to orchestrator and create the matrix then end all other sessions."
- **Build:** orchestrator `refactor-all` (Refactor profile), 67 steps. Fable phase s1–s30 (arch-foundation contracts, trim, style-package Fable rebuild, look@1 review, window engine + settings levels, feature-matrix contract), then one switch to Opus (open PRs #141/#155 finished first, then enterprise-branding refactor, interface roller, arch-foundation docs, trim UI, Tools plugin without Patches, pending grid view, feature-matrix plugin). Everything UI is held to `framework/spec/DESIGN-LANGUAGE.md`.
- **Matrix page:** https://claude.ai/artifact/GJ4gkXZUkjZVXkdKDT1zGS (db doc `matrix/refactor-all`; read it before each step).
- **Scope = matrix `refactor-all`** in `_claude/builds/profiles/refactor/matrices.json` (draft feature-matrix@0; 90 items; skipped by default: share-search, approval-costs, veto-window, axhub-github-write, postponed-gestures, Tools' Patches tab, look-levels s3 folded into windows-terminal). Skipped items aren't built unless Brett ticks them.
- **Branches to carry on from:** enterprise-branding `opus/enterprise-branding` (PR #128, #129 stacked), windows-terminal `claude/windows-terminal` #158, basic-filter #155, amberx-handsfree #141; new work on `claude/refactor-all`. · feature-matrix `fable/feature-matrix` (Fable s1–s2 = refactor-all s24–s25 done there, not merged; cherry-pick/merge before s62)
- **First message (Fable session):** `Start orchestrator build refactor-all (refactor) in AmberX-AXF: Fable phase. Read the brief with AXF_BUILD_PROFILE=refactor node orchestrator.mjs brief refactor-all, and the matrix refactor-all.` <!-- axf-plugin:build-orchestrator -->


Paste the *First message* into a new chat on any account (claude.ai/code on MossesX/AmberX-AXF, or Claude Code on the
VPS). The session reads the rules and this file first, as usual.

### AmberX voice command center + Molly
- **Asked (Brett, Oct 28 2026, 09:53):** a whole lot of voice commands for notes and the todo manager, in categories browsed in a tab group dialog; each tab has a trigger so the app knows if it's a note or task command; sortable, filterable, searchable grids in a scrolling pane; rows expand to details, per-command settings, a record button (two recordings that must match, or pick a predefined phrase); chains and wizards to control the app fully by voice; inner tabs Commands / Chains & wizards; a voice wizard that asks questions when recording or editing a chain; a Developer tab of console chains/commands; an AI snippets tab; when the AI is off or not connected, a page saying why with fixes (enable in settings, setup/configure wizard). The app uses a new axHub agent like Mosses and Vinny: **Molly** (root VPS through approvals, builds/edits in any container, knows the codebase, answers app questions, narrated console walkthroughs in a floating window with next/previous).
- **Decided (cards):** refactor profile; built here, one agent; in AmberX; PR #136 closed.
- **Built (branch `claude/amberx-voice-center`):** `apps/amberx-droid/src/plugins/commands/` (voice-command@1 core, 288 commands: notes 94, tasks 87, developer 67, AI snippets 40; ops on the notes store; runner with cancel/back/repeat/skip; voice chain wizard; command center page + dialog); AI plugin: "Use the AI in this app" switch, `prompt()` and `molly()`; voice: `registerVoiceRouter` + `askAloud`; server: `/api/ai/prompt`, `/api/ai/molly`, `/api/ai/molly/status`; deploy copies the console token. Console: agent-manager add-on `molly` (auto-installed like Vinny, dangerous tools allowed), new plugin `molly-guide` (walkthrough@1: `/ask`, `/walkthroughs`, floating narrated window, Help → Ask Molly).
- **To carry on:** PR #153 is open; wait for CI, send the merge approval (merge-pr.sh), check amberx.amberxai.com → Command center and the console Help → Ask Molly after the 5-minute update. Tests: `npx -y tsx apps/amberx-droid/test.mjs`, `python3 apps/amberx-droid/server/test_server.py`, the Agent manager and Molly guide self-tests (CI runs every plugin's test.py / test.mts). First message: "Carry on thread `amberx-voice-center` from THREADS.md".

### AmberX voice notes, lists, tasks + AI router
- **Asked (Brett, Oct 27 2026, 20:26, with an attachment):** a voice-controlled notes app in AmberX (amberx.amberxai.com): notes in lists with categories and sub-lists for software development; each plugin gets its own list under Plugins when it loads; take, sort, transcribe, organize, rename notes and move them between lists; task manager + todo list; AI for real-time parsing of voice into notes, summaries and storing them in the right place, with a steady connection to Claude (subscription or API, with a switch) and any mainstream LLM; an integrated web component; a section to configure voice commands with predefined commands from the codebase; tabs/containers for the different parts.
- **Decided (cards):** AI runs on AmberX's own server behind the axHub wall (keys server-side, framework assistant_host providers); notes shared on axHub with the console Voice notes + Voice Vault (`voice-notes/` read-only, AmberX writes `amberx-notes/`); start phase A now, sub-agents allowed.
- **Plan:** orchestrator build `amberx-notes` (also pending `amberx-notes`), 15 Opus steps. Core `apps/amberx-droid/src/plugins/notes/web/core.ts` + `store.ts`, AI client contract `src/plugins/ai/web/client.ts`. Plugins: notes, tasks, dictation, voice (extended), ai (+ `apps/amberx-droid/server/`), web.
- **Done:** s1-s14 on `claude/amberx-notes`, PR #144 (test.mjs 459, server 110). Design-language §12 pass on the new pages (Brett's card: console Voice notes plugin stays with the refactor phase).
- **Left (s15):** merge #144 once CI is green; deploy: `sudo bash /opt/amberx-web/apps/amberx-droid/deploy/install.sh` via axHub `vps.run` (approval); then add an AI provider in Settings → Plugins → AI connection; check the pages on the phone.
- **First message:** "Carry on orchestrator build `amberx-notes` on branch `claude/amberx-notes` (`orchestrator.mjs brief amberx-notes`); merge any `claude/amberx-notes-*` branches first." <!-- axf-plugin:build-orchestrator -->
### Build profiles + plugin
- Asked (Brett, Oct 27 2026): "Create multiple build profiles and a console plugin to select and save one. Each build profile holds plans, build queue, pending builds, tracking, and all work stuff. Name current one main framework and then start new one called refactor."
- Model Opus. Branch `claude/build-profiles`, all 4 orchestrator steps done (orchestrator build `build-profiles`, pending `build-profiles`).
- Left: CI green → merge → console redeploys itself. Checks: `python3 apps/console-web/server/test_build_profiles.py`, `node framework/cli/profiles.mjs`.
- First message: "Carry on thread Build profiles: check PR for branch claude/build-profiles, merge when CI is green, then confirm the console shows the profile chip."

### Build orchestrator (how every build below is carried on)
- Tracker: `_claude/builds/orchestrator.json` (orchestrator@1; how-to `_claude/builds/README.md`). `node orchestrator.mjs next` says what to do; `brief <id>` gives the current phase only. At a Fable ↔ Opus switch, stop and ask Brett (card), then `act approve <id> <phase>`. <!-- axf-plugin:build-orchestrator -->
- **First message (any build):** "Run `orchestrator.mjs next` and continue that build from `_claude/builds/orchestrator.json` on the model its next phase names." <!-- axf-plugin:build-orchestrator -->

### Three interfaces + interface roller
- **Asked (Brett, Oct 27 2026 13:10):** "Create 3 completely different looks, feels, behavior. Existing look now in a tab holding main window and 2 more tabs with entirely worked out GUIs that are essentially different apps as far as look is concerned. Make plugin for this app and every app to roll a new interface that rebuilds every single thing about user interface, menus, context menus, logos, etc."
- **Decided (cards):** the tabs go in the GizmoX console; runs after enterprise-branding phase 1, in the same Fable session.
- **Plan:** orchestrator build `interface-roller` (category Design & branding; also pending `interface-roller`). Branch `fable/interface-roller` (stacked on `fable/enterprise-branding`).
- **Done (Fable, Oct 27 2026, PR #129):** s1 interface@1 (`core/engines/interface.ts`, type `interface`, starters fresh + amber), s2 scoped runtime (`rt.scoped`, `scopeSheet`), s3 `<InterfaceScope>` + scope-stamped dialogs / context menus / toasts / windows, s4–s5 roller engine (`core/engines/roller.ts`, brand generators in `core/engines/brandgen.mjs`). Checks: check-interface 56, check-roller 137, interface-scope-check 7.
- **Left (Opus s6–s15):** two more complete interfaces as assets, the GizmoX main-window tab group (`<InterfaceScope>` per tab), the roller plugin (seed, locks, preview, save as interface, apply), `lib-interface-roller` for every app, ship (shots, report, CLAUDE.md).
- **Done (Opus, Oct 27 2026, branch `opus/interface-roller`, stacked on #138 — Brett's card):** s6–s9 interfaces `gizmox-night` (design `gizmox-console`, brand `gizmox-brand-006`, style package `gizmo-console`, developer toolbar + nav rail shown, compact) and `amberx-signature` (design `amberx-signature-day` on new layout `signature-dock`, brand `amberx-brand-014`, style package `amber-signature`, roomy); s10 console tabs `apps/console-web/src/interfaceTabs.tsx` (tab row in `app.frame.head`, each tab under `<InterfaceScope>`, settings `console.interfaceTab` / `console.interfaceTabs`), checked on home, settings, plan, assets, right-click menu and a dialog at 1280 and 412 px. Fixes on the way: stable scoped state snapshot (React #185), scopes re-declare text colour/font, `resolveInterface` expands style packages, watermark behind content. Tool `framework/cli/app-assets.mjs` (take assets + dependencies into an app).
- **Left (Opus s11–s14):** roller plugin (roll, locks, preview tab, undo, save as interface, apply, export/import), `lib-interface-roller` harvest + install in AmberX, axHub web, Patches web, Walkthrough Studio; ship (s15).
- **Read first:** `framework/core/engines/interface.ts`, `roller.ts`, `framework/react/components/InterfaceScope.tsx`, `apps/console-web/src/interfaceTabs.tsx`, `_claude/builds/orchestrator.json`.
- **Approved (Oct 27 2026, card):** the Fable → Opus switch (phase 2); #128 and #129 merged to main.
- **First message (Opus):** "Run `orchestrator.mjs brief interface-roller` and continue phase 3 on Opus from branch `opus/interface-roller` (after #138 and its PR merge, from main)." <!-- axf-plugin:build-orchestrator -->

### Architecture foundation
- **Asked (Brett, Oct 27 2026, attachment):** the 5 deliverables (TS contracts for layout tree / theme / plugin manifest; Pydantic v2 models + before-validator migrator + ingestion namespacing; React error boundary + pub/sub lifecycle broker; project spec; developer docs: new plugin, harvesting, live sync). Built on the existing asset@1 / plugin@1 / appearance@1 contracts; CLAUDE.md stays the project spec (no second .claude.md). Steps: orchestrator build `arch-foundation` (also pending `arch-foundation`).
- **First message:** "Continue orchestrator build `arch-foundation` (`orchestrator.mjs brief arch-foundation`). Run on Fable." <!-- axf-plugin:build-orchestrator -->

### Share Search (grid toolbar plugin)
- **Asked (Brett, Oct 28 2026, claude.ai):** plugin with a toolbar of programmable actions for filtering, sorting and searching grids, named **Share Search**. Full ask is in orchestrator build `share-search` (detail): settings in Settings → Plugins → Share Search with a tab per attachment; launch prompt to attach when unattached (every grid listed in a grid with expanding rows, multi-attach, each with its own settings/look/actions); search bar = Search or Filter (switch), live per keystroke; Appearance collapsible with Inherit-from-shell switch above (collapsed by default; off → every style token like the main app); 5 view/action buttons + Advanced search & filter dialog; right-click toolbar → settings dialog; install on the Console unattached to test the prompt.
- **State:** held — Brett said "send to orchestrator and hold off on build". Nothing built.
- **Waits on:** Brett saying go. Phase 1 (s1–s2, grid-attach@1 contract + schema) is Fable; s3–s8 Opus (one model switch). Build after or with `pending-grid-view` / orchestrator-grid (same lib-datagrid).
- **First message:** "Start orchestrator build `share-search` (`AXF_BUILD_PROFILE=refactor orchestrator.mjs brief share-search`). Run on Fable for phase 1." <!-- axf-plugin:build-orchestrator -->

### Pending builds grid view
- **Asked (Brett, Oct 27 2026, attachment):** grid next to Reload in Pending builds: 1-line summary, date added, total time estimate, cost estimate, sortable columns; rows expand to today's card; toolbar archive / delete / hide / unhide (greyed when none selected) / open in (tooltip dialog: Build manager, Build queue, Plan); select hook: hover tooltip "activate multi select with double click", double-click flashes the top item's hover style 3 times, tooltip "select items", then single clicks select more. Steps: orchestrator build `pending-grid-view` (Opus only).
- **First message:** "Continue orchestrator build `pending-grid-view` (`orchestrator.mjs brief pending-grid-view`). Run on Opus." <!-- axf-plugin:build-orchestrator -->

### Enterprise design + branding engine
- **Asked (Brett, Oct 27 2026, orchestrator chat):** "Only refactor Amberx, the app at amberx.amberxai.com. Refactor console and the active plugins switched on only plus all the banner plugins. Make the framework and app really really nice professional enterprise level quality … must not look amateur. Needs ten light 10 dark themes 10 layout themes 10 style themes, 10 context menu assets, 25 dynamically driven toolbar assets with documentation, 25 style package assets, 25 amberx design packages. 25 navigation menus and behavior. Pepper the app, windows, dialogs, banners, toolbars, and containers with logos, animated logos, icons from a branding package which is new asset type that contains an extendable and scalable template of UI assets for full rebranding of the entire package. Create 250 logos, 250 animated logos, 100 icon packs which are a new asset type, create console plugin to browse them. All to be generated for the AmberX Framework. GizmoX development console. Make custom branded banners, toolbars, windows, containers, tab groups, dialogs, floating windows, etc. Create an entirely hot swappable branding package and branding engine."
- **Plan:** orchestrator build `enterprise-branding` (40 steps; also pending `enterprise-branding`). Includes the Design Package build (archived in the orchestrator). Branch `fable/enterprise-branding`. Web only; Android twins deferred.
- **Decided (cards, Oct 27 2026):** the Dev Console is renamed **GizmoX** in everything visible (banner, title, menus) through its branding package, with code ids and URLs unchanged; logos and animated logos are made for both **AmberX Framework** and **GizmoX**; plugins in scope (Brett, 13:05) = only the plugins currently installed and switched on in Plugin switches, plus every banner plugin (s1 reads that list live through axHub).
- **Done (Fable, Oct 27 2026, PR #128):** s1 `framework/spec/DESIGN-LANGUAGE.md` (+ live plugin scope §13: all 32 plugins), s5r1–s5r6 design-package Fable pass (window placement rules, busy cursor + confirm-delete on buttons), s6–s9 brand types `logo-mark` / `animated-logo` / `icon-pack` / `branding` + `core/engines/brand.ts` + starters, s10–s11 React layer (banner, toolbar, tab group, windows, dialogs, containers, Icon), s12 generators (`framework/cli/brand-gen.mjs` over `core/engines/brandgen.mjs`) + `check-design-language.mts`. Checks: check-brand 88, check-design-language 183, check-design-package 575.
- **Left (Opus s13–s40):** the asset library (10 light + 10 dark colour themes, 10 layouts, 10 style themes, 10 context menus, 25 toolbars with docs, 25 style packages, 14 more design packages, 25 nav menus; 250 logos, 250 animated logos, 100 icon packs through the generators), Brand library plugin, Settings picker polish, GizmoX console + AmberX app refactor (branding packages applied, every in-scope plugin held to the design language), re-bakes, shots, differences report.
- **Done (Opus, Oct 27 2026, branch `opus/enterprise-branding`):** s13–s26 through `framework/cli/asset-library.mjs` (seeded, `--check` in CI): 20 colour themes, 10 layouts, 10 style themes, 10 context menus, 25 toolbars (+ live provider groups `groups[].provider`, pressed toggles `items[].checked`, `framework/spec/TOOLBARS.md`), **style-package@1** (new type, Brett's card: one pick swaps button/container/slider/dialog/popup/tab-group/gauge/meter; action `style.package:<id|next|prev|random>`; 25 packages + 150 control assets; Fable rebuild = orchestrator build `style-package-fable`, main framework profile), 25 nav menus paired with 25 behaviour themes, 14 design packages (26 total); **brand library** `framework/brand-library/` (not starters: 250 logos + 250 animated logos for AmberX + GizmoX, 100 icon packs, 50 branding packages; `brand-gen.mjs library [--check]`, quality gate, 629 KB of a 2 MB budget); filled icon packs fixed (closed shapes fill, lines stroke). Checks: check-toolbars 593, check-style-packages 735, check-brand 192, check-design-package 699, check-design-language 389.
- **Done (Opus, Oct 28–29 2026, inside `refactor-all`, PR #166 merged):** s27–s40 = refactor-all s28–s40: Brand library plugin (`apps/console-web/plugins/brand-library`), AmberX app on the design language + branding, GizmoX console shell + every enabled and banner plugin (`check-plugin-pages.mjs`), re-bakes, shots, report `_claude/memory/docs/rebuilds/enterprise-branding-3.md`. **Oct 30 2026 (Opus, `claude/enterprise-branding-3`):** Brett asked to restart the build at 33/46; the 13 open steps were already on main, so nothing was rebuilt. Re-checked on main 1b4ecd5a: AmberX test.mjs 1990/1990, brand-library test.mts 20/20, check-plugin-pages, check-theme, check-brand 205, check-design-language 427, check-design-package 1161. Orchestrator (both profiles) and pending item `enterprise-branding` marked complete. Running builds left alone: push-banner (`claude/pr-only-merge`), veto/approvals (`claude/veto-complete`), design-packs → ui-review (`claude/ui-review`); if they change those plugins' look, they hold it to DESIGN-LANGUAGE.md themselves.
- **Read first:** `framework/spec/DESIGN-LANGUAGE.md`, `framework/core/engines/brand.ts`, `brand-rules.mjs`, `brandgen.mjs`, `framework/react/components/Brand.tsx`, `_claude/builds/orchestrator.json`.
- **Approved (Oct 27 2026, card):** the Fable → Opus switch, recorded with `orchestrator.mjs act approve` (phase 2); #128 merged to main. <!-- axf-plugin:build-orchestrator -->
- **Nothing left to carry on** once the tracker PR merges. The look stays swappable by design package; Brett's 3 Angel design-pack picks swap it without code changes.
- **First message (Opus):** "Run `orchestrator.mjs brief enterprise-branding` and continue phase 3 on Opus from branch `opus/enterprise-branding` (merge it first if its PR landed)." <!-- axf-plugin:build-orchestrator -->

### AmberX Design Package + Behaviour theme (merged into enterprise-branding)
- **Orchestrator (Oct 27 2026):** build `design-package`, Fable s1-s5 then Opus s6-s9 (one switch).
- **Asked (Brett, Oct 27 2026, in the "Repo thread status review" chat):** "Make new AmberX Design Package asset type
  that wraps style theme, color theme, layout theme, and behavior theme. Add behavior theme asset type too. Apply
  option to select one in appearance section of settings. Wrap the rest of interface in collapsible container."
- **His answers (cards):** the Design Package **replaces** the Appearance package (`appearance-package`); a behaviour
  theme holds **everything**: motion (animations, speed, easing, reduced motion), interaction (hover/click/focus
  feedback, long-press time, double-tap), windows & dialogs (open/close, snap, stacking, drawers, pop-ups) and
  feedback (toasts, sounds, vibration, confirm-before-delete); "the rest" = the rest of **Settings → Appearance** in
  one collapsible container under the Design Package picker; model **Fable**.
- **Model:** Fable (new cross-app asset types + engines). Web first; Android twin goes in `framework/spec/PORTING.md`.
- **Plan:** pending item `design-package` (9 steps, 4.5 h; `node framework/cli/pending.mjs --steps`). Branch
  `fable/design-package`. Read first: `framework/schemas/asset-types.json`, `framework/core/engines/appearancepackage.ts`
  (what is being replaced), `framework/core/engines/looktokens.ts` (behaviour fallbacks), `framework/libs/settings`
  (Appearance tab), `framework/assets/appearance-package/`.
- **Overlaps:** `settings-asset-fable`, `appearance-asset-tokens-fable`, `apply-all-levels-fable`, `asset-templates`
  (all Fable, all touch Settings → Appearance or the asset types): say which to build together before starting.
- **Waiting on:** Brett, before step 6, on where the Appearance package's extra settings go (spacing, shown/hidden
  chrome, the other slot picks, customize tokens) once it is retired.
- **Checks:** `node framework/cli/axf.mjs validate --framework`, `npx -y tsx framework/spec/gen-fixtures.mts`, the new
  `check-behavior.mts` / `check-design-package.mts`, `check-appearance-package.mts` (replaced), `check-settings-ui.mts`,
  each re-baked app's typecheck + build, `node framework/cli/check-theme.mjs`, `check-controls.mjs`.
- **First message:** "Start the thread *AmberX Design Package + Behaviour theme* from `_claude/THREADS.md` → To carry
  on (pending item `design-package`). Run on Fable."
### AmberX Design Package (Fable rebuild)
- **Built on Opus (Oct 27 2026, Brett: "Do in opus"):** branch `rebuild/design-package-opus`. New types `design-package`
  (style + colour theme + layout + behaviour theme, optional `extras` = what the appearance package held) and
  `behavior-theme` (motion, interaction, windows, feedback); `appearance-package` retired and migrated. Settings →
  Appearance: AmberX Design Package picker on top, everything else in one collapsible *Everything else* container.
  Report `_claude/memory/docs/rebuilds/design-package.md`.
- **Fable rebuild:** pending item `design-package-fable` (steps in the pending list). Starts by reading the report and
  replacing the Opus build in place (same type names, data format and setting keys unless it says why).
- **Checks:** `npx -y tsx framework/spec/check-design-package.mts`, `gen-fixtures.mts`, `axf.mjs validate --framework`,
  re-baked apps' typecheck + build, `check-theme.mjs`, `check-controls.mjs`.
- **First message:** "Start the thread *AmberX Design Package (Fable rebuild)* from `_claude/THREADS.md` → To carry on
  (pending item `design-package-fable`). Run on Fable."

### Connections plugin (every connected app, 7 layouts)
- **Asked (Brett, Oct 26 2026, in the "Repo thread status review" chat; cut off, never started):** "Add tmux, ntfy,
  and tailscale to the install instructions and the step by step instructions [done in PR #106]. Also connect those 3
  to work automatically with everything else in the project through axhub. Create a plugin for any app but install
  in console that when installed in an app will list all the apps connected through axhub and or available to the
  project including but not limited to GitHub, Claude code, hostinger, coolify, tmux, ntfy, tailscale, axhub,
  console, moshi, and any other that's part of the framework or any developer app in it. It will also have sections
  that list other outside websites, tools, content, data, or services that can be connected to the project via axhub
  through mcp, API, http credentials, or other methods that can be wired to axhub. Give the plugin's default layout a
  toolbar that is saved as an asset. The toolbar will have 3 buttons for different layout/views and 1 for plugin
  settings. The 3 options need to be complete redesigns of the entire plugin. You can freely use toolbars, tab groups,
  context menu, navigation menu, application menu, banners, widgets, logos, attachable assets, etc. You can have any
  number of these things. I will specify certain things in the default and you fill in the blanks to make it
  professional and powerful and then you design a diverse selection for the other 6 entirely on your own. The only
  thing all 7 must have is a method to switch amongst the 7." (He also mentioned a plugin-layout asset type.)
- **Waiting on:** Brett's go and model pick (the plugin-layout asset type is Fable territory by the model rule); the
  details he meant to give for the default layout ("I will specify certain things in the default").
- **First message:** "Start the thread *Connections plugin* from `_claude/THREADS.md` → To carry on. Ask me for the
  model and for what I want in the default layout before building."

### Separate Console and Patches asset visibility (#94)
- Draft PR #94 on `claude/project-thread-k6ckjv`, behind main with small conflicts in `framework/plan/pending.json`
  and `framework/spec/PORTING.md`. **Waiting on:** Brett's answer; the question was asked in a Claude Code session and
  isn't written down. Read PR #94's description and commits, then ask him again with cards.

### Fix git merge conflicts
- No branch. **Waiting on:** Brett's answer; the question isn't written down. Ask him what it was about.

### Add icon picker dialog for status plugins
- Unmerged work on `claude/project-thread-4s5igq` and `claude/project-thread-v1id7r`, no PR. **Waiting on:** Brett's
  answer; the question isn't written down. Read both branches, then ask him again with cards.

### Add Push banner action log
- On hold by Brett. Nothing built.

### Store project rules in repo
- Queued: rules file `_claude/rules/PROJECT-RULES.md`. Waiting on Brett's go.

## Done (recent)

| Thread | Result | Updated |
| Fix: axHub web approvals log — entries for tools that ran without approval (vps.build_*) opened an empty request page | fixed on main (Leftovers): tool, arguments, who ran it, when, result shown inline, The request only on approved calls; axhub-web test 276/276; UI Review `r-20261101-f74d2ada` waiting | 2026-11-01 |
| Audio Output Recorder (Angel `audio-output-recorder`): phone playback → 30-min chunks → axHub, no mic (Opus) | merged (#194, e46b8079 + 08f84bf3): checked step by step against main by Leftovers, all 5 really built; test.mts 18/18 (Node 22) | 2026-11-01 |
| Audio Extract plugin for AmberX (Angel `audio-extract`): audio out of screen recordings (lossless .m4a / WAV), batch, trim, track pick, Share → AmberX, new-recording cards, results list; built-in screen recorder with app playback audio, no mic (Opus) | merged (claude/audio-extract on main); test.mts 24/24, AmberX test.mjs + tsc green, lifecycle clean (Leftovers s7); install the new AmberX APK from CI | 2026-11-01 |
| UI Review plugin (Angel `ui-review`): Design packs renamed + widened into one UI approval plugin — sections per kind (open registry), tree / grid / sub-grids / gallery / compare, bulk Approve / Ask changes / Reject, `review.mjs submit`, `rebuild-shots --submit`, capability `ui-review@1` (launched build, Opus) | merged; follow-up s9 done by Leftovers: auto-merge holds PRs whose UI review is waiting / changes / rejected (push-banner test 150) | 2026-11-01 |
| Live key + health checks in the banners (Angel `live-key-checks`): every key tested against its service every 15 min, red banner item with what broke / what it breaks / since when + Fix, health@1 registry, stuck builds, veto, CI on main, containers, disk, one push per red item to AmberX; **+ Fix it yourself** (Oct 31): health@1 auto-fix first, red only if still broken (on / ask first / off per check), github@1 = GitHub through axHub with local-token fallback, rule in shared RULES + CLAUDE.md (Opus) | merged; follow-ups s7 + s12 done by Leftovers (push banner on axf.github@1 + its own health@1 item; tests 141 + 216) | 2026-11-01 |
| Agent voice plugin: agents speak with a per-agent narrator console (device + cloud voices), live status light on the banner + Assistant title bar, Assistant mic (missing-permission / not-installed tooltips, install links), mic broker that never fights AmberX wake/dictation (claude.ai, Refactor, Opus) | merged (feat/agent-voice on main); lifecycle clean, test.py 37/37, test.mts 22/22 (Leftovers s9) | 2026-11-01 |
| Veto complete (Brett voice Oct 30): 90 s countdown; Approve now + Shelve next to Deny (axHub decision #104); the veto banner plugin owns notices, veto screen and a configurable alarm and loads in AmberX too; AmberX phone: notice buttons Deny / Approve / Shelve, tap = veto screen, alarm through silent mode (VPS launch, Refactor, Opus) | merged (AXF + axHub claude/veto-complete); 90 s, Approve now + Shelve, veto banner alarm; shared rules deduped (stale 3-minute copy removed) (Leftovers) | 2026-11-01 |
| Veto everywhere + automatic merge: every axHub call that needs Brett runs after the countdown unless denied; ready PRs merge by themselves (push banner auto-merge, every 3 min, CI green + pinned head); axHub gets CI (claude.ai, Refactor, Opus) | merged (AXF + axHub main); live hub runs 209951f with AXHUB_CONFIRM_AS default veto; axHub 514/514, AmberX 2045/2045 (Leftovers s3+s9) | 2026-11-01 |
| Orchestrator ↔ Pending auto-sync (Refactor `orch-pending-sync`) | done: superseded by the one builds store (urgent-builds); shared rule rewritten for the store, CI covers it with check-builds-store + builds-store verify (Leftovers, s3) | 2026-11-01 |
| Urgent: master cleanup — one builds store (builds@1) for every profile, versioned writes, no queue re-create on start; Builds page (Builds + Steps views, rename, drag, divide, harvest / split into N, Restore default, draft until Apply); live progress bars + banner %; push banner duplicate-PR fix (headless, Urgent profile, Opus) | merged to main (2a057cc4, Nov 1); store + journal + exports, Builds page, push-banner dup-PR fix; UI Review `r-20261101-itzed01` waiting; follow-ups in the report's Known gaps (Leftovers closed s12) | 2026-11-01 |
|---|---|---|
| Fix: console look not saved to axHub (Hub sync detached the console's own source) | merged (#148), console + axHub web + AmberX redeploy on the 5-minute update | 2026-10-28 |
| Fix: Appearance switches + interface tab buttons dead inside GizmoX tabs | merged (#146), console redeploys on the 5-minute update | 2026-10-28 |
| AmberX look fix + Lock the look + Get the look from axHub switches | merged (#126) through Brett's axHub merge approval; amberx.amberxai.com picks it up in the 5-minute update | 2026-10-27 |
| Fresh look: new default style theme + `fresh` appearance package | merged (#119), deployed to console, AmberX, axHub web, Patches web; shared look on axHub switched to Fresh | 2026-10-27 |
| AmberX as an empty shell for building and testing plugins | merged (#118); the hosted app updates in 5 min, CI builds the APK | 2026-10-26 |
| Banner look Apply to all (Simple/Basic/Pro/Advanced), settings levels, Sliders | merged (#115); console updates in 5 min, other apps on their next deploy. Fable rebuild parked (`apply-all-levels-fable`) | 2026-10-26 |
| No login questions + headless sessions in the console Terminal | merged (#105) | 2026-10-26 |
| Move axHub to console-style pages | AmberX-AXF #100 merged | 2026-10-26 |
| Fix AmberX app sign-in and hosting | merged (#99); amberx.amberxai.com running on the VPS (amberx-web, DNS in place, 5-minute auto-update) | 2026-10-26 |
| Track threads and builds in the repo | merged | 2026-10-26 |
| Require access and refresh Claude tokens | merged (#97) | 2026-10-26 |
| Fix banner rows not expanding | merged (#96) | 2026-10-26 |
| Give axHub the console's settings interface | merged (#95) | 2026-10-26 |
| Add assets appearance editing section | merged (#93) | 2026-10-26 |
| Banner settings Apply to all + keys re-checked while open | merged (#107); console updates in 5 min. Fable rebuild parked (`banner-apply-all-fable`) | 2026-10-26 |
| Fix amberx.amberxai.com + AmberX app (404: Traefik router `amberxweb` clashed with amberx-app; now `amberxdroid`) | merged; the 5-minute update redeploys it | 2026-10-26 |
| Banner text on one line | merged (#110); console updates in 5 min. Fable rebuild parked (`banner-one-line-fable`) | 2026-10-26 |
| axHub: bad OAuth setting never stops the hub (axHub #13, decision #100) | merged; redeploy axHub on Coolify | 2026-10-26 |
| axHub OAuth 2.1 sign-in (axHub #9, AXF #102) | merged; redeploy axHub on Coolify | 2026-10-26 |
| Approval reasons + Go pass (axHub #10 as decision #99, AXF #103) | merged; redeploy axHub on Coolify | 2026-10-26 |
| Fix systems check banner: console re-bake + one-chat-per-task rule (#108) | merged | 2026-10-26 |
| Write install instructions and install steps | merged (#104) | 2026-10-26 |
| axHub connector: OAuth client registration (decision #98) | merged (axHub #11); redeploy axHub, then re-add the connector | 2026-10-26 |
| Add changes and features grid plugin | merged | 2026-10-25 |
| Edit each Appearance asset individually | merged | 2026-10-25 |
| Build context menu designer plugin | merged | 2026-10-25 |
| Add Amber menu and appearance packages | merged | 2026-10-25 |
| Build AmberX voice-first Android app | merged | 2026-10-25 |
| Restore axHub web app look | merged | 2026-10-25 |
| Hide console App tabs bar | done | 2026-10-25 |
| Carry open threads in handoff prompt | merged | 2026-10-25 |
| Merge passed draft PRs | done | 2026-10-25 |
| Close stale draft PRs (#71 #70 #63 #57, Build-Pilot #4; branches kept) | done | 2026-10-25 |
| Make Patches feel like one app (PR #71 closed unmerged; Fable rebuild `patches-one-app-fable` parked) | closed | 2026-10-25 |
| Show Claude account email from VPS | done | 2026-10-25 |
| Add Claude connection status plugin | done | 2026-10-25 |
| Remove Console-duplicate plugins from Pilot | done | 2026-10-25 |
| Fix axHub layout inside Patches | merged | 2026-10-24 |
| Expand appearance asset customization | merged | 2026-10-24 |
| Fix banners not working | done | 2026-10-24 |
| Track all work in activity banner | merged | 2026-10-24 |
| Build axHub web app on AmberX | merged | 2026-10-24 |
| Sync app settings through axHub | merged | 2026-10-24 |
| Add Vinny VPS root agent | merged | 2026-10-24 |
| Settings interface as asset | merged | 2026-10-23 |
| Banner working icon animation | merged | 2026-10-23 |
| Banner right-click hide menu | merged | 2026-10-23 |
| Pull all repair flow | merged | 2026-10-23 |
| Floating banner group window | done | 2026-10-23 |
| Pending PR merges | done | 2026-10-23 |

### windows-terminal (claude/windows-terminal)
- **Asked (Brett, Oct 28 2026, claude.ai):** see orchestrator build `windows-terminal` detail (full request there).
- **Model:** Opus s1–s5 (console-terminal upgrade), Fable s6–s12 (window engine physics, settings-ui@1 levels contract, level toolbar + editor). Approval card at the switch.
- **Read first:** apps/console-web/plugins/console-terminal (README, web/, server/), framework/core/engines/windows.ts, framework/react/windows/WindowHost.tsx, framework/core/engines/settingsui.ts, framework/libs/settings.
- **Done:** s1–s5 (Opus) on `claude/windows-terminal`.
- **Next:** Fable phase s6–s12 on a new branch `fable/windows-terminal` from main after the Opus PR merges: `node orchestrator.mjs brief windows-terminal`. Waits on: Brett's approval of the Opus → Fable switch. <!-- axf-plugin:build-orchestrator -->
- **First message for a new session (Fable):** "Carry on orchestrator build windows-terminal (refactor): the Fable phase s6–s12, on branch fable/windows-terminal from main. Read the brief with orchestrator.mjs brief windows-terminal." <!-- axf-plugin:build-orchestrator -->

### feature-matrix (stopped by the STOP ORDER Oct 28 2026 15:26 EDT; Fable s1–s2 done on `fable/feature-matrix`, folded into refactor-all)
- **Stopped:** after s2, nothing mid-way. s1 (contract) + s2 (Apply engine) are pushed on `fable/feature-matrix` (`cb43a82`, handoff `aa82cf2`), not merged. In `refactor-all`: s24, s25 ticked done; s62–s67 (= s3–s8) left. Full handoff in that branch's THREADS.md and `_claude/memory/docs/feature-matrix.md`.
- **Asked (Brett, Oct 28 2026, claude.ai):** full request in orchestrator build `feature-matrix` detail. Model of the UI: the windows-terminal scope list https://claude.ai/artifact/CwBGQof4NBe4F3dPTczBvS (its db doc `scope/selection` is the first matrix).
- **Picks:** Refactor profile; standalone plugin; builds-one-page archived ("remove one page"); own chat thread.
- **Model:** Fable s1–s2 (feature-matrix@1 contract + apply engine), Opus s3–s8 (console plugin, views, grid hooks, seed, ship). Approval card at the switch.
- **Read first:** apps/console-web/plugins/build-orchestrator (web/orchestrator-core.mjs), framework/cli/pending.mjs, framework/cli/build-queue.mjs, apps/console-web/plugins/build-manager, apps/console-web/plugins/changes-grid, orchestrator build share-search s1 (grid-attach@1). <!-- axf-plugin:build-orchestrator -->
- **First message for the new chat (Fable):** "Start orchestrator build feature-matrix (refactor) in AmberX-AXF: Fable phase s1–s2 on branch fable/feature-matrix. Read the brief with orchestrator.mjs brief feature-matrix." <!-- axf-plugin:build-orchestrator -->

## Live build log

<!-- builds-live.mjs appends one line per build change as it reaches main (newest last, last 400 kept). Do not edit by hand. -->

- 2026-11-03 19:55 UTC · `ui-review-predicted` note (urgent) · orchestrator
- 2026-11-03 19:55 UTC · `batch-manager` note (angel) · orchestrator
- 2026-11-03 19:56 UTC · `ui-review-shots` s4 done (urgent) · orchestrator
- 2026-11-03 19:55 UTC · `agent-pick` s9 done, → built (urgent) · Snap Sully (claude code)
- 2026-11-03 19:55 UTC · `agent-pick` note (urgent) · Snap Sully (claude code)
- 2026-11-03 19:56 UTC · `ui-review-shots` s5 done, → complete (urgent) · orchestrator
- 2026-11-03 19:56 UTC · `ui-review-shots` note (urgent) · orchestrator
- 2026-11-03 19:56 UTC · `ui-review-shots` → built, PR #277 (urgent) · builds-live
- 2026-11-03 19:56 UTC · `ui-review-shots` PR #277, note (urgent) · reconciler
- 2026-11-03 19:58 UTC · `terminal-sessions-nav` added (4 steps) (current) · orchestrator
- 2026-11-03 19:59 UTC · `terminal-sessions-nav` added (4 steps) (current) · foreign-write
- 2026-11-03 19:59 UTC · `profile-manager` added (6 steps) (current) · orchestrator
- 2026-11-03 19:59 UTC · `window-resize-fix` s1 done, s2 done (current) · foreign-write
- 2026-11-03 19:59 UTC · `smart-menus` s1 done (urgent) · orchestrator
- 2026-11-03 19:59 UTC · `smart-menus` s2 done (urgent) · orchestrator
- 2026-11-03 19:59 UTC · `smart-menus` s3 done (urgent) · orchestrator
- 2026-11-03 20:00 UTC · `window-resize-fix` s1 done (current) · foreign-write
- 2026-11-03 20:00 UTC · `terminal-sessions-nav` added (8 steps) (current) · foreign-write
- 2026-11-03 20:00 UTC · `profile-manager` added (6 steps) (current) · foreign-write
- 2026-11-03 20:00 UTC · `home-cards-live` s1 done (urgent) · orchestrator
- 2026-11-03 20:00 UTC · `home-cards-live` s2 done (urgent) · orchestrator
- 2026-11-03 20:00 UTC · `home-cards-live` s4 done (urgent) · orchestrator
- 2026-11-03 20:00 UTC · `home-cards-live` s5 done (urgent) · orchestrator
- 2026-11-03 20:01 UTC · `window-resize-fix` s2 done (current) · foreign-write
- 2026-11-03 20:02 UTC · `profile-manager` s1 done, → running (current) · orchestrator
- 2026-11-03 20:04 UTC · `profile-manager` s2 done (current) · orchestrator
- 2026-11-03 20:06 UTC · `window-resize-fix` s2 done (current) · foreign-write
- 2026-11-03 20:06 UTC · `terminal-sessions-nav` added (24 steps) (current) · foreign-write
- 2026-11-03 20:06 UTC · `profile-manager` added (6 steps) (current) · foreign-write
- 2026-11-03 20:00 UTC · `window-resize-fix` branch claude/window-resize-fix, note (current) · reconciler
- 2026-11-03 20:10 UTC · `window-resize-fix` PR #278, merged, note (current) · reconciler
- 2026-11-03 19:59 UTC · `window-resize-fix` s2 done (current) · orchestrator
- 2026-11-03 20:00 UTC · `window-resize-fix` note (current) · foreign-write
- 2026-11-03 20:00 UTC · `window-resize-fix` branch claude/window-resize-fix, PR #278 (current) · builds-live
- 2026-11-03 20:12 UTC · `window-resize-fix` note (current) · foreign-write
- 2026-11-03 20:12 UTC · `profile-manager` s1 done, s2 done (current) · foreign-write
- 2026-11-03 20:12 UTC · `window-resize-fix` s3 done, → built (current) · orchestrator
- 2026-11-03 20:12 UTC · `window-resize-fix` note (current) · orchestrator
- 2026-11-03 20:12 UTC · `window-resize-fix` → complete (current) · orchestrator
- 2026-11-03 20:13 UTC · `window-resize-fix` s3 done, → complete, note (current) · foreign-write
- 2026-11-03 20:13 UTC · `profile-manager` s1 done, s2 done (current) · foreign-write
- 2026-11-03 20:13 UTC · `smart-menus` s4 done (urgent) · orchestrator
- 2026-11-03 20:13 UTC · `smart-menus` s5 done (urgent) · orchestrator
- 2026-11-03 20:14 UTC · `window-resize-fix` s3 done, → complete, note (current) · foreign-write
- 2026-11-03 20:14 UTC · `profile-manager` s3 done (current) · orchestrator
- 2026-11-03 20:14 UTC · `profile-manager` s4 done (current) · orchestrator
- 2026-11-03 20:14 UTC · `profile-manager` s5 done (current) · orchestrator
- 2026-11-03 20:15 UTC · `window-resize-fix` s3 done, → complete, note (current) · foreign-write
- 2026-11-03 20:15 UTC · `profile-manager` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 20:18 UTC · `ui-review-predicted` s1 done (urgent) · orchestrator
- 2026-11-03 20:18 UTC · `ui-review-predicted` s2 done (urgent) · orchestrator
- 2026-11-03 20:18 UTC · `ui-review-predicted` s3 done (urgent) · orchestrator
- 2026-11-03 20:19 UTC · `window-resize-fix` s2 done, s3 done, → complete, note (current) · foreign-write
- 2026-11-03 20:19 UTC · `profile-manager` added (6 steps) (current) · foreign-write
- 2026-11-03 20:19 UTC · `terminal-sessions-nav` s1 done, → running (current) · orchestrator
- 2026-11-03 20:19 UTC · `terminal-sessions-nav` s2 done (current) · orchestrator
- 2026-11-03 20:19 UTC · `terminal-sessions-nav` s3 done (current) · orchestrator
- 2026-11-03 20:20 UTC · `terminal-sessions-nav` s1 done, s2 done, s3 done (current) · foreign-write
- 2026-11-03 20:21 UTC · `ui-review-predicted` s4 done (urgent) · orchestrator
- 2026-11-03 20:23 UTC · `build-prompt-origin` added (5 steps) (current) · janitor-joey
- 2026-11-03 20:23 UTC · `build-prompt-origin` s1 done, → running (current) · orchestrator
- 2026-11-03 20:25 UTC · `build-prompt-origin` s2 done (current) · orchestrator
- 2026-11-03 20:26 UTC · `build-prompt-origin` added (5 steps) (current) · foreign-write
- 2026-11-03 20:26 UTC · `terminal-vps-host` added (5 steps) (current) · foreign-write
- 2026-11-03 20:26 UTC · `window-resize-fix` added (3 steps) (current) · foreign-write
- 2026-11-03 20:26 UTC · `terminal-sessions-nav` added (4 steps) (current) · foreign-write
- 2026-11-03 20:26 UTC · `profile-manager` added (6 steps) (current) · foreign-write
- 2026-11-03 20:26 UTC · `follow-amber` s7 done, → complete (urgent) · orchestrator
- 2026-11-03 20:26 UTC · `follow-amber` → built, PR #280 (urgent) · orchestrator
- 2026-11-03 20:26 UTC · `follow-amber` note (urgent) · orchestrator
- 2026-11-03 20:30 UTC · `plugin-settings-placement` added (6 steps) (current) · orchestrator
- 2026-11-03 20:30 UTC · `build-prompt-origin` s4 done (current) · orchestrator
- 2026-11-03 20:31 UTC · `build-prompt-origin` added (5 steps) (current) · foreign-write
- 2026-11-03 20:31 UTC · `plugin-settings-placement` added (12 steps) (current) · foreign-write
- 2026-11-03 20:37 UTC · `terminal-sessions-nav` s1 done, s2 done, s3 done (current) · foreign-write
- 2026-11-03 20:37 UTC · `profile-manager` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 20:37 UTC · `build-prompt-origin` added (5 steps) (current) · foreign-write
- 2026-11-03 20:37 UTC · `plugin-settings-placement` added (18 steps) (current) · foreign-write
- 2026-11-03 20:37 UTC · `smart-menus` s6 done (urgent) · orchestrator
- 2026-11-03 20:38 UTC · `build-prompt-origin` s4 done (current) · foreign-write
- 2026-11-03 20:38 UTC · `plugin-settings-placement` added (36 steps) (current) · foreign-write
- 2026-11-03 20:43 UTC · `smart-menus` PR #281 (urgent) · builds-live
- 2026-11-03 20:43 UTC · `smart-menus` s7 done, → built (urgent) · orchestrator
- 2026-11-03 20:43 UTC · `smart-menus` note (urgent) · orchestrator
- 2026-11-03 20:44 UTC · `smart-menus` s7 done, → built (urgent) · foreign-write
- 2026-11-03 20:47 UTC · `plugin-settings-placement` s1 done (current) · foreign-write
- 2026-11-03 20:47 UTC · `build-prompt-origin` s4 done (current) · foreign-write
- 2026-11-03 20:47 UTC · `plugin-settings-placement` s2 done (current) · foreign-write
- 2026-11-03 20:47 UTC · `banner-ref-links` added (5 steps) (current) · foreign-write
- 2026-11-03 20:47 UTC · `plugin-settings-placement` s1 done, → running (current) · orchestrator
- 2026-11-03 20:47 UTC · `plugin-settings-placement` s2 done (current) · orchestrator
- 2026-11-03 20:49 UTC · `plugin-settings-placement` s1 done, s2 done (current) · foreign-write
- 2026-11-03 20:49 UTC · `banner-ref-links` added (5 steps) (current) · foreign-write
- 2026-11-03 20:53 UTC · `plugin-settings-placement` s1 done, s2 done (current) · foreign-write
- 2026-11-03 20:53 UTC · `banner-ref-links` added (10 steps) (current) · foreign-write
- 2026-11-03 20:53 UTC · `build-prompt-origin` s3 done (current) · orchestrator
- 2026-11-03 20:53 UTC · `build-prompt-origin` s5 done, → complete (current) · orchestrator
- 2026-11-03 20:53 UTC · `build-prompt-origin` → built, PR #282 (current) · builds-live
- 2026-11-03 20:55 UTC · `build-prompt-origin` s3 done, s5 done, → complete (current) · foreign-write
- 2026-11-03 20:55 UTC · `plugin-settings-placement` s3 done, → running (current) · orchestrator
- 2026-11-03 20:55 UTC · `plugin-settings-placement` s4 done (current) · orchestrator
- 2026-11-03 20:55 UTC · `plugin-settings-placement` s5 done (current) · orchestrator
- 2026-11-03 20:56 UTC · `plugin-settings-placement` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 20:47 UTC · `plugin-settings-placement` s1 done, s2 done (current) · foreign-write
- 2026-11-03 20:47 UTC · `banner-ref-links` added (5 steps) (current) · orchestrator
- 2026-11-03 20:47 UTC · `banner-ref-links` → running (current) · orchestrator
- 2026-11-03 20:56 UTC · `build-prompt-origin` s3 done, s5 done, → complete (current) · foreign-write
- 2026-11-03 20:56 UTC · `banner-ref-links` s1 done (current) · orchestrator
- 2026-11-03 20:57 UTC · `banner-ref-links` → running, branch claude/banner-ref-links (current) · foreign-write
- 2026-11-03 21:00 UTC · `home-cards-live` branch claude/home-cards-live, note (urgent) · reconciler
- 2026-11-03 21:02 UTC · `build-prompt-origin` s3 done, s5 done, → complete (current) · foreign-write
- 2026-11-03 21:02 UTC · `plugin-settings-placement` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 21:02 UTC · `banner-ref-links` s1 done (current) · foreign-write
- 2026-11-03 21:05 UTC · `window-resize-fix` s3 done, → complete, note (current) · foreign-write
- 2026-11-03 21:05 UTC · `terminal-sessions-nav` s1 done, s2 done, s3 done (current) · foreign-write
- 2026-11-03 21:05 UTC · `profile-manager` s1 done, s2 done, s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 21:05 UTC · `build-prompt-origin` added (5 steps) (current) · foreign-write
- 2026-11-03 21:05 UTC · `plugin-settings-placement` added (6 steps) (current) · foreign-write
- 2026-11-03 21:05 UTC · `banner-ref-links` added (5 steps) (current) · foreign-write
- 2026-11-03 21:05 UTC · `home-cards-live` branch claude/home-cards-live (urgent) · builds-live
- 2026-11-03 21:03 UTC · `home-cards-live` PR #283, note (urgent) · reconciler
- 2026-11-03 21:05 UTC · `molly-console-commands` added (7 steps) (current) · orchestrator
- 2026-11-03 21:08 UTC · `molly-console-commands` added (7 steps) (current) · foreign-write
- 2026-11-03 21:10 UTC · `git-status-board` added (6 steps) (current) · foreign-write
- 2026-11-03 20:54 UTC · `home-cards-live` branch claude/home-cards-live, note (urgent) · reconciler
- 2026-11-03 21:11 UTC · `plugin-settings-placement` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 21:11 UTC · `banner-ref-links` s1 done (current) · foreign-write
- 2026-11-03 21:11 UTC · `molly-console-commands` added (14 steps) (current) · foreign-write
- 2026-11-03 21:11 UTC · `git-status-board` added (6 steps) (current) · foreign-write
- 2026-11-03 21:12 UTC · `urgent-main-ci-green` added (5 steps) (current) · orchestrator
- 2026-11-03 21:12 UTC · `urgent-main-ci-green` added (5 steps) (current) · foreign-write
- 2026-11-03 21:12 UTC · `urgent-main-ci-green` s1 done, → running (current) · orchestrator
- 2026-11-03 21:12 UTC · `urgent-main-ci-green` s2 done (current) · orchestrator
- 2026-11-03 21:14 UTC · `urgent-main-ci-green` branch claude/urgent-main-ci-green, PR #284 (current) · builds-live
- 2026-11-03 21:15 UTC · `urgent-main-ci-green` branch claude/urgent-main-ci-green, PR #284 (current) · foreign-write
- 2026-11-03 21:17 UTC · `molly-console-commands` added (28 steps) (current) · foreign-write
- 2026-11-03 21:17 UTC · `git-status-board` added (12 steps) (current) · foreign-write
- 2026-11-03 21:17 UTC · `urgent-main-ci-green` added (5 steps) (current) · foreign-write
- 2026-11-03 21:17 UTC · `home-cards-live` note (urgent) · orchestrator
- 2026-11-03 21:17 UTC · `home-cards-live` s3 done (urgent) · orchestrator
- 2026-11-03 21:17 UTC · `home-cards-live` s6 done, → complete (urgent) · orchestrator
- 2026-11-03 21:17 UTC · `home-cards-live` → built, PR #283 (urgent) · builds-live
- 2026-11-03 21:19 UTC · `molly-console-commands` added (56 steps) (current) · foreign-write
- 2026-11-03 21:19 UTC · `git-status-board` added (24 steps) (current) · foreign-write
- 2026-11-03 21:19 UTC · `urgent-main-ci-green` added (5 steps) (current) · foreign-write
- 2026-11-03 21:20 UTC · `banner-ref-links` s2 done, s3 done, s4 done (current) · foreign-write
- 2026-11-03 21:19 UTC · `banner-ref-links` s2 done (current) · orchestrator
- 2026-11-03 21:19 UTC · `banner-ref-links` s3 done (current) · orchestrator
- 2026-11-03 21:19 UTC · `banner-ref-links` s4 done (current) · orchestrator
- 2026-11-03 21:22 UTC · `banner-ref-links` s2 done, s3 done, s4 done (current) · foreign-write
- 2026-11-03 21:23 UTC · `whats-new-open-fix` added (5 steps) (current) · orchestrator
- 2026-11-03 21:23 UTC · `whats-new-open-fix` added (5 steps) (current) · foreign-write
- 2026-11-03 21:25 UTC · `whats-new-open-fix` added (10 steps) (current) · foreign-write
- 2026-11-03 21:10 UTC · `git-status-board` added (6 steps) (current) · claude-session (Snap Sully)
- 2026-11-03 21:11 UTC · `batch-manager` note (angel) · claude-session (Snap Sully)
- 2026-11-03 21:26 UTC · `banner-ref-links` s2 done, s3 done, s4 done (current) · foreign-write
- 2026-11-03 21:26 UTC · `urgent-main-ci-green` added (5 steps) (current) · foreign-write
- 2026-11-03 21:26 UTC · `whats-new-open-fix` added (20 steps) (current) · foreign-write
- 2026-11-03 21:26 UTC · `git-status-board` s1 done, → running (current) · claude-session (Snap Sully)
- 2026-11-03 21:26 UTC · `git-status-board` s2 done (current) · claude-session (Snap Sully)
- 2026-11-03 21:27 UTC · `git-status-board` s1 done, s2 done (current) · foreign-write
- 2026-11-03 21:30 UTC · `git-status-board` s1 done, s2 done (current) · foreign-write
- 2026-11-03 21:30 UTC · `ui-review-predicted` PR #285 (urgent) · builds-live
- 2026-11-03 21:30 UTC · `ui-review-predicted` PR #285, note (urgent) · reconciler
- 2026-11-03 21:31 UTC · `banner-ref-links` s2 done, s3 done, s4 done (current) · foreign-write
- 2026-11-03 21:31 UTC · `git-status-board` s1 done, s2 done (current) · foreign-write
- 2026-11-03 21:31 UTC · `whats-new-open-fix` added (40 steps) (current) · foreign-write
- 2026-11-03 21:31 UTC · `urgent-main-ci-green` s4 done (current) · orchestrator
- 2026-11-03 21:31 UTC · `urgent-main-ci-green` s5 done (current) · orchestrator
- 2026-11-03 21:31 UTC · `urgent-main-ci-green` note (current) · orchestrator
- 2026-11-03 21:35 UTC · `git-status-board` s1 done, s2 done (current) · foreign-write
- 2026-11-03 21:35 UTC · `urgent-main-ci-green` s4 done, s5 done, note (current) · foreign-write
- 2026-11-03 21:36 UTC · `whats-new-open-fix` s1 done, → running (current) · orchestrator
- 2026-11-03 21:36 UTC · `whats-new-open-fix` note (current) · orchestrator
- 2026-11-03 21:38 UTC · `git-status-board` s1 done, s2 done (current) · foreign-write
- 2026-11-03 21:38 UTC · `urgent-main-ci-green` s4 done, s5 done, note (current) · foreign-write
- 2026-11-03 21:38 UTC · `whats-new-open-fix` added (5 steps) (current) · foreign-write
- 2026-11-03 21:38 UTC · `molly-console-commands` s1 done, → running (current) · orchestrator
- 2026-11-03 21:38 UTC · `molly-console-commands` s2 done (current) · orchestrator
- 2026-11-03 21:38 UTC · `molly-console-commands` s1 done, s2 done (current) · foreign-write
- 2026-11-03 21:38 UTC · `whats-new-open-fix` s1 done, note (current) · foreign-write
- 2026-11-03 21:45 UTC · `banner-ref-links` s5 done, → complete (current) · orchestrator
- 2026-11-03 21:45 UTC · `banner-ref-links` → built, PR #287 (current) · builds-live
- 2026-11-03 21:45 UTC · `banner-ref-links` note (current) · orchestrator
- 2026-11-03 21:45 UTC · `build-prompt-origin` added (5 steps) (current) · foreign-write
- 2026-11-03 21:45 UTC · `plugin-settings-placement` added (6 steps) (current) · foreign-write
- 2026-11-03 21:45 UTC · `banner-ref-links` added (5 steps) (current) · foreign-write
- 2026-11-03 21:45 UTC · `molly-console-commands` added (112 steps) (current) · foreign-write
- 2026-11-03 21:45 UTC · `git-status-board` added (12 steps) (current) · foreign-write
- 2026-11-03 21:45 UTC · `urgent-main-ci-green` added (5 steps) (current) · foreign-write
- 2026-11-03 21:45 UTC · `whats-new-open-fix` added (5 steps) (current) · foreign-write
- 2026-11-03 21:45 UTC · `terminal-sessions-nav` PR #286 (current) · builds-live
- 2026-11-03 21:45 UTC · `terminal-sessions-nav` s4 done, → built (current) · orchestrator
- 2026-11-03 21:45 UTC · `terminal-sessions-nav` note (current) · orchestrator
- 2026-11-03 21:46 UTC · `terminal-sessions-nav` s4 done, → complete, note (current) · foreign-write
- 2026-11-03 21:46 UTC · `banner-ref-links` s5 done, → complete, note (current) · foreign-write
- 2026-11-03 21:46 UTC · `molly-console-commands` s3 done (current) · orchestrator
- 2026-11-03 21:46 UTC · `molly-console-commands` s4 done (current) · orchestrator
- 2026-11-03 21:47 UTC · `plugin-settings-placement` branch claude/plugin-settings-placement, note (current) · reconciler
- 2026-11-03 21:48 UTC · `molly-console-commands` branch claude/molly-console-commands, PR #288 (current) · builds-live
- 2026-11-03 21:48 UTC · `plugin-settings-placement` note (current) · foreign-write
- 2026-11-03 21:48 UTC · `molly-console-commands` note (current) · orchestrator
- 2026-11-03 21:50 UTC · `molly-console-commands` s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, note (current) · foreign-write
- 2026-11-03 21:50 UTC · `terminal-drag-chain-tree` added (6 steps) (current) · orchestrator
- 2026-11-03 21:50 UTC · `terminal-drag-chain-tree` → running (current) · orchestrator
- 2026-11-03 21:49 UTC · `plugin-settings-placement` note (current) · foreign-write
- 2026-11-03 21:49 UTC · `molly-console-commands` s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, s1 undone, s2 undone, s3 undone, s4 undone, note (current) · foreign-write
- 2026-11-03 21:49 UTC · `ui-review-predicted` note (urgent) · orchestrator
- 2026-11-03 21:54 UTC · `terminal-drag-chain-tree` added (6 steps) (current) · foreign-write
- 2026-11-03 21:55 UTC · `molly-nav-submenus` added (5 steps) (current) · orchestrator
- 2026-11-03 21:55 UTC · `smart-menus` note (urgent) · orchestrator
- 2026-11-03 21:58 UTC · `molly-nav-submenus` added (5 steps) (current) · foreign-write
- 2026-11-03 21:58 UTC · `terminal-drag-chain-tree` s1 done (current) · orchestrator
- 2026-11-03 21:58 UTC · `terminal-drag-chain-tree` s1 done (current) · foreign-write
- 2026-11-03 21:58 UTC · `molly-nav-submenus` added (10 steps) (current) · foreign-write
- 2026-11-03 21:58 UTC · `ui-review-predicted` s5 done (urgent) · orchestrator
- 2026-11-03 21:58 UTC · `ui-review-predicted` s6 done, → built (urgent) · orchestrator
- 2026-11-03 22:00 UTC · `plugin-settings-placement` PR #289, note (current) · reconciler
- 2026-11-03 22:01 UTC · `plugin-settings-placement` note (current) · foreign-write
- 2026-11-03 22:01 UTC · `terminal-drag-chain-tree` s2 done (current) · orchestrator
- 2026-11-03 22:01 UTC · `terminal-sessions-nav` s4 done, → complete, note (current) · foreign-write
- 2026-11-03 22:01 UTC · `banner-ref-links` s5 done, → complete, note (current) · foreign-write
- 2026-11-03 22:01 UTC · `molly-console-commands` note (current) · foreign-write
- 2026-11-03 22:01 UTC · `urgent-main-ci-green` s4 done, s5 done, note (current) · foreign-write
- 2026-11-03 22:01 UTC · `whats-new-open-fix` s1 done, note (current) · foreign-write
- 2026-11-03 22:01 UTC · `terminal-drag-chain-tree` added (6 steps) (current) · foreign-write
- 2026-11-03 22:01 UTC · `molly-nav-submenus` added (20 steps) (current) · foreign-write
- 2026-11-03 21:59 UTC · `plugin-settings-placement` PR #289, note (current) · reconciler
- 2026-11-03 22:02 UTC · `plugin-settings-placement` note (current) · foreign-write
- 2026-11-03 22:02 UTC · `git-status-board` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 22:02 UTC · `terminal-drag-chain-tree` s2 done (current) · foreign-write
- 2026-11-03 22:02 UTC · `terminal-tabs-left` added (5 steps) (current) · Janitor Joey (terminal-tabs-left session)
- 2026-11-03 22:02 UTC · `terminal-tabs-left` → running (current) · orchestrator
- 2026-11-03 22:01 UTC · `git-status-board` s3 done (current) · claude-session (Snap Sully)
- 2026-11-03 22:01 UTC · `terminal-drag-chain-tree` s2 done (current) · foreign-write
- 2026-11-03 22:01 UTC · `git-status-board` s4 done (current) · claude-session (Snap Sully)
- 2026-11-03 22:01 UTC · `git-status-board` s5 done (current) · claude-session (Snap Sully)
- 2026-11-03 22:03 UTC · `git-status-board` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 22:03 UTC · `terminal-tabs-left` added (5 steps) (current) · foreign-write
- 2026-11-03 22:03 UTC · `terminal-drag-chain-tree` s3 done (current) · orchestrator
- 2026-11-03 22:03 UTC · `terminal-drag-chain-tree` s4 done (current) · orchestrator
- 2026-11-03 22:08 UTC · `molly-banners` added (5 steps) (current) · foreign-write
- 2026-11-03 22:08 UTC · `terminal-drag-chain-tree` s5 done (current) · orchestrator
- 2026-11-03 22:08 UTC · `terminal-sessions-nav` s4 done, → complete, note (current) · foreign-write
- 2026-11-03 22:08 UTC · `plugin-settings-placement` note (current) · foreign-write
- 2026-11-03 22:08 UTC · `banner-ref-links` s5 done, → complete, note (current) · foreign-write
- 2026-11-03 22:08 UTC · `molly-console-commands` s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, s1 undone, s2 undone, note (current) · foreign-write
- 2026-11-03 22:08 UTC · `git-status-board` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 22:08 UTC · `terminal-drag-chain-tree` added (6 steps) (current) · foreign-write
- 2026-11-03 22:08 UTC · `molly-nav-submenus` added (40 steps) (current) · foreign-write
- 2026-11-03 22:08 UTC · `terminal-tabs-left` added (5 steps) (current) · foreign-write
- 2026-11-03 22:08 UTC · `plugin-settings-placement` branch claude/plugin-settings-placement, PR #289 (current) · builds-live
- 2026-11-03 22:08 UTC · `plugin-settings-placement` s6 done, → built (current) · orchestrator
- 2026-11-03 22:08 UTC · `plugin-settings-placement` note (current) · orchestrator
- 2026-11-03 22:12 UTC · `plugin-settings-placement` s6 done, → complete, note (current) · foreign-write
- 2026-11-03 22:12 UTC · `terminal-drag-chain-tree` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 22:12 UTC · `molly-banners` added (5 steps) (current) · foreign-write
- 2026-11-03 22:12 UTC · `terminal-tabs-left` s1 done (current) · orchestrator
- 2026-11-03 22:12 UTC · `terminal-tabs-left` s2 done (current) · orchestrator
- 2026-11-03 22:12 UTC · `terminal-tabs-left` s3 done (current) · orchestrator
- 2026-11-03 22:04 UTC · `terminal-drag-chain-tree` s3 done, s4 done (current) · foreign-write
- 2026-11-03 22:04 UTC · `molly-banners` added (5 steps) (current) · orchestrator
- 2026-11-03 22:04 UTC · `molly-banners` → running (current) · orchestrator
- 2026-11-03 22:04 UTC · `molly-banners` note (current) · orchestrator
- 2026-11-03 22:04 UTC · `molly-banners` branch claude/molly-banners (current) · builds-live
- 2026-11-03 22:12 UTC · `terminal-drag-chain-tree` s5 done (current) · foreign-write
- 2026-11-03 22:12 UTC · `terminal-tabs-left` s1 done, s2 done, s3 done (current) · foreign-write
- 2026-11-03 22:12 UTC · `molly-banners` s1 done (current) · orchestrator
- 2026-11-03 22:12 UTC · `molly-banners` s4 done (current) · orchestrator
- 2026-11-03 22:14 UTC · `terminal-sessions-nav` s4 done, → complete, note (current) · foreign-write
- 2026-11-03 22:14 UTC · `plugin-settings-placement` s6 done, → complete, note (current) · foreign-write
- 2026-11-03 22:14 UTC · `banner-ref-links` s5 done, → complete, note (current) · foreign-write
- 2026-11-03 22:14 UTC · `molly-console-commands` note (current) · foreign-write
- 2026-11-03 22:14 UTC · `git-status-board` s3 done, s4 done, s5 done (current) · foreign-write
- 2026-11-03 22:14 UTC · `terminal-drag-chain-tree` added (6 steps) (current) · foreign-write
- 2026-11-03 22:14 UTC · `molly-nav-submenus` added (80 steps) (current) · foreign-write
- 2026-11-03 22:14 UTC · `terminal-tabs-left` added (5 steps) (current) · foreign-write
- 2026-11-03 22:14 UTC · `molly-banners` added (5 steps) (current) · foreign-write
- 2026-11-03 22:14 UTC · `whats-new-open-fix` s2 done (current) · orchestrator
- 2026-11-03 22:14 UTC · `whats-new-open-fix` s3 done (current) · orchestrator
- 2026-11-03 22:14 UTC · `whats-new-open-fix` s4 done (current) · orchestrator
- 2026-11-03 22:16 UTC · `whats-new-open-fix` PR #290 (current) · builds-live
- 2026-11-03 22:16 UTC · `whats-new-open-fix` s5 done, → built (current) · orchestrator
- 2026-11-03 22:17 UTC · `whats-new-open-fix` note (current) · orchestrator
- 2026-11-03 22:21 UTC · `git-status-board` PR #291 (current) · builds-live
- 2026-11-03 22:18 UTC · `gizmo-companion` added (19 steps) (current) · orchestrator
- 2026-11-03 22:18 UTC · `gizmo-companion` → running (current) · orchestrator
- 2026-11-03 22:18 UTC · `gizmo-companion` note (current) · orchestrator
- 2026-11-03 22:26 UTC · `gizmo-companion` s1 done (current) · orchestrator
- 2026-11-03 22:27 UTC · `gizmo-companion` s1 done, s2 done (current) · foreign-write
- 2026-11-03 22:26 UTC · `gizmo-companion` s2 done (current) · orchestrator
- 2026-11-03 22:31 UTC · `terminal-tabs-left` note (current) · orchestrator
- 2026-11-03 22:31 UTC · `terminal-drag-chain-tree` note (current) · orchestrator
- 2026-11-03 22:41 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 22:39 UTC · `terminal-drag-chain-tree` PR #292 (current) · builds-live
- 2026-11-03 22:50 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 22:50 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 22:50 UTC · `gizmo-companion` added (19 steps) (current) · foreign-write
- 2026-11-03 22:51 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 22:54 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 22:54 UTC · `urgent-main-ci-green` merged, note (current) · reconciler
- 2026-11-03 22:54 UTC · `terminal-tabs-left` PR #293, note (current) · reconciler
- 2026-11-03 22:54 UTC · `urgent-main-ci-green` note (current) · foreign-write
- 2026-11-03 22:54 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 22:55 UTC · `plugin-lazy-load` added (3 steps) (current) · orchestrator
- 2026-11-03 22:55 UTC · `urgent-main-ci-green` note (current) · foreign-write
- 2026-11-03 22:55 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 22:55 UTC · `lenny-land-all` added (7 steps) (current) · orchestrator
- 2026-11-03 22:56 UTC · `urgent-main-ci-green` note (current) · foreign-write
- 2026-11-03 22:56 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 22:39 UTC · `whats-new-open-fix` s2 done, s3 done, s4 done, s5 done, → complete, note (current) · foreign-write
- 2026-11-03 22:39 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 22:39 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 22:39 UTC · `molly-banners` s1 done, s4 done (current) · foreign-write
- 2026-11-03 22:39 UTC · `gizmo-companion` added (19 steps) (current) · foreign-write
- 2026-11-03 22:39 UTC · `terminal-tabs-left` note (current) · orchestrator
- 2026-11-03 22:41 UTC · `terminal-drag-chain-tree` note (current) · orchestrator
- 2026-11-03 22:48 UTC · `terminal-tabs-left` PR #293 (current) · builds-live
- 2026-11-03 23:03 UTC · `lenny-land-all` added (7 steps) (current) · orchestrator
- 2026-11-03 23:04 UTC · `lenny-land-all` → running (current) · orchestrator
- 2026-11-03 23:11 UTC · `urgent-main-ci-green` note (current) · foreign-write
- 2026-11-03 23:11 UTC · `whats-new-open-fix` s2 done, s3 done, s4 done, s5 done, → complete, note (current) · foreign-write
- 2026-11-03 23:11 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 23:11 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 23:11 UTC · `gizmo-companion` added (19 steps) (current) · foreign-write
- 2026-11-03 23:11 UTC · `plugin-lazy-load` added (3 steps) (current) · foreign-write
- 2026-11-03 23:11 UTC · `lenny-land-all` added (7 steps) (current) · foreign-write
- 2026-11-03 23:12 UTC · `molly-banners` s2 done (current) · foreign-write
- 2026-11-03 23:12 UTC · `lenny-land-all` → running (current) · foreign-write
- 2026-11-03 23:12 UTC · `lenny-land-all` → running (current) · foreign-write
- 2026-11-03 23:13 UTC · `molly-banners` s2 done, s3 done (current) · foreign-write
- 2026-11-03 23:20 UTC · `molly-banners` s2 done, s3 done (current) · foreign-write
- 2026-11-03 23:23 UTC · `gizmo-companion` s3 done, s4 done (current) · foreign-write
- 2026-11-03 23:23 UTC · `molly-banners` PR #294, note (current) · reconciler
- 2026-11-03 23:23 UTC · `gizmo-companion` branch claude/gizmo-companion, note (current) · reconciler
- 2026-11-03 23:11 UTC · `molly-banners` s2 done (current) · orchestrator
- 2026-11-03 23:12 UTC · `molly-banners` s3 done (current) · orchestrator
- 2026-11-03 23:18 UTC · `molly-banners` PR #294 (current) · builds-live
- 2026-11-03 23:26 UTC · `gizmo-companion` s3 done, s4 done, s5 done, s6 done, s7 done (current) · foreign-write
- 2026-11-03 23:26 UTC · `molly-nav-submenus` branch claude/molly-nav-submenus, PR #295 (current) · builds-live
- 2026-11-03 23:25 UTC · `molly-banners` PR #294, note (current) · foreign-write
- 2026-11-03 23:25 UTC · `gizmo-companion` s3 done, s4 done, s5 done, s6 done, branch claude/gizmo-companion, note (current) · foreign-write
- 2026-11-03 23:26 UTC · `gizmo-companion` s7 done (current) · foreign-write
- 2026-11-03 23:20 UTC · `urgent-main-ci-green` note (current) · foreign-write
- 2026-11-03 23:20 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 23:20 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 23:20 UTC · `plugin-lazy-load` added (3 steps) (current) · foreign-write
- 2026-11-03 23:20 UTC · `lenny-land-all` added (7 steps) (current) · foreign-write
- 2026-11-03 23:21 UTC · `gizmo-companion` s3 done (current) · orchestrator
- 2026-11-03 23:22 UTC · `gizmo-companion` s4 done (current) · orchestrator
- 2026-11-03 23:23 UTC · `gizmo-companion` s5 done (current) · orchestrator
- 2026-11-03 23:24 UTC · `gizmo-companion` s6 done (current) · orchestrator
- 2026-11-03 23:25 UTC · `gizmo-companion` s7 done (current) · orchestrator
- 2026-11-03 23:26 UTC · `gizmo-companion` s8 done (current) · orchestrator
- 2026-11-03 23:27 UTC · `molly-banners` note (current) · foreign-write
- 2026-11-03 23:28 UTC · `gizmo-companion` s14 done (current) · orchestrator
- 2026-11-03 23:36 UTC · `gizmo-companion` PR #296, note (current) · reconciler
- 2026-11-03 23:27 UTC · `molly-nav-submenus` s1 done, → running (current) · orchestrator
- 2026-11-03 23:28 UTC · `gizmo-companion` s8 done (current) · foreign-write
- 2026-11-03 23:28 UTC · `gizmo-companion` s14 done (current) · foreign-write
- 2026-11-03 23:29 UTC · `molly-nav-submenus` s2 done (current) · orchestrator
- 2026-11-03 23:30 UTC · `molly-nav-submenus` s3 done (current) · orchestrator
- 2026-11-03 23:31 UTC · `molly-nav-submenus` s4 done (current) · orchestrator
- 2026-11-03 23:32 UTC · `gizmo-companion` s15 done, s18 done (current) · foreign-write
- 2026-11-03 23:43 UTC · `molly-nav-submenus` s1 done, s2 done, s3 done (current) · foreign-write
- 2026-11-03 23:32 UTC · `molly-nav-submenus` note (current) · orchestrator
- 2026-11-03 23:41 UTC · `gizmo-companion` s15 undone, s18 undone, note (current) · foreign-write
- 2026-11-03 23:49 UTC · `urgent-main-ci-green` note (current) · foreign-write
- 2026-11-03 23:49 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 23:49 UTC · `molly-nav-submenus` s1 done, s2 done, s3 done, s4 done, note (current) · foreign-write
- 2026-11-03 23:49 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 23:49 UTC · `molly-banners` s2 done, s3 done, note (current) · foreign-write
- 2026-11-03 23:49 UTC · `gizmo-companion` s3 done, s4 done, s5 done, s6 done, s7 done, s8 done, s14 done, note (current) · foreign-write
- 2026-11-03 23:49 UTC · `plugin-lazy-load` added (9 steps) (current) · foreign-write
- 2026-11-03 23:49 UTC · `lenny-land-all` added (7 steps) (current) · foreign-write
- 2026-11-03 23:52 UTC · `urgent-main-ci-green` note (current) · foreign-write
- 2026-11-03 23:52 UTC · `terminal-drag-chain-tree` note (current) · foreign-write
- 2026-11-03 23:52 UTC · `molly-nav-submenus` s1 done, s2 done, s3 done, s4 done, note (current) · foreign-write
- 2026-11-03 23:52 UTC · `terminal-tabs-left` note (current) · foreign-write
- 2026-11-03 23:52 UTC · `molly-banners` s2 done, s3 done, note (current) · foreign-write
- 2026-11-03 23:52 UTC · `gizmo-companion` s3 done, s4 done, s5 done, s6 done, s7 done, s8 done, s14 done, note (current) · foreign-write
- 2026-11-03 23:52 UTC · `plugin-lazy-load` added (9 steps) (current) · foreign-write
- 2026-11-03 23:52 UTC · `lenny-land-all` added (7 steps) (current) · foreign-write
- 2026-11-03 23:52 UTC · `terminal-drag-chain-tree` s6 done, → complete (current) · orchestrator
- 2026-11-03 23:53 UTC · `terminal-drag-chain-tree` → built (current) · orchestrator
- 2026-11-03 23:53 UTC · `terminal-drag-chain-tree` → running, note (current) · orchestrator
- 2026-11-03 23:54 UTC · `molly-nav-submenus` s5 done, → complete (current) · foreign-write
- 2026-11-03 23:54 UTC · `terminal-drag-chain-tree` s6 done, → built (current) · orchestrator
- 2026-11-03 23:55 UTC · `terminal-drag-chain-tree` → built (current) · orchestrator
- 2026-11-03 23:54 UTC · `terminal-drag-chain-tree` → complete (current) · foreign-write
- 2026-11-03 23:54 UTC · `molly-nav-submenus` s1 done, s2 done, s3 done, s4 done, note (current) · foreign-write
- 2026-11-03 23:54 UTC · `molly-banners` note (current) · foreign-write
- 2026-11-03 23:54 UTC · `gizmo-companion` s3 done, s4 done, s5 done, s6 done, s7 done, s8 done, s14 done, note (current) · foreign-write
- 2026-11-03 23:49 UTC · `molly-nav-submenus` note (current) · foreign-write
- 2026-11-03 23:54 UTC · `terminal-drag-chain-tree` → running, note (current) · foreign-write
- 2026-11-03 23:54 UTC · `molly-nav-submenus` s5 done, → complete (current) · orchestrator
- 2026-11-03 23:58 UTC · `terminal-drag-chain-tree` s6 done (current) · orchestrator
- 2026-11-04 00:10 UTC · `terminal-drag-chain-tree` → complete, note (current) · foreign-write
- 2026-11-04 00:10 UTC · `molly-nav-submenus` s1 done, s2 done, s3 done, s4 done, s5 done, → complete, note (current) · foreign-write
- 2026-11-04 00:10 UTC · `gizmo-companion` s3 done, s4 done, s5 done, s6 done, s7 done, s8 done, s14 done, note (current) · foreign-write
