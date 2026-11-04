# Report: handoff-2 (Session sync — two Claude sessions side by side; the old handoff system deleted)

Fable, agent Rio React, branch `claude/handoff-2`, Nov 4 2026. Brett's words are on the build (`origin.said`); addenda
1–16 were in the launch brief.

## What was built

**Spec + contracts (framework, Fable):** `framework/spec/HANDOFF.md` — `handoff@1` (the sync file) and
`session-link@1` (the live link: sessions, primary / secondary, claims, offers, assignments, events, stats, settings,
the role gate, the orchestrator's reactions, replan, dedupe, live push, safety). Engine `framework/core/engines/handoff.mjs`
(pure, no IO, zero tokens), registry snapshot `framework/schemas/handoff.json`, fixture `framework/spec/fixtures/handoff.json`,
check `framework/spec/check-handoff.mjs` (132 checks: the gate, two sessions racing for one area, claim overlap /
renewal / expiry, offers → accept → steps → done, reject / hold / release / blocked reactions, take-back + undo,
replan with pins, dedupe, slot split, session + helper status, the sync file round trip with redaction, channel lines,
events with resume).

**Plugin `apps/console-web/plugins/session-sync` (plugin@1, `forFramework: true`, targets console, Molly, AmberX, axHub web):**
- **CLI `sync.mjs`:** `sync` (writes `_claude/sync/<project>.{json,md}` and publishes it to main as a status-only
  commit through `builds-live.mjs publishFiles`), `join`, `status`, `snapshot`, `heartbeat`, `claim`, `release`, `send`,
  `inbox`, `request-work`, `offer`, `offers`, `respond`, `step`, `take-back`, `undo`, `replan`, `claim-job`, `end`,
  `approve-account`, `settings`, `make-primary`, `consistency [--fix]`, `check-commit [--ci]`, `hook`, `hooks install`,
  `events`, `op` (the server's path). One link file, one lock, journal + audit.
- **`/sync` command** (`commands/sync.md`, installed into `.claude/commands/` and `~/.claude/commands/` by the
  plugin installer) and one CLAUDE.md line: on start, if `_claude/sync/` exists, read it.
- **Claude Code hook** (`UserPromptSubmit`, `PreToolUse`, `SessionStart`, `SessionEnd`): joins on start, delivers
  unread channel lines, claim changes and offers at every step (no polling), heartbeats, and **blocks an edit outside
  the session's claims** naming the holder (only while another session is live). `check-commit` does the same for
  commits (pre-commit and CI, `--ci` reads the sync file).
- **Server part:** every command on REST / MCP (`session_sync_<command>`) / CLI through plugin-commands@1; who is
  calling from `X-Axf-Session` / `X-Axf-Account` / `X-Axf-Agent` headers or Brett's own signed-in click; the role gate
  enforced server-side (403 "secondary sessions can't do that", audited); a new account's first join files one axHub
  approval (`axf.session_sync_approve_account`) and a bell alert, Brett's click approves too; `GET /events` SSE with
  resume (`id:` = seq, `event:` = type, `gap`); the server watches the link file so CLI / hook writes push too; it is
  the only Breakroom poster (one channel line per event through `axf.crew@1.post`); capability `axf.session-sync@1`;
  health@1 row `session-sync` with Auto fix (the consistency check).
- **Breakroom (agent-swarm):** the group chat got a `sessions` channel (swarm-chat@1 message `channel`), kinds
  `session` / `handover` / `claim`, a **Sessions** filter in the chat, Brett's box posts into it, and `post()` /
  `messages()` on `axf.crew@1`. Sessions lines are kept even when the room is off (they are work records).
- **Web:** Builds → **Sessions** panel (roster with agent avatars and status, claims with claim / release, offers and
  assigned work with accept / reject / hold / release / take back / send, helper stats, the Sessions channel with
  all / handovers / blockers / my steps filters, live dot, Sync session, What's going on?, Request work, Re-plan
  preview, End pairing); the **join dialog** (actively working on with progress and model, done today with report
  links, needs attention incl. red health items, what to jump into with multi-select **Add to my list**, agent-cap
  split, Managed by orchestrator); **Send to helper** dialog (whole build / just these steps as a new build, pick the
  helper, remember the choice); **Add widgets…** picker (any widget asset onto the banner, the toolbar or any open
  window's title bar, saved and re-attached); settings tab (enforce, timings, approvals, widget placement, send
  default, hook instructions, consistency); the **Sessions chip**; one **helper-status widget per helper** (framework
  `counter` widget: dim / solid / animated working / coffee on lunch, tooltip, tap opens the panel); **Managed by
  orchestrator** chip replacing the build-profile chip on a helper's console; right-click **Send to helper** on every
  build reference (`axf-build`, orchestrator cards, pending items, ref links, chat lines) and on every step
  (`axf-step`: as a new build / with its current build / take back); **Add widgets…** on every window title bar.
- **Framework (shared, so every list gets it):** `core/assignments.ts` (assignment directory) + `HelperBadge`
  (avatar + animated icon + "Paulie (helper) · step 3/5" / "In Paulie's queue (#2)" / held / blocked / rejected,
  tooltip with account, session, time); `MultiSelect.tsx` (`useMultiSelect`, `SelectBox`, `SelectionBar`: click /
  Ctrl+click / Shift+click, Ctrl reveals checkboxes, a tick keeps them, Esc clears, long-press on touch, a toolbar
  selection bar); window title bars as widget hosts (`window:<id>`, `ensureWindowHost`, drawn by `WindowHost`);
  builds-store fields `assignedTo`, `withHelper`, `touches`, `parent`, `pinned`, `after` (only present when set);
  `builds-live.mjs publishFiles()`. Wired into the Build orchestrator (badges on cards and steps, step multi-select
  with Send to helper / Send the whole build) and the Builds page (badges on rows and steps, step context target).
- **One handover transaction:** every accept / reject / hold / release / take-back / step done updates the link, the
  builds store (`assignedTo` on build and steps, child build with `parent` for steps handed over as a new build,
  `withHelper` on the parent's steps), the orchestrator exports, the claims, the chat, and pushes one event;
  `consistency --fix` (CI-able, systems check Auto fix) keeps them equal.

**The old handoff system is deleted** (addendum 2, same PR, write paths made no-ops first then removed): see the
list below. `framework/spec/check-no-threads.mjs` fails CI on any reference (history — reports, journals, the store
and its exports, change-log and session archives, STATUS.md — is not scanned).

## Removed (addendum 2)

Files: `_claude/THREADS.md`; `_claude/handoff/` (ACTIVE-THREADS.md, CLAUDE-AI.md, FILES.md, HANDOFF.md,
INSTRUCTIONS.md, PROJECT.md, PROMPT.md, README.md, SECRETS.md, SETUP.md, USER-SCOPE.md, context/, handoff.json,
sources/, user/); `_claude/shared/notes/handoffs/` (handoff-2026-11-01/02/03.md, kickoff-prompt-other-account-2026-11-01.md);
`_claude/memory/handoff-2026-11-01.md`, `_claude/memory/handoff-2026-11-02.md`; `_claude/fuck-you.md` (the old kickoff
prompt); `apps/console-web/plugins/claude-handoff/` (the whole plugin: handoff.mjs, handoff-core.mjs, server, web,
tests, help); `apps/axhub-web/src/views/Handoff.tsx` + its routes, nav entry, actions and tests (`hub/core.ts`
handoff section: session picker, gauges, bash command).

References removed or re-pointed at the sync file: `CLAUDE.md` (the "Threads and builds" paragraph → Session sync;
builds-live line), `_claude/rules/RULES.md` (the "Threads log in the repo" and "Unfinished work can be carried on"
rules → one Session sync rule), `_claude/shared/rules/RULES.md` ("Load the rules and threads first", "One chat per
task"; new shared rule "Two sessions side by side"), `_claude/builds/README.md`, `_claude/builds/help-src/console.py`,
`_claude/memory/decisions.md` (+ the decision), `_claude/shared/notes/INDEX.md`, `_claude/shared/memory/naming.md`,
`_claude/memory/docs/plan-studio/README.md`, `install_instructions.md` (§10 → the sync file, §11 → working from a
second account), `install_steps.md`, `.gitattributes` (THREADS merge driver), `framework/cli/builds-live.mjs` (no
THREADS live log; `publishFiles` added), `framework/spec/check-builds-live.mjs`, `framework/cli/plugin-lifecycle.mjs`
(handoff kit / note exclusions), `framework/core/engines/swarm-rules.mjs` (shared files) + `framework/schemas/swarm.json`
+ fixtures, `framework/spec/check-swarm.mts`, `framework/spec/check-headless-tabs.mts`, `framework/spec/check-ui-predict.mjs`,
`framework/spec/CONTROL.md`, `framework/spec/DESIGN-LANGUAGE.md`, `framework/spec/check-design-package.mts`,
`framework/spec/check-ashes.mts` + `framework/libs/ashes/core.ts` (test names), `framework/assets/job-type/feature-build.json`
+ `land-build.json`, `apps/console-web/plugins/README.md`, `apps/console-web/src/lazyEngine.ts`,
`apps/console-web/src/assets/context-menu/amber.json`, `apps/console-web/src/assets/help/console.json`,
`apps/console-web/plugins/*/plugin.json` (20 `lifecycle.mentions` lists), `apps/console-web/plugins/token-control/lib/pass.mjs`
(the THREADS "Token passes (log)" writer; the audit is the log) + its test + plugin.json env,
`apps/console-web/plugins/push-banner/land/land-core.mjs` + `land.mjs` + `land.test.mjs` + `test.py`,
`apps/console-web/plugins/build-orchestrator/server/__init__.py` (health texts), `apps/console-web/plugins/agent-swarm/`
(swarm.mjs context list, swarm-core prompt, README, skills docs / feature-build / landing, test.mjs),
`apps/console-web/plugins/agent-manager/addons/{gizmo,molly}/addon.json`, `apps/console-web/plugins/claude-settings/registry.json`
(`memory.handoffNote` description), `apps/console-web/plugins/md-studio/web/model.ts` (the Threads log template) + test,
`apps/console-web/plugins/console-terminal/test.py`, `apps/console-web/plugins/whats-shipped/test.py`,
`apps/amberx-droid/src/plugins/commands/web/lib-developer.ts` (voice commands), `apps/axhub-web/src/views/GoPass.tsx`,
the baked `src/axf` copies (console-web re-baked; the other apps' swarm-rules / swarm-chat / swarm.json / ashes copies refreshed).

## Tests and checks

- `node framework/spec/check-handoff.mjs` 132 / 132 · `node framework/spec/check-no-threads.mjs` 0 references in 9080 files
- `node apps/console-web/plugins/session-sync/test.mjs` 46 / 46 (CLI: two sessions racing, approval, offers, child
  build, steps, inbox, take-back, sync file, consistency, commit check, hook block / pass / context, hooks install)
- `python3 apps/console-web/plugins/session-sync/test.py` 33 / 33 (routes with the real Agent swarm on scratch data
  and a fake axHub: identity, 403 + audit, approval round trip, Breakroom lines as the agents, filters, SSE replay,
  owner-only settings, consistency, capability)
- Re-run after the deletion: check-builds-live 46, check-swarm 232, agent-swarm 100, auto-land 87, push-banner 167,
  token-control 20, md-studio, console-terminal 139, whats-shipped 47, headless-tabs 63, ui-predict 12, ashes 53,
  design-package 1157, axhub-web 230, builds-store 37, plugin catalog 55, plugin commands 57 (60 plugins, 909
  commands), check-theme, check-controls, check-toolbars, check-plugin-pages, menu-reach, help coverage (ratchet
  kept; four pre-existing controls in other plugins got help), plugin lifecycle for every plugin, console `tsc --noEmit`.
- The plugin's server part loads in `main.PLUGINS` (`server: loaded`).
- CI: `check-handoff.mjs`, `check-no-threads.mjs`, the plugin's `test.mjs`, `check-commit --ci` added to
  `.github/workflows/android.yml`; `test.py` runs through the existing plugin Python glob.

## Decisions taken (said straight)

- **MCP tool names** are `session_sync_<command>` (plugin-commands@1 names every plugin's tools that way), not the
  bare `session.send` / `session.claim` the brief wrote; same commands, one registry.
- **No new widget asset type** for the helper icon: the Kotlin kernel keeps its own `AssetTypes.kt`, so a new type
  would break the frozen Android build. The helper widget is the framework's `counter` widget (icon + label + tone)
  per helper, animated by the plugin's CSS (reduced motion respected); it attaches to the banner, the toolbar and
  any window title bar (new host).
- **No build profile for helpers** (addendum 9 over 4 / 6): a helper's work is assignments on the primary's
  orchestrator; its console shows *Managed by orchestrator*; its lists are scoped (`scopedBuilds`).
- **Claims are enforced only while a second session is live** (a lone session is never nagged); `enforce: false`
  or the plugin off = unrestricted with a visible warning (hook line, chip tone, systems check).
- **The Session sync lines stay in the Breakroom even when the room is off**: they are work records, not banter.
- The sync file goes to main as a status-only commit (`publishFiles`, like the builds store) — the one exception rule
  now covers both.
- `.claude/commands/sync.md` is written by the plugin installer (the sandbox refused a direct write); it is committed.

## Not done / gaps

- **Screenshots:** `_claude/builds/reports/handoff-2/shots/after/` (Sessions panel, join dialog, Send to helper, Add
  widgets, settings; desktop + phone) from the built console with a mocked API (two sessions linked, one helper
  working, one offer open, one account waiting for approval), submitted to UI Review (group `handoff-2 - Nov 4 …`,
  non-blocking per the brief).
- **Live push into other screens:** the plugin's own screens, badges and widget patch at once; the console's other
  per-screen pollers (urgent-console-perf's shared cache) were not replaced — `GET /events` is the one stream to
  subscribe them to.
- **Profile switcher text inside other plugins' screens:** the banner chip says *Managed by orchestrator* on a
  helper console; the Build manager / Builds page profile labels still show the profile name (they read the
  runtime setting `axf.session.managedBy` if they want it).
- **Orchestrator re-split of a running build into finer steps** is the offer of undone, dependency-free steps as a
  child build; it does not invent new sub-steps.
- **Vinnie-side policy** for `axf.session_sync_approve_account` (confirm policy) must be set on axHub (axHub repo),
  like `axf.claude_session_answer`.
- claude-sync holds 98 files (changed on both sides before this build); the hub copies of the rules still carry the
  old text until Brett resolves them (`claude-sync status`).
