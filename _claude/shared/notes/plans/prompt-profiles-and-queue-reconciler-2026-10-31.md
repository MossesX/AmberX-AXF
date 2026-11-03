# Spec (voice call, Oct 31 2026) — for the Build Orchestrator, Refactor profile

Status: NOT yet added to the Orchestrator. Next text / Claude Code session: add both items to the Build Orchestrator (Refactor profile), per the rule that the Orchestrator populates the other lists.

## 1. Prompt Profiles plugin (session bootstrap + context routing)
- Plugin owns session startup: CLAUDE.md and rule files.
- CLAUDE.md shrinks to a tiny bootstrap that hands off to the Orchestrator.
- The Orchestrator decides per request which rule/memory files to read; reads only what the request needs (lazy loading). Rules split into small topic files so they can be pulled one at a time. Free to start over with new rule files / new CLAUDE.md.
- Prompt profiles: editable, savable profiles defining the bootstrap file + routing rules.
- Live pipeline trace: follow the chain in real time — bootstrap file -> Orchestrator -> each file it fans out to — as a tree, showing what gets picked up at each hop.
- Decision log: at every hop, record the Orchestrator's reasoning — why it included each file, why it did each action, why it skipped/excluded others. Displayed in collapsible rows like the other data sets. Make it pretty, lots of information.

## 2. Build queue reconciler (bug fix)
- Bug: Console init regenerates each profile's build-queue.json from that profile's plan.json on every boot (~70 'Build queue created from the plan' history entries). Refactor's plan.json is ~empty, so the Refactor queue is wiped to empty each boot.
- Brett: queues/pending must never disappear; all data sets are supposed to be synced.
- Fix: replace regenerate-from-plan with a reconciler that reads ALL data sets (pending, tracker, Orchestrator builds, plan, status), analyzes, dedupes and decides what belongs in the queue. Merge, never blind-overwrite. Only create a queue if missing.
- Version every write through axHub (memory_history for the Refactor queue was empty — Console writes bypass versioning).
- Try to recover lost Refactor queue contents from the GitHub repo history / Orchestrator data.

## 3. Screen recorder — audio-only mode (URGENT for Brett)
- Already planned: catalog feature c.screenrec (Screen recorder + screenshot annotate, lib). Brett says an audio-only option was planned with it; find the original plan entry and fold this in.
- Brett needs it now: record the phone's media/speaker output (internal audio), audio-only, no video.
- Android: AudioPlaybackCapture (Android 10+, API 29) via MediaProjection consent prompt + foreground service (mediaProjection type); capture USAGE_MEDIA/GAME/UNKNOWN. Apps that opt out of capture (allowAudioPlaybackCapture=false or secure audio) record silence — surface that in the UI.
- Options: audio-only vs screen+audio, optional mic mix, format (AAC/m4a), save + share, hooks into AmberX notes/voice.
- Priority: Brett wants this ASAP; check whether AmberX voice fix (Vosk hybrid, Oct 29) is done in the same pass.

## Note: overlap with builds-one-page
- Brett asked (voice, Oct 31) what happened to consolidating the redundant data sets. That is orchestrator build `builds-one-page` (13 steps, ~6.2 h: one dataset in plan.json, one Builds page with Plan/Tracker/Queue/Pending/Orchestrator views). Brett paused it Oct 28 (set Blocked); orch-sync.mjs was built as a bridge (Orchestrator <-> Pending only, not the build queue).
- Check whether builds-one-page was folded into `refactor-all` by the Oct 28 stop order.
- Item 2 (queue reconciler) should be folded INTO builds-one-page rather than built separately; at minimum, hot-fix Console init to stop overwriting build-queue.json from plan.json until builds-one-page lands.

