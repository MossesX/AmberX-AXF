# Build docs and walkthroughs — report (Nov 4 2026, Opus)

Build `build-docs-walkthroughs` (Angel profile), branch `claude/build-docs-walkthroughs`.

## What Brett said (verbatim, Nov 4 2026, voice)

> For everything that's already been built, every step that's already been built, I need to be able to right-click a step or a build and say: create documentation for this. Create a video for this build, which will then record a live video of a browser walkthrough, and I'll be able to select how long I want it to be and different things, and I'll also be able to input special stuff that I want covered.

## Short version

New console plugin **Build docs** (`apps/console-web/plugins/build-docs`). Right-click a built build or a done step in
the Build manager (rows and Built history), the Build orchestrator (cards and step rows), Pending builds, Plan Studio
(plan rows and tree) or Codebase changes → **Create documentation** / **Create walkthrough video**. Both dialogs add
more builds or single steps (multi-select). Builds → **Docs & videos** shows every job with live progress, cancel,
re-run with tweaks, the video player and the docs PR.

- **Docs:** Markdown from Brett's verbatim words and addenda, the steps, the build report, the merged PR's diff and
  what the touched plugins declare (pages, dialogs, settings, menu items, help, REST/MCP/CLI commands). AI deep mode
  (`axf.llm@1`, told to write only from that material) or a template from the same material. Opens a PR into main
  (`docs/<build>-xxxx` → `<plugin|app>/docs/<build>.md`) through the GitHub REST API, so the merge queue lands it; the PR
  is linked in the build's plan (new **Docs** section in Plan Studio).
- **Video:** length (30 s / 1 / 2 / 5 min / custom 15 s–30 min), focus text + checkboxes of the build's steps, screens
  and commands, viewport, theme (design package), layout, narration + Piper voice, captions burned in, speed,
  intro/outro, AI. The click-path script is shown first (edit lines, drop scenes); **Approve and record** sends one
  veto call (`vps.run` via Vinny); on the VPS the job waits for a heavy slot and records with the existing walkthrough
  recorder (Playwright + Piper + ffmpeg), live console, writes answered in the browser, secrets scan on every frame.
  MP4 + VTT + poster + transcript land on the VPS data volume; the video attaches to the build's plan.
- **Proved live:** a 25 s 1920×1080 video of Plan Studio was planned, approved and recorded end to end on this VPS
  through `runner.mjs` in a heavy slot (recorder image built on the way; secrets scan clean). It found three real
  problems, all fixed: captions far too big (libass canvas), console pages didn't open (its nav is a menu → the
  recorder now uses the runtime's `navigate`), and an intro line read from a build note.

## Steps

| Step | What | Where |
| --- | --- | --- |
| s1 Core | build-docs-job@1 (states, advance, rerun), docs + video options, length → words/scenes budget, template docs, fallback script planner, AI prompts + answer cleaning, script safety (move allowlist, origin allowlist), edit/merge/transcript | `core.mjs` |
| s2 Gatherer | store record + origin + addenda, report, diff (PR merge commit on main, else main…branch, else commits naming the build), touched folders, plugin surface (views, nav, dialogs, settings tabs, settings, menus, help), commands via plugin-commands@1 | `gather.mjs` |
| s3 Docs writer | AI or template per target, docs drafts in the job, PR via GitHub REST (branch off main, contents PUT, pulls POST), plan Docs link via plans@1 | `cli.mjs`, `server/__init__.py` |
| s4 Recorder | data scripts (`script-file.mjs`, `load.mjs` fallback to `$OUT/script.input.json`), `card` / `dialog` / `navigate` / `dispatch` helpers + `LOOK_B64` in `record.mjs`, silent narration in `tts.mjs`, burned-in captions in `assemble.mjs`, `LOOK_B64` pass-through in `rebuild.sh`; host runner with progress parsing, cancel → `docker kill`, voice cache reuse | `apps/amberx-droid/walkthrough/*`, `runner.mjs`, `jobs.mjs` |
| s5 Server | index (+ plan → build and change → build maps), options, ai-status, jobs, job, source, file (guarded), finished, docs, video, script, approve, cancel, rerun, remove | `server/__init__.py` |
| s6 Web: menus + dialogs | `contextExtras` on seven targets (new: `axf-orchestrator-step`, `axf-plan`, `axf-change-entry`, `axf-built-item`), Docs dialog, Video dialog, script approval | `web/index.tsx`, `web/ui.tsx`, row attributes in build-orchestrator, build-manager, plan-studio, codebase-changes |
| s7 Web: page + plan | Docs & videos page, settings sub-tab (defaults, now, install & uninstall), deep link `#/build-docs?job=`, Plan Studio Docs section + `video` attachment kind (schema, d.mts) | `web/*`, `plan-studio/web/editor.tsx`, `plan-core.mjs` |
| s8 Finish | help (57 entries, console help 100%), README, tests, checks, this report, PR | |

## Checks

| Check | Result |
| --- | --- |
| `node apps/console-web/plugins/build-docs/test.mjs` | 15 checks pass (core, CLI over a scratch store, runner progress, recorder data scripts) |
| `python3 apps/console-web/plugins/build-docs/test.py` | 25 checks pass (routes, docs worker → fake GitHub PR, PR failure, plan links, video flow → fake Vinny, file guard, finished video attached once) |
| Plan Studio `test.mjs` (tsx) + `test.py` | 26 + 15 pass |
| Recorder `check.mjs` (amberx-app, stack, a data script) | pass |
| Console `tsc --noEmit` | clean (outside the known baked `plan/` errors) |
| `plugin-lifecycle check build-docs`, `plugin-commands check build-docs` (10 reads, 12 commands) | clean |
| `check-theme`, `check-controls`, `check-toolbars`, `menu-reach`, `help-coverage --check` | pass |
| Live recording on the VPS | 25 s MP4, 1920×1080 H.264 + AAC, 6 captions, secrets scan clean |

## Known gaps

- **Molly voice phrases:** the voice-command tooling (PR 323) isn't on main yet. Once it lands, run
  `node framework/cli/voice-commands.mjs generate console-web --write`; the plugin's 22 commands then answer by voice.
- **Screenshots in docs:** the option is stored and passed to the AI, but the docs job doesn't capture screens itself
  yet (the template links the screens instead). Capturing them is a follow-up (reuse `rebuild-shots.mjs`).
- **Git board:** no such view exists in the console today, so there is nothing to hook; any future build view gets the
  items by marking its rows `data-fx-ctx-target="axf-orchestrator-build"` (or `-step`) with the build id.
- **Fallback scripts are thin** without AI: one scene per screen plus the built steps. Deep mode fills them.
- **Video in a plan** opens the job on Docs & videos (the MP4 needs the console token, so it isn't embedded in the plan).
- Android: none (on hold).
