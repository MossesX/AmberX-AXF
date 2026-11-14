# Wake listener (wake-listener@1) — Nov 13 2026

Brett: "set a listener in the console Android app; say a trigger and approve, it lists everything needing approval one at
a time and I say approve or deny, or approve all pending; change the veto timer to two hours by voice; every custom command
the console could need in wizard format with an entry, pipelines, create a new project named Gizmo Johnson". Build
`console-app-wake-word-voice-listener` (Fable).

## What it is

An always-on wake-word listener in the console page (the console Android app is a WebView around it). Say a wake phrase
Brett sets in Settings → Plugins → Wake listener (several allowed; "hey" / "OK" in front is fine), then a command, or say
both in one breath ("amber, approve all pending"). A mic-on light sits on the banner (status asset `wake-listener`: grey
off, green waiting, amber awake, accent a wizard is waiting for an answer, red an error with the reason; tap = switch).

| File | What |
| --- | --- |
| `core.mjs` | pure: settings (`on`, `phrases`, `engine`, `awakeSec`, `answerSec`, `speak`, `chime`, `indicator`, `pauseHidden`), `matchWake`, the state machine (`hear`: off → idle → awake → command, wizard has the floor), the light |
| `catalog.mjs` | pure: the voice command catalog built from the plugin-commands registry, control@1 targets and the page's actions; the phrasebook; `matchCommand`; the spoken wizard (`startWizard` / `answerWizard`); `requestFor`; `speakResult` |
| `listener.mjs` | the store (data folder: `settings.json`, `state.json`) + CLI: `settings · set k=v · on · off · phrases [add|remove] · state · report · hear · match · catalog` |
| `server/__init__.py` | REST `/api/plugins/wake-listener`: `GET settings · POST settings · POST on · POST off · GET state · POST report · GET catalog · POST match` over the CLI |
| `web/engine.ts` | the microphone: the console app's on-device recognizer through the native bridge (`listener.start|stop|status`, event `listener`) when the bridge offers it, else the browser's SpeechRecognition; mic-lease@1 so it never fights the Assistant mic, dictation or voice notes; `say` (agent voice when installed, else the device voice) and the chime |
| `web/flow.ts` | what a command does: the floor (wizard / approvals review), the catalog match, running plugin routes, control@1 commands and actions, the approvals review (lib-approvals' deciding path), the fallback to the console's own voice intents |
| `web/index.tsx` | the plugin: settings tab (switch, phrases, engine, timings, replies, light, "Try it" box, last heard / command / reply), banner light, actions, state reports |

## Spoken flows

- **Approvals:** "approve" (or "what needs approval") reads how many are waiting and the first one: approve / deny / skip /
  "what is it" / "approve all" / stop. Each decision goes through lib-approvals (the Approvals banner's relay when it is
  loaded, else the hub directly). "approve all pending" and "deny all" work without the review.
- **Veto timer:** "set the veto timer to two hours" → a control@1 veto pass (`act pass.scopes all grant { minutes: 120 }`),
  said back first ("… calls run at once instead of waiting for your veto, once you approve the pass. Yes or no?"). The pass is
  a request until Brett approves it once, like every pass. The hub's own 90-second hold countdown has no console API in this
  repo (it is an axHub server setting), so that is the one reading of "veto timer" the catalog cannot change yet.
- **Wizards:** any catalog entry with missing fields: one question per required field, optional ones once ("say skip to
  leave it"), then the summary + "Yes or no?", then it runs. "create a new project" → "What is the project called?" →
  "Gizmo Johnson" → "What kind…? Say skip" → "Create the project Gizmo Johnson. Yes or no?" → "yes" → `project-wizard/run`.
- **Pipelines:** file a build, split, prioritise, queue / unqueue, stop (hold) / release / archive / restore / delete, land
  (mark complete), approve a phase, add a note, route to API / subscriptions, pipeline status, the queue.
- **Notes / tasks:** "add a note …", "add a task …", "what are my tasks" (control@1 `amberx.items`).
- **Tokens / skins:** "switch color theme to dark" (`tokens.slots`), "set the accent colour to …" (`tokens.theme`), next theme / style / layout.
- **Navigation / settings / plugins:** open, go to, back, home, scroll, find, press, "set <setting> to <value>", "disable plugin <x>"
  go to the console's own voice intents (console-control@1, action `console.control.voice`).
- **The listener:** "stop listening", "what can I say", "cancel", "say that again", "start wizard <command>".

A command without a phrasebook line still has an entry: its spoken form is its title ("queue a build"), its fields come
from its input schema (required ones asked, optional ones once). New plugins appear in the catalog by themselves.

## API (everything the UI does, without the UI)

| Reach | How |
| --- | --- |
| Deep link | `console_show` / `console_open` target: settings tab `wake-listener` (`settings.open:wake-listener`, action `wake-listener.open`) |
| REST | `/api/plugins/wake-listener/settings` (GET, POST), `/on`, `/off`, `/state`, `/catalog?q=`, `/match {text}`; the open console's flows through plugin-commands: run `wake-listener/heard { args: "approve" }`, `wake-listener/approvals`, `wake-listener/wizard { args: "project-wizard/run" }`, `wake-listener/cancel`, `wake-listener/toggle` |
| MCP | `wake-listener_settings`, `wake-listener_set`, `wake-listener_on`, `wake-listener_off`, `wake-listener_state`, `wake-listener_catalog`, `wake-listener_match`, `wake-listener_heard`, `wake-listener_approvals`, `wake-listener_wizard`, `wake-listener_cancel`, `wake-listener_toggle`, `wake-listener_open` (plugin-commands@1) |
| CLI | `node apps/console-web/plugins/wake-listener/listener.mjs …` (local store + dry runs) and `axf wake-listener <command>` (through the console) |
| Voice | the catalog itself; AmberX hands-free can hand a phrase to the console with `wake-listener.heard:<phrase>` |

State is readable at `GET /state` (phase, engine, mic open, last heard / command / reply, `fresh` = a console is listening
now); the page reports it every few seconds and on every change.

## The console Android app

In a browser the listener uses the browser's recognizer. In the console app (`apps/console-droid`, on the unlanded PRs
#637 / #633) the WebView has no Web Speech API, so the engine expects the app's on-device recognizer behind the native
bridge: tools `listener.start { phrases }`, `listener.stop`, `listener.status`, event `listener { text, final, listening,
micOpen, error }`, in a foreground service with the mic notification, offline (Android's on-device SpeechRecognizer or Vosk).
That Java twin is the deferred gap in `framework/spec/PORTING.md` (this build adds no Android code; the bridge files live
on the unlanded branches). `web/engine.ts` picks it up as soon as `window.axfNative.tools` lists the three tools.

## Claude mode (Nov 14 2026)

Brett: "can we have a setting to make it use Claude if Claude's connected". Build `voice-listener-use-claude-when-connected`;
design note: `claude-mode.md`.

- **Setting** *Understand with Claude when connected* (`axf.voice.useClaude`, default on) and *Wait for Claude*
  (`axf.voice.claudeTimeoutSec`, 2-30 s, default 8): Settings → Plugins → Wake listener → Claude mode (Basic level).
  The plugin server's `settings.json` is the shared copy (`useClaude`, `claudeTimeoutSec`); the page mirrors it into the
  two console settings keys. **Off is a real off**: the scripted matcher answers and nothing is sent to Claude.
- **How:** `web/flow.ts` asks `POST /understand` first (`web/claudeMode.ts`). `server/claude_intent.py` calls Claude
  through `axf.llm@1` with tools made from the catalog (`server/claude_tools.py`: the built-ins, the phrasebook and the
  40 best word matches, ≤ 64), and a system prompt: one command, fields only from what Brett said, ask for what is
  missing. A question or a confirm takes the floor and the answer goes back with `pending`. Confirms (destructive
  commands and the phrasebook's confirm entries) are a yes / no read on the server, no Claude call.
- **Fallback:** the setting off, approve / deny words, no AI assistant, a non-Claude model, a timeout, an error, out of
  credits, no pick or a refused pick → `{mode:'offline', reason}` and the same transcript goes to the scripted matcher
  and wizard. Mid-question it carries on as the scripted wizard with what Claude had. After a failure Claude is skipped
  for 60 s.
- **Approvals stay spoken:** approve / deny / reject / veto commands and the approvals group are never tools; those
  words never reach Claude; a Claude reply naming one is refused. Approvals keep the review and the approvals-banner relay.
- **Mode indicator:** a chip on the panel (Claude mode / Scripted / Offline mode, `data-axf-target="wake-listener.mode"`)
  and "· offline mode" on the mic light while Claude mode is on but Claude is away or the fallback took the last command.
- **History:** `history.jsonl` (newest 500): heard, command, reply, ok, mode (claude / scripted) and the fallback reason;
  older entries read as scripted. Panel *Command history* with an All / Claude / Scripted filter.

| Reach | Claude mode |
| --- | --- |
| Deep link | setting address `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=wake-listener/setting:axf.voice.useClaude`; console actions `wake-listener.show:claude`, `wake-listener.show:mode` (indicator), `wake-listener.show:history:claude` / `:scripted` (history filter) |
| REST | `GET /claude`, `POST /claude {useClaude?, timeoutSec?}`, `POST /claude/on`, `POST /claude/off`, `POST /claude/test {text}` (dry run), `POST /understand {text, pending?}`, `GET /state` (mode, claudeConnected, lastFallbackReason, offline, offlineReason), `GET /history?mode=` |
| MCP | `wake-listener_claude`, `_claude-set`, `_claude-on`, `_claude-off`, `_claude-test`, `_understand`, `_state`, `_history`, `_use-claude` (console action `voice.useClaude:on|off|toggle`), `_understand-test` (`voice.understand.test:<phrase>`), `_show`; control@1 `console.settings` path `axf.voice.useClaude` |
| CLI | `axf voice claude on|off|status|timeout <s>|test "<phrase>"`, `axf voice history [claude|scripted]` (`--local` for the store without a console); `axf wake-listener claude-on …` |
| Voice | "use Claude for voice", "stop using Claude for voice", "is Claude mode on" (AmberX: `wake-listener.heard:<phrase>`) |

## Checks

`node apps/console-web/plugins/wake-listener/test.mjs`, `python3 apps/console-web/plugins/wake-listener/test.py` (Claude mode, fake LLM), `node framework/cli/plugin-lifecycle.mjs check wake-listener`,
`node framework/cli/plugin-commands.mjs check wake-listener`, check-theme, check-controls, console `tsc`.