## 4. MASTER CLEANUP — kill redundant data sets + plugins (Brett approved, voice Oct 31 2026)
Supersedes item 2 and upgrades builds-one-page. Do this before or together with item 1.
- Problem: the same builds live in ~7 places — plan.json, tracker.json, pending.json (per profile), build-queue.json (per profile), Orchestrator data, status.json, and the claude.ai Pending Builds artifact db — and drift. Too many plugins show the same info.
- 1) One source of truth: a single builds store owned by the Orchestrator. Pending = a status; queue = an order field; tracker.json = generated read-only export (only for the Android console / /tracker). claude.ai Pending page retired or reads the hub.
- 2) Profiles become a field/tag on each build, not separate folders with copies (that is how Refactor's queue got wiped while Main survived).
- 3) Collapse plugins: Build manager, Pending builds, Build queue, Plan, Tracker, Fable rebuilds -> ONE Builds plugin with switchable views (toolbar, menus, shortcuts, deep links), table + collapsible rows. Orchestrator stays as the engine underneath; Plan Studio stays for ideation and feeds builds into it. Delete orch-sync.mjs bridge once landed.
- 4) Every write goes through axHub with versioning (nothing can vanish). Remove Console init regenerate-from-plan.
- Migration: dry-run report first (what merges, dedupes, conflicts), keep old files read-only for one release, recover lost Refactor queue contents from git history / orchestrator.
- Audit all other plugins for duplicate data/views too and list candidates to merge in the report.

