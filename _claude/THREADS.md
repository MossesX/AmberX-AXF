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
| Console banner overlap fix: attached widgets snap, never overlap (all web apps) | done | `fix/banner-snap` | [#149](https://github.com/MossesX/AmberX-AXF/pull/149) merged | Merged Oct 28; the 5-minute update redeploys the console | 2026-10-28 |
| Push notifications from the AmberX Android app (replaces AXHub app) | queued | – | – | Rule saved Oct 28; wiring axHub push → AmberX is its own thread (ask profile, add to orchestrator) | 2026-10-28 |
| AmberX voice notes, lists, tasks + AI router (amberx.amberxai.com) | done | `claude/amberx-notes` | [#144](https://github.com/MossesX/AmberX-AXF/pull/144) merged | Live Oct 28 02:34 UTC (FastAPI server answering, wall-signed only). Left for Brett: add an AI provider in Settings → Plugins → AI connection | 2026-10-28 |
| AmberX look fix + Lock the look + Get the look from axHub switches | review | `claude/amberx-appearance-lock` | #126 | Merge after CI; the 5-minute update redeploys amberx.amberxai.com | 2026-10-27 |
| AmberX hands-free listening + ActiveX-style detection overlay (level graph, dB, quick settings) | review | `claude/amberx-handsfree` | #141 | Orchestrator build `amberx-handsfree` (refactor, Opus): s1–s3 done, CI is the first Java compile; then merge approval | 2026-10-27 |
| Merge approvals: ready PRs go to Brett as an axHub approval; Approve on the first screen of the approval page | merged | `claude/merge-approvals` | #131 | Merge through its own merge approval once CI passes | 2026-10-27 |
| Empty banner strip stays after the last banner item is removed (fix) | review | `fix/banner-strip-collapse` | #133 | Merge after CI; the 5-minute update redeploys the console | 2026-10-27 |
| Build profiles + Build profiles plugin (Main framework, Refactor) | review | `claude/build-profiles` | see GitHub | Merge after CI; then the console shows the profile chip. Refactor is the saved pick; today's refactor/upgrade work imported into it (pending: arch-foundation, enterprise-branding, interface-roller, design-package-fable, apply-all-levels-fable + 5 done; orchestrator: arch-foundation, enterprise-branding, interface-roller, design-package). Main keeps its copies with a note | 2026-10-27 |
| Slim CLAUDE.md: Status moved to `_claude/memory/STATUS.md` (CLAUDE.md 250K → 13K chars) | merged (#125) | `claude/move-status-out-of-claude-md` | #125 | New status lines go in STATUS.md; plugin lifecycle `mentions` include it | 2026-10-27 |
| Build orchestrator plugin + repo build tracker | merged (#122) and live; holds 4 builds, the other open lists not imported yet | 2026-10-27 |
| 10 more design packages (Midnight Pro, Terminal Lime, Ember Studio, Sage Reader, Coral Play, Neon Night, Arctic Calm, Fresh Night, Quiet Focus, Ink Terminal) | merged (#124), live | 2026-10-27 |
| AmberX Design Package + Behaviour theme (replaces Appearance package) | merged in #124 (carries #123), live on console, axHub web, Patches web, AmberX; Fable rebuild parked (`design-package-fable`) | 2026-10-27 |
| Fresh look: new default style theme + `fresh` appearance package | review | `claude/fresh-look` | #119 | Merge after CI, then apply `fresh` on axHub | 2026-10-27 |
| Enterprise design + branding engine (AmberX app + GizmoX console refactor, 700+ brand assets; includes Design Package) | in progress | `opus/enterprise-branding` | [#138](https://github.com/MossesX/AmberX-AXF/pull/138) | Orchestrator build `enterprise-branding` (46 steps, 33 done): Fable phase 1 merged (#128); **Opus phase 2 done Oct 27** (s13–s26: asset library, style-package@1, brand library). Opus phase 2 **merged (#138)**. Next: phase 3 s27–s40 (Brand library plugin, GizmoX/AmberX refactor, ship). See *To carry on* | 2026-10-27 |
| Architecture foundation (attachment: contracts, Pydantic migrator, plugin boundary, lifecycle broker, docs) | queued | – | – | Orchestrator build `arch-foundation`: Fable s1-s7 → Opus s8-s12 | 2026-10-27 |
| Three interfaces in GizmoX tabs + interface roller for every app | in progress | `opus/interface-roller` (stacked on `opus/enterprise-branding`) | [#139](https://github.com/MossesX/AmberX-AXF/pull/139) | Orchestrator build `interface-roller` (15 steps, 10 done): Fable phase 1 merged (#129); **Opus phase 2 done Oct 27** (s6–s10: GizmoX Night + AmberX Signature interfaces, console tabs Main · GizmoX Night · AmberX Signature). Next: phase 3 s11–s14 (roller plugin, lib-interface-roller, install in every web app). See *To carry on* | 2026-10-27 |
| Build orchestrator: Builds grid like Pending builds, step subgrids | PR open | `opus/orchestrator-grid` | – | Grid view = framework DataGrid grouped by category (Build + one-line summary, Status, Next, Steps, Time, Cost, Added; Left hideable); each row expands to a steps subgrid per phase (tick, model chip, group, time, cost, move/remove, approve switch) + the build card actions | 2026-10-27 |
| Pending builds grid view (attachment) | queued | – | – | Orchestrator build `pending-grid-view`: Opus only, 6 steps | 2026-10-27 |
| AmberX Design Package (Fable rebuild of the Opus build) | queued | – | – | Folded into orchestrator build `enterprise-branding` phase 1, group *Design package (Fable rebuild)* (s5r1-s5r6) | 2026-10-27 |
| Connections plugin (every connected app, 7 layouts) | queued | – | – | Asked Oct 26, never started. See *To carry on* | 2026-10-26 |
| Separate Console and Patches asset visibility | blocked | `claude/project-thread-k6ckjv` | #94 | Needs Brett's answer in the thread | 2026-10-25 |
| Fix git merge conflicts | blocked | – | – | Needs Brett's answer in the thread | 2026-10-25 |
| Add icon picker dialog for status plugins | blocked | – | – | Needs Brett's answer in the thread | 2026-10-25 |
| Add Push banner action log | on hold | – | – | Held by Brett | 2026-10-25 |
| Store project rules in repo | queued | – | – | Rules file `_claude/rules/PROJECT-RULES.md` | 2026-10-25 |


## To carry on

Paste the *First message* into a new chat on any account (claude.ai/code on MossesX/AmberX-AXF, or Claude Code on the
VPS). The session reads the rules and this file first, as usual.

### AmberX voice notes, lists, tasks + AI router
- **Asked (Brett, Oct 27 2026, 20:26, with an attachment):** a voice-controlled notes app in AmberX (amberx.amberxai.com): notes in lists with categories and sub-lists for software development; each plugin gets its own list under Plugins when it loads; take, sort, transcribe, organize, rename notes and move them between lists; task manager + todo list; AI for real-time parsing of voice into notes, summaries and storing them in the right place, with a steady connection to Claude (subscription or API, with a switch) and any mainstream LLM; an integrated web component; a section to configure voice commands with predefined commands from the codebase; tabs/containers for the different parts.
- **Decided (cards):** AI runs on AmberX's own server behind the axHub wall (keys server-side, framework assistant_host providers); notes shared on axHub with the console Voice notes + Voice Vault (`voice-notes/` read-only, AmberX writes `amberx-notes/`); start phase A now, sub-agents allowed.
- **Plan:** orchestrator build `amberx-notes` (also pending `amberx-notes`), 15 Opus steps. Core `apps/amberx-droid/src/plugins/notes/web/core.ts` + `store.ts`, AI client contract `src/plugins/ai/web/client.ts`. Plugins: notes, tasks, dictation, voice (extended), ai (+ `apps/amberx-droid/server/`), web.
- **Done:** s1-s14 on `claude/amberx-notes`, PR #144 (test.mjs 459, server 110). Design-language §12 pass on the new pages (Brett's card: console Voice notes plugin stays with the refactor phase).
- **Left (s15):** merge #144 once CI is green; deploy: `sudo bash /opt/amberx-web/apps/amberx-droid/deploy/install.sh` via axHub `vps.run` (approval); then add an AI provider in Settings → Plugins → AI connection; check the pages on the phone.
- **First message:** "Carry on orchestrator build `amberx-notes` on branch `claude/amberx-notes` (`orchestrator.mjs brief amberx-notes`); merge any `claude/amberx-notes-*` branches first."
### Build profiles + plugin
- Asked (Brett, Oct 27 2026): "Create multiple build profiles and a console plugin to select and save one. Each build profile holds plans, build queue, pending builds, tracking, and all work stuff. Name current one main framework and then start new one called refactor."
- Model Opus. Branch `claude/build-profiles`, all 4 orchestrator steps done (orchestrator build `build-profiles`, pending `build-profiles`).
- Left: CI green → merge → console redeploys itself. Checks: `python3 apps/console-web/server/test_build_profiles.py`, `node framework/cli/profiles.mjs`.
- First message: "Carry on thread Build profiles: check PR for branch claude/build-profiles, merge when CI is green, then confirm the console shows the profile chip."

### Build orchestrator (how every build below is carried on)
- Tracker: `_claude/builds/orchestrator.json` (orchestrator@1; how-to `_claude/builds/README.md`). `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs next` says what to do; `brief <id>` gives the current phase only. At a Fable ↔ Opus switch, stop and ask Brett (card), then `act approve <id> <phase>`. <!-- axf-plugin:build-orchestrator -->
- **First message (any build):** "Run `orchestrator.mjs next` and continue that build from `_claude/builds/orchestrator.json` on the model its next phase names."

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
- **First message (Opus):** "Run `orchestrator.mjs brief interface-roller` and continue phase 3 on Opus from branch `opus/interface-roller` (after #138 and its PR merge, from main)."

### Architecture foundation
- **Asked (Brett, Oct 27 2026, attachment):** the 5 deliverables (TS contracts for layout tree / theme / plugin manifest; Pydantic v2 models + before-validator migrator + ingestion namespacing; React error boundary + pub/sub lifecycle broker; project spec; developer docs: new plugin, harvesting, live sync). Built on the existing asset@1 / plugin@1 / appearance@1 contracts; CLAUDE.md stays the project spec (no second .claude.md). Steps: orchestrator build `arch-foundation` (also pending `arch-foundation`).
- **First message:** "Continue orchestrator build `arch-foundation` (`orchestrator.mjs brief arch-foundation`). Run on Fable."

### Pending builds grid view
- **Asked (Brett, Oct 27 2026, attachment):** grid next to Reload in Pending builds: 1-line summary, date added, total time estimate, cost estimate, sortable columns; rows expand to today's card; toolbar archive / delete / hide / unhide (greyed when none selected) / open in (tooltip dialog: Build manager, Build queue, Plan); select hook: hover tooltip "activate multi select with double click", double-click flashes the top item's hover style 3 times, tooltip "select items", then single clicks select more. Steps: orchestrator build `pending-grid-view` (Opus only).
- **First message:** "Continue orchestrator build `pending-grid-view` (`orchestrator.mjs brief pending-grid-view`). Run on Opus."

### Enterprise design + branding engine
- **Asked (Brett, Oct 27 2026, orchestrator chat):** "Only refactor Amberx, the app at amberx.amberxai.com. Refactor console and the active plugins switched on only plus all the banner plugins. Make the framework and app really really nice professional enterprise level quality … must not look amateur. Needs ten light 10 dark themes 10 layout themes 10 style themes, 10 context menu assets, 25 dynamically driven toolbar assets with documentation, 25 style package assets, 25 amberx design packages. 25 navigation menus and behavior. Pepper the app, windows, dialogs, banners, toolbars, and containers with logos, animated logos, icons from a branding package which is new asset type that contains an extendable and scalable template of UI assets for full rebranding of the entire package. Create 250 logos, 250 animated logos, 100 icon packs which are a new asset type, create console plugin to browse them. All to be generated for the AmberX Framework. GizmoX development console. Make custom branded banners, toolbars, windows, containers, tab groups, dialogs, floating windows, etc. Create an entirely hot swappable branding package and branding engine."
- **Plan:** orchestrator build `enterprise-branding` (40 steps; also pending `enterprise-branding`). Includes the Design Package build (archived in the orchestrator). Branch `fable/enterprise-branding`. Web only; Android twins deferred.
- **Decided (cards, Oct 27 2026):** the Dev Console is renamed **GizmoX** in everything visible (banner, title, menus) through its branding package, with code ids and URLs unchanged; logos and animated logos are made for both **AmberX Framework** and **GizmoX**; plugins in scope (Brett, 13:05) = only the plugins currently installed and switched on in Plugin switches, plus every banner plugin (s1 reads that list live through axHub).
- **Done (Fable, Oct 27 2026, PR #128):** s1 `framework/spec/DESIGN-LANGUAGE.md` (+ live plugin scope §13: all 32 plugins), s5r1–s5r6 design-package Fable pass (window placement rules, busy cursor + confirm-delete on buttons), s6–s9 brand types `logo-mark` / `animated-logo` / `icon-pack` / `branding` + `core/engines/brand.ts` + starters, s10–s11 React layer (banner, toolbar, tab group, windows, dialogs, containers, Icon), s12 generators (`framework/cli/brand-gen.mjs` over `core/engines/brandgen.mjs`) + `check-design-language.mts`. Checks: check-brand 88, check-design-language 183, check-design-package 575.
- **Left (Opus s13–s40):** the asset library (10 light + 10 dark colour themes, 10 layouts, 10 style themes, 10 context menus, 25 toolbars with docs, 25 style packages, 14 more design packages, 25 nav menus; 250 logos, 250 animated logos, 100 icon packs through the generators), Brand library plugin, Settings picker polish, GizmoX console + AmberX app refactor (branding packages applied, every in-scope plugin held to the design language), re-bakes, shots, differences report.
- **Done (Opus, Oct 27 2026, branch `opus/enterprise-branding`):** s13–s26 through `framework/cli/asset-library.mjs` (seeded, `--check` in CI): 20 colour themes, 10 layouts, 10 style themes, 10 context menus, 25 toolbars (+ live provider groups `groups[].provider`, pressed toggles `items[].checked`, `framework/spec/TOOLBARS.md`), **style-package@1** (new type, Brett's card: one pick swaps button/container/slider/dialog/popup/tab-group/gauge/meter; action `style.package:<id|next|prev|random>`; 25 packages + 150 control assets; Fable rebuild = orchestrator build `style-package-fable`, main framework profile), 25 nav menus paired with 25 behaviour themes, 14 design packages (26 total); **brand library** `framework/brand-library/` (not starters: 250 logos + 250 animated logos for AmberX + GizmoX, 100 icon packs, 50 branding packages; `brand-gen.mjs library [--check]`, quality gate, 629 KB of a 2 MB budget); filled icon packs fixed (closed shapes fill, lines stroke). Checks: check-toolbars 593, check-style-packages 735, check-brand 192, check-design-package 699, check-design-language 389.
- **Left (Opus s27–s40):** Brand library plugin (browse + apply the brand library), Settings picker polish, GizmoX console + AmberX app refactor, re-bakes, shots, differences report.
- **Read first:** `framework/spec/DESIGN-LANGUAGE.md`, `framework/core/engines/brand.ts`, `brand-rules.mjs`, `brandgen.mjs`, `framework/react/components/Brand.tsx`, `_claude/builds/orchestrator.json`.
- **Approved (Oct 27 2026, card):** the Fable → Opus switch, recorded with `orchestrator.mjs act approve` (phase 2); #128 merged to main. <!-- axf-plugin:build-orchestrator -->
- **First message (Opus):** "Run `orchestrator.mjs brief enterprise-branding` and continue phase 3 on Opus from branch `opus/enterprise-branding` (merge it first if its PR landed)."

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
