# file-watchdog-plugin-watch-files-run-scripts-or (Opus, headless worktree session)

Brett (Nov 9 2026): "I need a watchdog plugin that I can tell to watch files for changes without using AI. I need it to
run scripts, or run commands on the console. It can use AI, but it doesn't have to. I can give it a prompt to use AI,
and switch it to enable AI."

## What was built

New console plugin `apps/console-web/plugins/file-watchdog/` (plugin-lifecycle@1: code in its folder, data in
`.axf-console/plugins/file-watchdog/`, install / uninstall / hooks, help.json, notify.json type `watchdog.fired`).

- **Engine** (`server/engine.py`, stdlib only, no AI): a watch = files, folders or globs (relative to the repo root or
  absolute on the VPS). Snapshot (mtime, size) compared each pass; inotify through libc wakes the loop at once, a timed
  pass (2 s) catches what inotify can't. Events: created / modified / deleted. Per watch: debounce (changes inside the
  window merge: created+deleted = nothing, deleted+created = modified), recursive, ignore patterns (defaults: .git,
  node_modules, swap / temp files), which events, enabled. At most 10 changes fire per debounce window; the rest are
  logged as one skipped line.
- **Actions** (every one gets the path and event: `{path} {rel} {event} {name}` in its text, `WATCHDOG_PATH /
  _REL / _EVENT / _WATCH / _NAME` in a script's environment):
  - notify: an alert (source `file-watchdog`) to the console banner and AmberX, gated by the Notifications panel.
  - script: runs a script file (executable, or by extension: node / python3 / bash), cwd repo root, timeout.
  - shell: runs a command line (placeholders shell-quoted), cwd repo root, timeout.
  - console: a console action through console-commands@1 (e.g. `nav:builds`).
  - control: any control@1 command through control@1 (e.g. queue a build). A destructive one still needs its confirm
    token, which a watch can't carry, so it is logged as failed, never run.
  - AI (optional): **off by default**; the watch's Enable AI switch + Brett's prompt. When on, the prompt plus the path,
    event and a unified diff (text files up to 64 KB) go to Claude through axf.llm@1 (the assistant's profiles,
    fallback chain and usage counting; optional model / profile per watch). Reply, model and tokens are logged.
- **Approval rule for script and shell** (the same rule as other VPS writes): a script or shell action runs only after
  Brett approved that exact command. Approval comes only from his own signed-in console session (control@1
  `owner(request)`), never from the request body; anyone else's approve turns into a request plus an alert asking him.
  Editing the command clears the approval. Unapproved actions are logged as `held`.
- **Log**: every event and every action result (status, exit code, output tail, ms) in `events.jsonl` (trimmed at
  4 MB to the last 2000).
- **UI**: page nav → Plugins → File watchdog (also Settings → Plugins → File watchdog, Plugins menu entry): list of
  watches with on/off, Enable AI + prompt, Approve / Revoke, Test, Edit, Remove; add / edit form; recent events with
  each action's result.

## How each part is reached (API rule)

| What | UI | REST | MCP | CLI | Voice (AmberX) |
|---|---|---|---|---|---|
| Open the page | Plugins → File watchdog | control@1 `console.actions` run `file-watchdog.open` | `console_open` / `console_show` target `file-watchdog` | no CLI opener: the CLI reads and drives it (rows below) | "open the file watchdog" |
| State, watches, one watch, events | page | `GET /api/plugins/file-watchdog/state` · `watches` · `watch?id=` · `events` | `file-watchdog_state` / `_watches` / `_watch` / `_events` | `axf file-watchdog state` … | through the MCP tools |
| Add / change / remove a watch | form, Edit, Remove | `POST add`, `POST update`, `DELETE watch?id=` | `file-watchdog_add` / `_update` / `_remove` | `axf file-watchdog add --paths …` | "watch the plans folder and run …" |
| On / off, Enable AI + prompt | switches, prompt field | `POST enable`, `POST ai` | `file-watchdog_enable` / `_ai` | same | same |
| Approve a script / shell action | Approve / Revoke | `POST approve` (approves only from Brett's session) | `file-watchdog_approve` (a request) | same | a request; Brett taps Approve |
| Test fire, check now, clear log | Test, Check now, Clear log | `POST test`, `POST scan`, `POST events/clear` | `file-watchdog_test` / `_scan` / `_clear-events` | same | same |

REST via control@1 too: `/api/control/file-watchdog/<command>` (plugin-commands@1, declared in plugin.json).

## Checks

- `python3 apps/console-web/plugins/file-watchdog/test.py`: 66 checks passed (model, compare, debounce merge, every
  action type, approvals, AI off by default / on with prompt + path + event + diff, tokens logged, globs,
  non-recursive, inotify wake, routes declared).
- Live loop with a 30 s timer: a new file fired its approved shell action within a second (inotify).
- `npx tsc --noEmit` (console-web): clean. `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`:
  pass. `plugin-commands.mjs check file-watchdog`: 6 reads, 10 commands. `help-coverage --missing console-web`: no
  file-watchdog control missing (the scope's ratchet fails on `claude-accounts/help.json`, which was already broken).
  `menu-reach`: no file-watchdog findings (its other findings were already there).
- `plugin-lifecycle.mjs check file-watchdog`: only finding is the gitignored local `.axf-focus.json`, not in the repo.

## Choices made (headless, nobody to ask)

- Shell and script actions run on the host the console API runs on (the VPS console), cwd the repo root, with secrets
  (`*TOKEN*`, `*SECRET*`, `*KEY*`, `*PASSWORD*`) taken out of their environment.
- AI routing goes through axf.llm@1 (the assistant's profiles / fallback / usage). The orchestrator's job routing is
  for headless Claude Code sessions, not one-shot completions, so it isn't used here.
- Screenshots / UI Review skipped as non-essential for this phase (step text says so); the page needs shots before
  the PR is called ready for UI.