## 0. URGENT — session logging to axHub is dead since Oct 21 (do FIRST)
- Brett keeps real-time logs of every Claude session on axHub (AXF protocol) so nothing depends on claude.ai. The only logs found are amberx-axf _data sessions/archive/* and sessions/archive-inbox/*, newest Oct 21 2026. Nothing logged Oct 22-31.
- Lost-at-risk: the Oct 31 morning claude.ai chat that planned the HR department (Jennifer), agent ID cards (designer on AmberArt), agent group chats, and the orchestrator 'boss' where agents can quit if they get in trouble. That chat (deac6f9d-0fa9-4a89-911e-380ff804a75f) is redacted from Claude's search; Brett can still open it and paste it.
- Fix: find why the session logger stopped (check the Oct 21 dead GitHub token / cron / sync), restore it, and backfill every session since Oct 21 (claude.ai export, Claude Code transcripts on the VPS ~/.claude/projects, headless runs).
- Also check PR #190 'Angel queue: 7 new builds' (merged Oct 31 07:11 UTC) for the HR / ID card / group chat builds and link them here.
- Add full-text search across every logged session (claude.ai, Claude Code, headless) in the console: search inside sessions, results with timestamps and surface.
- Add a health check to the systems-check banner + AmberX push: if no session has been logged in X hours while sessions are running, alert Brett immediately. Logging went silent for 10 days and nobody told him; that must never happen again.
- Repo -> axHub sync is broken/partial: hub copies are stale (Angel pending.json Oct 29, main pending.json Oct 22, session logs Oct 21) while the repo has newer data (PR #190 Angel queue: 7 builds, Oct 31). Fix claude-sync (likely same dead token as Oct 21), make repo<->hub sync live/automatic for every data file, and cover it with the dead-man alarm.

## TOP OF LIST (Oct 31, Brett): agent-swarm
- agent-swarm (HR / Boss / group chat / ID cards / discipline / salary) lives in profile BREAKROOM: `_claude/builds/profiles/breakroom/orchestrator.json` (merged via PR #190). Status queued, 0/19 steps. Step s1 = preview page of the 4 ID card designs for Brett to pick the default.
- Angel + Breakroom were never in profiles.json; registered in the axHub copy Oct 31 by the voice session. Mirror to the repo copy (framework/plan/profiles.json) so sync doesn't wipe it, and add a CI check: profile folder without registry entry = fail.
- Then kick off agent-swarm (Fable phase first, s1 preview first).

## 4b. Live progress bars (Brett, Oct 31 08:16) — FOLDED INTO item 4 master cleanup. HOLD: do NOT start until Brett says go. Profile: Urgent.
- Anywhere a build is listed: a real-time progress bar with the number.
- If the build is broken into steps: a real-time progress bar for each step too.
- Banner: percentage number only, for builds and steps, with an animation on the number while active.
- Build it once into the merged Builds plugin + the merged banner (not on the old lists).

## 4c. Atomic steps + Steps view + Harvest (Brett, Oct 31 08:53, voice) — part of item 4 master cleanup, profile Urgent, HOLD until Brett says go. Brett's message was cut off mid-sentence after 'after you harvest a new build,' — get the rest before building.

### Orchestrator breaks EVERY build into atomic steps
- Every build is split into every individual task: add a menu item, edit a banner item, change a color, every little change. Example Brett gave: the progress-bar build = 6 steps (bar on every list; bar per step; animated % in the banner; merge all lists into one master data set; plugin cleanup merge; fold into master cleanup).
- (Brett said 'I need the store timer' — unclear; possibly a per-step timer/time estimate. Ask.)

### New 'Steps' view on the master Builds page (the one the cleanup creates)
- Grid, expandable rows, no required order. Scope switch: just one build, or every build in the build profile.
- Row shows: source build, build profile, kind (edit / removal / creation), target (feature / element / action), time estimate, cost estimate.
- Expanded: exactly what the step does. If it's a FIX: where the breakage is, where the problem came from, what triggered it (e.g. another merge), what raised the alarm / how we know it needs fixing — all that data.
- Interactive hooks wherever possible (data from the Orchestrator): open the target live in the app — navigate to the page with the element in focus and highlighted. Opens in a floating window (default) or the main area, set in the standard plugin settings 'where it opens'.
- Focus highlight is fully configurable in plugin settings: any styling change, not only animation. Ship a LARGE list of pre-configured focus behaviors (flashing border, light flashing background, etc.); the picker is a dialog (too big for a dropdown) with a search bar, text filter and a filter toolbar.
- Drag and drop to reorder steps. Warning shown that changing the order refactors that build.
- Multi-select: Ctrl+click (desktop), long-press (phone); plugin setting to also show checkboxes or switches; selected rows highlight.
- HARVEST NEW BUILD: take the selected steps (from any builds in the profile) into a new build. Dialog with a default name Claude picks to match what it does, shown greyed; tapping the box clears it; if untouched, the default is used.
- (Rest of the harvest flow: pending Brett.)

### Toolbars are assets + right-click style editor (framework-wide)
- The Steps view's filter toolbar is an asset. ANY toolbar asset: right-click opens its settings — style, colors, animations, behavior, everything — in categorized, foldable containers. Expose every token that conforms to the framework. Style/config only, no engine edits. A full toolbar editor comes later.

### Harvest flow, rest of it (Brett, Oct 31 08:55) — replaces '(Rest of the harvest flow: pending Brett.)'
- After harvesting, the Orchestrator refactors whatever is left in the source build(s).
- Split choice: put everything into ONE build, or have Claude split it into N builds (Brett types e.g. 3).
- Split dialog: lists the N proposed builds as expandable rows showing all their steps; each has a default name Claude picks to match what it does, editable/renamable.
- Drag to arrange and prioritize the builds in the dialog, then confirm.
- Scope stops here for now (Brett: 'we'll leave it there').

### Step granularity CORRECTION (Brett, Oct 31 ~09:00, voice) — overrides 'every little change' above
- Break down to the smallest step (e.g. 'change this color') ONLY when that one change is the only thing being done to that section/element.
- If a section/element is being built or edited as a whole, it stays ONE step. Do not define every parameter as its own step.
- Divide further on request: in the Steps grid, multi-select steps and ask Claude to divide them more. Claude decides whether they can be split and tries; if not, it says why.
- Still open: what Brett meant by 'the store timer' (maybe a per-step timer). Ask before building.

### RESOLVED 'store timer' (Brett, Oct 31 ~09:05): it was 'I need the steps STORED / saved', not a timer.
- Every atomic step the Orchestrator breaks a build into is saved persistently as its own record in the master builds store (versioned through axHub, synced to the repo), not regenerated on the fly. The Steps view reads these saved records; reorders, splits, harvests and edits write back to them. Nothing gets lost on restart.

### Restore to default (Brett, Oct 31 ~09:07)
- When the Orchestrator first breaks a build into steps, save that original breakdown (order + grouping) as the build's DEFAULT snapshot.
- Once Brett starts rearranging steps (drag reorder, split, harvest), a 'Restore default' action puts the build back to that original breakdown. Confirm dialog first (it undoes the rearranging). Available per build and for the whole profile view.

### Draft until Apply (Brett, Oct 31 ~09:08)
- Everything done in the Steps view (reorder, split, divide further, harvest, rename, split-into-N builds) is a DRAFT. Nothing touches the real builds, the Orchestrator or any queue until Brett clicks Apply.
- Show a clear 'unsaved changes' state (count of pending changes) and a Discard button next to Apply. The draft itself is saved, so it survives a restart until applied or discarded.
- On Apply: the Orchestrator refactors the affected builds and writes the new step records (versioned). Restore default still works afterwards.


## GO GIVEN — Urgent profile (Brett, Oct 31 2026 ~09:45 EDT, voice)
- Brett: "Just do whatever you gotta do... get that done ASAP. First thing done." The HOLD on the Urgent profile is LIFTED.
- Scope: item 4 master cleanup (one Orchestrator-owned builds store, profiles as a field, one Builds plugin, every write versioned through axHub, remove Console init regenerate-from-plan) + 4b live progress bars + 4c Steps view (atomic steps stored as versioned records, drag reorder, multi-select, divide further, harvest + split-into-N, Restore default, draft until Apply with Discard).
- Order: master cleanup store first (Steps view needs it), then Steps view, then progress bars. Dry-run migration report first; keep old files read-only for one release.
- Priority: Brett made this FIRST, ahead of agent-swarm s1. Item 0 (session logging + repo->hub sync) still runs alongside; diagnostic vps.run job 8ba91f2d-1bb6-4cc0-8085-6e52bdc75f6a.
- Must be built from a Claude Code session with repo push (the voice call has no shell). Add it to the Build Orchestrator under profile `urgent` first, per the orchestrator rule.

### GO on HR department (Brett, Oct 31 ~15:00 ET, voice): 'Yeah, build it.'
- Queue the Prompt Profiles / HR department build from _claude/memory/docs/prompt-profiles-brief.md NOW, right after the agent-swarm kickoff (HR covers salaries/paychecks for the swarm agents, so run the swarm's salary + discipline steps together with it).
- The 3 open answers weren't given. Use these defaults and confirm with Brett at kickoff: profile = Angel, agent name = Brownie, crew name = Kitty Krak Crew.

### HR answers CONFIRMED by Brett (Oct 31, voice): profile = Angel; agent = Brownie; crew = Kitty Krak Crew (he said 'kitty cat, let's do it' without picking K or C, so 'Crew' with a C until he says otherwise). Prompt Profiles / HR build is unblocked: queue it in Angel right after the agent-swarm kickoff.

### GO on Urgent (Brett, Oct 31 ~15:00 ET, voice): Brett said 'yeah' to starting the Steps view / Harvest (4c). Urgent profile is OFF HOLD. Order: item 4 master data cleanup (one builds store, merged data sets, one Builds plugin) first, since 4b progress bars and 4c Steps view are built into the merged Builds plugin. Then 4b and 4c. Item 0 (logging + sync) still comes before everything.

### FINAL PRIORITY ORDER (Brett, Oct 31 ~15:00 ET, voice). This overrides every earlier ordering:
0. Session logging + repo<->hub sync fix (item 0)
1. MASTER CLEANUP (item 4): merge the data sets, one builds store, one Builds plugin
2. Agent swarm (Breakroom), s1 card preview first
3. HR / Prompt Profiles (Angel, Brownie, Kitty Krak Crew)
4. Progress bars (4b) + Steps view / Harvest (4c), built on the merged Builds plugin
5. Triage + merge the ~30 open PRs as part of the cleanup

### BUG, add to MASTER CLEANUP (Brett OK'd, Oct 31 ~15:05 ET): Dev Console Push banner reopens duplicate PRs
- Seen: PR #217 (branch claude/profiles-registry-sync) squash-merged ~14:55 ET. At 14:58 ET the Push banner opened PR #218, same title, same branch, 'is 1 commit(s) ahead of main'. Open PR count stayed at 30.
- Likely cause: after a squash merge, main gets a NEW commit, so the old branch still counts as 'ahead' by commits. The banner auto-opens a PR on that.
- Fix: (a) delete the head branch automatically after merge (repo setting + Console). (b) Push banner compares the actual tree diff (git diff main...branch empty = nothing to push), not the commit count. (c) Before opening a PR, check whether an open or recently merged PR from the same branch already exists.
- Cleanup task: go through the ~30 open PRs, close the empty or duplicate ones (zero diff vs main), and merge the real ones in order. Close #218 if its diff is empty.
