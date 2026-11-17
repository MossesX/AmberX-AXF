# Orchestrator runs long builds across multiple slots (`orchestrator-runs-long-builds-across`)

Brett, Nov 16 2026: "We need to wire the orchestrator to be able to do that. Any build that's over 30 minutes, split
the steps up for multiple slots."

Phase 1 (Fable, s1–s4): the step-groups@1 contract, the store keeping it, the engine `planGroups` and its fixture.
Phase 2 (Opus, s5–s20, this report): everything that runs it. Spec: `framework/spec/BUILD-GROUPS.md`.

## What a long build does now

1. **Split (s5).** The splitter prompt asks Claude for every step's exact `files` and its `dependsOn` (earlier steps
   by position). `parseSplit` refuses unknown, self and circular dependencies (the rules fallback takes over). After a
   split, `planGroups` runs under the pipeline settings and `groups[]` is written on the build. Hand-written steps get
   groups from their files in intake, with no re-split. A build with an open step that names no files stays one
   sequential group: without files nothing says two steps are independent.
2. **Worktrees (s6).** Each group runs on the sub-branch `<build branch>--g<n>` in `<worktrees>/<build>--g<n>`, made off
   the build branch head, with node_modules linked. I used `--g<n>`, not `<branch>/<gid>` (the s1 spec said the second,
   but git can't hold `claude/x/g1` beside `claude/x`). The spec is fixed. Helper: `step-groups.mjs`, because
   `groups.mjs` is already the board's custom groups (build-groups@1).
3. **Dispatch (s7–s8).** `groupLaunches` starts every ready group whose dependencies are merged in its own agent
   slot. The account is one that runs the model of the group's first open step (the step pin, never higher). It honours
   at most `maxParallelGroups` live groups per build and the free agent slots. `claude-headless.sh` takes `--group` and
   `--worktree`, and the session is `axf-<build>--g<n>` (the step text said `-g<n>`). I kept the double dash because
   the build lock already reads `axf-<id>--<x>` as the build's, so a whole-build launch still sees running groups. The
   dispatch token, build lock and model gate are keyed per group. The group brief lists only that group's steps, keeps
   Brett's words whole, and says: commit and push the sub-branch, tick on the shared record, never merge or open a PR.
4. **Lifecycle (s9).** A group with every step done goes to `ready-to-merge`. A crash goes back to the queue up to the
   crash limit (3), then `failed`. A group waiting on another shows `Waiting on g1`. A split build stays `running` until
   every group is merged.
5. **Merge back (s10).** Merges are strict merge order, `git merge --no-ff` (never rebase), with the builds store
   driver. THREADS merges by union. A conflict is aborted and marks the group `conflict` (the contract's state name,
   shown as "Conflict"). It raises the `group-conflict` alert (phone) and the red systems-check item
   `build-groups-merge`, whose auto fix (ask first) is Fix with Claude: a session merges the build branch into the
   group branch, resolves it and stops, then the next tick merges it.
6. **Landing (s11–s12).** The build branch is pushed once, after the last merge. The `after` build rules open the one
   PR (`pr-open-link`), and the merge queue takes it as one entry. Sub-branches never get PRs: autoPr, Open PR and
   `pr-open-link` all skip `--g<n>`. The build rule `parallel-groups` (VPS, gate, `fixer:parallel-groups`) holds a PR
   while any group is unmerged. It is in the live store, the migration and the seed.
7. **Settings (s13).** Settings → Plugins → Build orchestrator → Step groups:
   - **Split builds over (min):** default 30.
   - **Max parallel groups per build:** default 3.
   - **Parallel groups:** on by default.

   These are pipeline-settings@1 keys, described with level tags in `settings.json`.
8. **UI (s14–s15, s19).** A split build's expanded card shows the Groups panel, built from framework controls and
   tokens only. It has three views (grid, compact, cards), each a layout asset in `assets/layout/`. Actions: Start now,
   Re-run, Merge now (asks first), Fix with Claude, Up / Down, Plan again, Ungroup (asks first).

## How each part is reached

| What | REST (`/api/plugins/build-orchestrator/…`) | MCP | CLI (`pipeline.mjs groups …`) | Voice / console action |
|---|---|---|---|---|
| groups and state | `GET step-groups/<build>` | `orchestrator-groups-list` | `list <build>` | `groups.show:<build>` |
| plan | `POST step-groups/<build>/plan` | `orchestrator-groups-plan` | `plan <build>` | panel |
| start now | `POST step-groups/<build>/<g>/start` | `orchestrator-groups-start` | `start <build> <g>` | `groups.start:<build>/group:<g>` |
| re-run | `POST …/<g>/rerun` | `orchestrator-groups-rerun` | `rerun` | panel |
| merge now | `POST …/<g>/merge` | `orchestrator-groups-merge` | `merge <build> [<g>]` | `groups.merge:<build>/group:<g>` |
| merge order | `POST …/<g>/reorder {to}` | `orchestrator-groups-reorder` | `reorder <build> <g> <to>` | panel |
| Fix with Claude | `POST …/<g>/fix` | `orchestrator-groups-fix` | `fix <build> <g>` | banner item auto fix |
| ungroup | `POST step-groups/<build>/ungroup` | `orchestrator-groups-ungroup` | `ungroup <build>` | panel |
| settings | `GET` / `PUT step-groups/settings` | `orchestrator-groups-settings(-set)` | `settings [k=v …]` | settings tab |

- **Deep link:** `build-orchestrator.focus:<build>/group:<g>` opens the build and flashes the group's row. The row
  carries `data-axf-target="row:<build>/group:<g>"`.
- **Why `step-groups/`:** the routes sit there because `groups/` is the board's custom groups.

## Tests and checks

- **New `step-groups.test.mjs` (in CI):** a fake `claude` in `HOME/.local/bin` splits a long build. Two independent
  groups start in two slots while the dependent group waits. Merge order holds. A conflict raises the alert and the
  banner list, and the gate holds the PR. Fix with Claude then makes the build built. A group crashing three times
  fails and Re-run brings it back. Last, REST / MCP / CLI / voice parity.
- **Bug the new test found:** a relaunched group reuses its session name, so the old run's end event could end the new
  run. Each run now reads only the events after its own launch.
- **Checks, all green:** check-build-groups 235, check-builds-store 47, check-build-steps 44, check-build-pipeline 154,
  check-build-rules 27, check-theme, check-controls, check-console-control (the control inventory was regenerated),
  pipeline.test 59, build-orchestrator test 35, push-banner 183, gate 21.
- **plugin-lifecycle:** clean for gate, push-banner and glossary-index. build-orchestrator flags only the untracked
  session brief `.axf-brief.md`.

## Not done, and why

- **Screenshots and UI Review submission (moved to step s22).** The scratch console that `rebuild-shots.mjs` starts
  (with `AXF_APPEARANCE_HUB=off`) opens Build profiles instead of the orchestrator view, and its build search hits never
  load. So the panel was not shot. The three layout assets are ready for the submission.
- **Grammar for `row:<build>/group:<g>` (step s21, Fable).** console-control@1 has no `group` segment kind. Adding one
  changes a cross-app protocol, so it runs on Fable. The panel registers the address once the grammar has the kind.
- **Kotlin twin:** deferred, recorded in `framework/spec/PORTING.md`.
