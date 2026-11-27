# Voice listener: use Claude when connected (setting)

Build `voice-listener-use-claude-when-connected`, Phase 1 (Opus), Nov 14 2026.

Brett (Nov 13 2026 23:42): "can we have a setting to make it use Claude if Claude's connected"
Brett's note on the build: the setting is a real on / off switch. OFF = always scripted, even while Claude is connected,
and no speech text goes to Claude. Show the current mode on the listener UI.

## Base

The voice listener is the `wake-listener` plugin from build `console-app-wake-word-voice-listener` (PR #643, still
open). This branch merges that branch and builds on it, so the PR shows both until #643 lands.

## What it does

- **Setting** *Understand with Claude when connected* (`axf.voice.useClaude`, default on) and *Wait for Claude*
  (`axf.voice.claudeTimeoutSec`, 2-30 s, default 8). Settings → Plugins → Wake listener → Claude mode, Basic level.
  The plugin server keeps the shared copy, and the page mirrors it into the two console settings keys.
- **Claude first:** with the setting on, a command goes to `POST /understand`. Claude, through `axf.llm@1`, picks one
  catalog command and fills its fields from what was said. It asks only for what is missing. Commands that change
  or delete something are said back first and run only after a spoken yes.
- **Fallback:** when the switch is off, Claude isn't connected, the reply isn't from a Claude model, the call times
  out or fails, credits run out, or Claude picks nothing (or something it may not run), the same transcript goes to
  the scripted matcher and wizard. If that happens partway through a question, the scripted wizard carries on with
  what Claude already had. After a failure Claude is skipped for 60 s.
- **Approvals stay spoken:** approve / deny / reject / veto commands are never offered as tools. Those words never
  reach Claude, and a reply naming such a tool is refused. Approvals keep the review and the approvals-banner relay.
- **Mode indicator:** a chip on the panel shows *Claude mode*, *Scripted* (switch off) or *Offline mode*. While
  offline, the mic light's label also ends in "· offline mode".
- **History:** every command is recorded with its mode (claude / scripted) and, for scripted ones, the fallback reason.
  Older entries read as scripted. A *Command history* panel has an All / Claude / Scripted filter.

## How each feature is reached

| Feature | REST (`/api/plugins/wake-listener`) | MCP | CLI | Voice / deep link |
| --- | --- | --- | --- | --- |
| Claude mode on / off | `POST /claude/on`, `POST /claude/off`, `POST /claude {useClaude}`, `POST /settings {useClaude}` | `wake-listener_claude-on`, `_claude-off`, `_claude-set`, `_use-claude` (action `voice.useClaude:on|off|toggle`); control@1 `console.settings` path `axf.voice.useClaude` | `axf voice claude on|off`, `axf wake-listener claude-on` | "use Claude for voice", "stop using Claude for voice"; `wake-listener.show:claude`; setting address `…/subtab:settings.subtabs=wake-listener/setting:axf.voice.useClaude` |
| Timeout | `POST /claude {timeoutSec}`, `POST /settings {claudeTimeoutSec}` | `wake-listener_claude-set` | `axf voice claude timeout <s>` | setting `axf.voice.claudeTimeoutSec` |
| Status / indicator | `GET /claude`, `GET /state` (mode, claudeConnected, lastFallbackReason, offline, offlineReason) | `wake-listener_claude`, `_state` | `axf voice claude status` | "is Claude mode on"; `wake-listener.show:mode` (`data-axf-target="wake-listener.mode"`) |
| Dry run | `POST /claude/test {text}` | `wake-listener_claude-test`, `_understand-test` (action `voice.understand.test:<phrase>`) | `axf voice claude test "<phrase>"` | action `voice.understand.test` |
| Understand | `POST /understand {text, pending?}` | `wake-listener_understand` | (through the page) | every spoken command while the setting is on |
| History by mode | `GET /history?mode=claude|scripted` | `wake-listener_history`, `_history-open` | `axf voice history [claude|scripted]` | `wake-listener.show:history:claude` |

`axf voice` is routed by capability (`service:axf.wake-listener@1` + `cli.mjs`), never by folder name.

## Files

`apps/console-web/plugins/wake-listener/`: `claude-mode.md` (design note), `server/claude_tools.py` (catalog → tools),
`server/claude_intent.py` (the call, follow-ups, the confirm gate, connection status), `server/__init__.py` (routes),
`web/claudeMode.ts`, `web/flow.ts` (Claude first, the claude floor, fallback), `web/History.tsx`, `web/index.tsx`
(settings group, mirror, indicator, actions), `core.mjs` (settings, `claudeGate`, `modeIndicator`, history shape),
`listener.mjs` (history store + CLI), `cli.mjs` (`axf voice`), `catalog.mjs` (voice phrases), `help.json`, `README.md`,
`assets/status/*` (indicator options), `review/offline-indicator-choices.json`, `test.py`, `test.mjs`.
Outside it: `framework/cli/axf.mjs` (`voice` routing), `apps/console-web/src/control/inventory.json` (regenerated).

## Checks

- `python3 apps/console-web/plugins/wake-listener/test.py`: 68 passed. A fake LLM covers: converter, picking a
  command, asking for a missing field, follow-ups, the confirm gate, timeout / error / no-credit / not-claude / no-llm
  fallbacks, the cooldown, the approvals guard, the switch off sending nothing while connected, state, history and
  the `/claude` API.
- `node apps/console-web/plugins/wake-listener/test.mjs`: 109 passed (settings, `claudeGate`, indicator, history, and
  REST / MCP / CLI / voice parity).
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, plugin-commands check, `tsc`:
  all pass. plugin-lifecycle: clean apart from the local, gitignored `.axf-focus.json` (Watch live), which is not in
  the repo. tracker: ran.
- Glossary ratchet (`glossary-index/catalog.mjs --check`): 389 against 388 allowed. main has the same count. This build
  added 26 undescribed commands, then gave every command a description, so it adds none.

## Not done / waiting

- **UI Review:** there are no shots and nothing has been submitted. This headless session has no console token
  (`AXF_TOKEN`), the same as the base build. The three offline-indicator options ship as ui-choices@1 status assets
  (`assets/status/wake-listener-offline-indicator-*`). Option 1 (*chip and light*) is built. The exact submit command
  is in the build note.
- The indicator options are data only. The code builds option 1; the picked option gets wired in a later phase.
- No Android / Kotlin work (Android is on hold). The console app uses this through its WebView.
