# VPS orchestrator-only rule + VPS Settings plugin (vps-orchestrator-only-rule-vps-settings-console)

Built Nov 10 2026 on Opus, branch `claude/vps-orchestrator-only-rule-vps-settings-console`. Brett (Nov 9 2026): "I need a
rule on the VPS that refuses any job that doesn't come from the orchestrator. ... Now how would I manage that setting? I
need a console plugin to manage the VPS settings. ... Put it in the same build."

## Starting point
The earlier build `one-way-to-start-builds-the-orchestrator-dispatc` (branch `claude/orchestrator-only-launcher`) has
landed on main (e15e52876). It added `framework/cli/dispatch-gate.mjs`: the dispatcher issues a one-build token, and
`deploy/claude-headless.sh` refuses any build launch without it. That gate had no off switch, no log and no phone notice.
This build adds those and folds the earlier build in. Nothing from that build was redone.

## The rule on the VPS
- **vps-settings@1** (`framework/cli/vps-settings.mjs`): one store for settings that the VPS itself enforces. It sits in
  the hub's shared data, so the host launchers and the console container read the same file
  (`/projects/amberx-axf/_data/vps-settings`, or `AXF_VPS_SETTINGS_DIR`). It is read fresh on every launch, so a change
  needs no restart. Settings:
  - `orchestratorOnly` (default **on**): a build launch without the orchestrator's dispatch token is refused.
  - `notifyRefused` (default on): each refusal sends a phone notice.
  - `notifyEveryMin` (default 10): at most one notice per build in that window. Repeats are still logged.
  - `refusedLogMax` (default 500): how many log lines are kept.
- **Gate** (`dispatch-gate.mjs`): `check` now runs `enforce()`.
  - Each refusal goes into the refused-jobs log (`refused.jsonl`, `vps-refusal@1`) with the build, session name,
    launcher and caller.
  - When the rule is off, a launch the gate would have refused starts, and it is logged as `allowed-off`.
  - A dispatched build and a non-build session log nothing.
  - `--launcher` names the launcher that was refused.
- **Launch paths covered**:
  - `deploy/claude-headless.sh`, as before. It now passes `--launcher claude-headless`.
  - axHub `vps.build_start` and hand launches, since they go through that script.
  - **New:** `agent-slots.mjs enqueue --kind swarm` for a job that names a build (`--build`, or a `build-*` name). Headless
    entries aren't checked again, because the script already checked them before it enqueues.
- **Phone notice**: every refusal does two things.
  - The gate writes a `hub-notification@1` file into axHub's shared inbox.
  - The plugin's watcher raises a console alert (`vps-refused:<build>`, linking to `settings:vps-settings`). AmberX shows
    console alerts on the phone.

## VPS Settings plugin (`apps/console-web/plugins/vps-settings`)
Settings → Plugins → VPS Settings, also on Builds → VPS settings. Panels:
- **Launch rules**: a switch for each on/off setting, a number field for each number, and who changed each setting last.
  A warning line shows while the rule is off.
- **Refused jobs**: the log, newest first, with the 24 h count, Refresh and Clear log. Clear keeps one line saying who
  cleared the log.
- **Install & uninstall**.
Capability `axf.vps-settings@1` (`state()`, `settings()`). It is removable: the store belongs to the framework CLI, so
uninstalling the plugin only removes the console's view, and the VPS keeps enforcing its saved settings.

**Who may switch the rule off**: only Brett's own click in the console, or `vps-settings.mjs set orchestratorOnly=off` in a
shell on the VPS host. A session, MCP or voice gets 403. A session must not be able to switch off the guard that holds
sessions back. This follows the precedent of the API-overflow switch. Anyone may switch it back on or change the other
settings.

## API control (same through every channel)
| What | Deep link | REST (`/api/plugins/vps-settings/…`) | MCP / CLI / voice (plugin-commands@1, auto) | Host CLI |
|---|---|---|---|---|
| Open the screen | `settings:vps-settings` (`console_settings` / `console_show`) | – | – | – |
| Read state (settings + log) | – | `GET state`, `GET settings` | `vps-settings state` / `settings` | `vps-settings.mjs get` |
| Change a setting | – | `PUT settings {key: value}` | `vps-settings settings-set --body '{…}'` | `vps-settings.mjs set k=v` |
| Read the refused-jobs log | – | `GET refused?limit=` | `vps-settings refused --limit N` | `vps-settings.mjs refused` |
| Clear the log | – | `POST refused/clear` | `vps-settings refused-clear` (confirm) | `vps-settings.mjs clear-refused` |
Voice (AmberX) reaches the same plugin commands as MCP. Switching the rule off through REST, MCP, the plugin CLI or voice
is refused (403), as described above.

## Tests
- `framework/spec/check-vps-settings.mjs`: 39/39 pass. Added to CI next to `check-agent-slots`. It covers:
  - settings defaults, coercion and who changed each setting;
  - rule on refuses, rule off allows and logs `allowed-off`, a dispatched build logs nothing;
  - one notice per window, notices off, the real inbox file, log trim and clear;
  - the CLIs, including the agent-slots swarm refusal.
- `vps-settings/test.py`: 23/23 pass. It covers:
  - owner-only switch-off: a token caller or agent header gets 403, and Brett's click passes;
  - range and unknown-key errors;
  - the host CLI sees what the console saves;
  - the real gate feeds the log;
  - one console alert per noticed refusal, never repeated;
  - Clear, and the capability.
- `build-orchestrator/pipeline.test.mjs`: 35 pass, unchanged. These are the earlier gate's tests.
- These pass: console `tsc --noEmit`, check-theme, check-controls, check-toolbars, check-chrome-assets,
  `plugin-lifecycle check vps-settings`, and `plugin-commands check vps-settings` (5 reads, 2 commands).

## Known gaps
- `framework/spec/check-agent-slots.mjs`: 4 or 5 of 56 checks fail, all in the tmux end-to-end part ("queued run starts by
  itself …", "its log is kept"). They fail the same way with this build's `agent-slots.mjs` change taken out, so they come
  from the VPS's load on this shared host, not from this change.
- The rule covers build launches, as the brief's s1 asks. Non-build headless sessions still start without a token:
  walkthroughs, UI shot jobs and chats have no orchestrator build to carry. A stricter "every job" scope would need the
  orchestrator to issue tokens for those too. It is not built.
- `framework/catalog/status.json` has no feature id for VPS settings, so the tracker was not changed.
- The UI shots in UI Review were taken on the watch-live preview with the plugin's state answered from a sample store.
  The Install & uninstall panel shows "request failed" there because the preview has no console server.
