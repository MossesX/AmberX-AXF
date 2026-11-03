# urgent-main-ci-green — main CI back to green

Build `urgent-main-ci-green` (Current profile, Opus, headless; agent Earl the Ear). Branch `claude/urgent-main-ci-green`, PR #284.

Found by window-resize-fix (#278): every PR failed the same jobs, so auto-merge and the batch merge were stuck.

## Failures and root causes

Main run 41709421500 (merge of #278). Each CI step stops at its first failure, so fixing the visible ones uncovered two more.

| Job | Failure | Root cause | Fix |
|---|---|---|---|
| Web Dev Console + Python API | `check-widgets.mts`: widget types mismatch | `framework/spec/gen-fixtures.mts` imported `WIDGET_TYPES` and `WIDGET_TONES` from both `engines/widgets` and `engines/chrome` (xLayout foundation, 0ee1ddfa). The chrome lists shadowed the widget ones, so `widgets.json` got the chrome engine's ten types and five tones | Chrome imports aliased (`CHROME_WIDGET_TYPES`, `CHROME_WIDGET_TONES`); `widgets.json` regenerated (also picks up the `counter:shipped` / `status:shipped` assets) |
| Gradle kernel tests | `ConformanceTest > widget engine` | Same fixture | Same fix |
| Gradle kernel tests | `KernelTest > widget hosts`: right side `[theme-switch:day-night, clock:digital-12h]` | The thin banner's framework copy gained the day/night switch before the clock (c84559a7, 88d33dc7); `check-widgets.mts` was updated, the Kotlin twin was not | Kotlin test expectations match the TS check (no Android code changed) |
| Build engine sweep | `plugins.mjs --check`: xLayout `opens` is false | `apps/molly/plugins/xlayout/plugin.json` provides a view and a dialog, so the locked `plugin.opens.main` rule needs a placement | `"opens": "main"` |
| Build engine sweep (hidden) | `check-profiles.mjs`: `current` not registered | Builds-live status commits added `_claude/builds/profiles/current/` to main; the repo snapshot of `framework/plan/profiles.json` predated the profile | Synced from the hub copy |
| Build engine sweep (hidden) | `framework/deploy/test.sh`: "changed: command run" | `axf_update_script` skips the rebuild when only `_claude/` changed (64840a29); the test's empty commits now count as no change | Test commits a real file change; new case for the `_claude`-only skip |
| Build engine sweep (hidden) | plugin lifecycle: 4 stale references to `plugins/build-orchestrator` | Unmarked mentions added by builds-live / model-gate work: a THREADS.md line, the upgrade note in `deploy/claude-headless.sh`, `check-builds-live.mjs`, the shared dated handoff note, and (after main moved) a build note in the `current` profile's pending export | Markers + lifecycle `mentions` for the first three (launcher reads the note as optional); dated handoff notes in `_claude/shared/notes/handoffs/` count as history, like `_claude/memory/handoff-*.md`; builds store exports (`framework/plan/**/pending.json`, `build-queue.json`) are skipped like `_claude/builds` |

No test was skipped, deleted or loosened. No UI changed, so no UI Review item.

## health@1: CI on main (s4)

The `ci-main` check already turned red on a failing workflow. Now:

- it reads the failing run's jobs and names them in the summary and details, with the commit (`jobs`, `sha` on the item);
- **Auto fix: "Queue a CI fix for a free agent"** (mode auto) calls `framework/cli/agent-job.mjs ci-fix` with the run link, failing jobs and commit; one job per red commit, the item stays amber while it runs and goes red if no agent can take it (reason shown).
- New job type `framework/assets/job-type/ci-fix.json` (event `ci.main-red`, Opus, $8 cap), owned by **Greenlight Gina** (`gina`, jobs-only crew, skill `ci-fix`, git + gh tools; `agents/skills/ci-fix.md`, `agents/notes/gina.md`). Tex Tester was not used: no git tools and not a jobs-only hire.

## Tests

- `check-widgets.mts`: fail → 248 ok; `check-chrome.mts`: 130 ok
- `plugins.mjs --check` (CI env): xLayout error gone
- `check-profiles.mjs`: fail → ok (7 profiles)
- `framework/deploy/test.sh`: fail → 43 ok
- `systems-check/test.py`: 222 → 228 (6 new ci-main checks)
- `agent-swarm/test.mjs`: 93 ok (skill list and job-type count now seven)
- `check-swarm` 224, `check-job-type` 101, `check-agent-card` 84, `check-help` 228, `check-plugin-commands` ok
- Kotlin tests: CI only (no JDK on the VPS)

## Local-only noise (not CI failures)

`check-agent-slots.mjs` and `session-checkin/test.mjs` fail inside a headless Claude session (they see `CLAUDECODE` / the real launcher) and pass with a clean environment, as in CI.

## Left

- After #284 merges: update the waiting PRs (#265, #266, #268, #269, #271, #279) from main so they re-run on green.
- Unrelated drift noticed: regenerating fixtures rewrites `agent-card.json` (left as is; not checked in CI).
