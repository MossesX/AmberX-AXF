# Agent voice (agent-voice@1) — Oct 29 2026

Brett: "Build plugin to give agents ability to speak with a full powerful per agent configuration console. Give it all
the bells and whistles a narrator should have. When a voice agent is selected a live status icon lights up on main
application and assistant window. Put microphone in Assistant window that when selected trip tooltip noting selected
agents name is missing permission unless plugin is not installed and it says so with links to install or hook to
install with agent. Allow powerful configuration of the microphone with integrated features and settings that don't
conflict with other listening events like those from notes and voice in amberx." Cards: Refactor profile; voices =
device + cloud, with hooks to its settings in many places. Orchestrator build `agent-voice` (refactor, Opus).

## Where it lives

`apps/console-web/plugins/agent-voice` — a console plugin targeting the console and web apps. (It also ran inside the
AmberX Android app until that app was retired on Nov 19 2026; the native speech bridge went with it.) Data in `.axf-console/plugins/agent-voice/`
(`store.json`, `keys.json`, `cache/`, all 0600 in a 0700 folder).

| File | What |
| --- | --- |
| `web/core.ts` | the contract, pure: `VoiceProfile` per agent, `MicSettings`, presets, `narrate()` (markdown → spoken chunks: headings, lists, tables, code blocks, links, numbers, emoji, emphasis, pauses, read modes, max length, intro/outro, pronunciations agent > global > built-in), `micGate()` (the mic tooltip), `interpretHeard()` (send / cancel phrases, spoken punctuation), `lightState()` |
| `web/lease.ts` | mic-lease@1: one microphone holder per page on `globalThis.__axfMicLease` |
| `web/engine.ts` | speech: Web Speech; cloud audio from the server; one queue with pause / resume / skip / stop, barge-in / queue / replace, fallback to the device voice, chime |
| `web/mic.ts` | the Assistant mic: takes the lease (waits `waitMs` or says who's busy), tap / hold / toggle, live text, silence + max time, barge-in |
| `web/console.tsx` | the per-agent console (Voice · Narrator · Permissions · Pronunciation · Try it) + settings panels (mic, cloud keys, global pronunciations, import/export) |
| `web/assistant.tsx` | slot renderers: `assistant.mic` (mic + missing-permission popover with one-tap fixes), `assistant.head` (live light + pause/stop), `assistant.reply` (say this reply) |
| `web/bridge.ts`, `web/light.ts`, `web/store.ts` | assistant events, the live light snapshot, the client store |
| `server/__init__.py` | profiles, mic, pronunciations, import, cloud keys (tested before saving, never returned), voices, `/tts` (OpenAI `gpt-4o-mini-tts` with a style / ElevenLabs with stability + similarity), audio cache (64 MB default). Cloud speech is refused unless the agent's profile allows cloud voices. |

## The Assistant seam (ai-assistant 0.2.2)

Generic, names no plugin: slots `assistant.head`, `assistant.mic`, `assistant.reply`; window events
`axf:assistant.agent` {window, agentId, agentName, open} (re-sent on `axf:assistant.hello`), `axf:assistant.reply`
{agentId, agentName, text, convId, viaVoice}, and in: `axf:assistant.input` {text, send, partial},
`axf:assistant.focus` {agentId}. Only the chat window used last takes input. With the `assistant.mic` slot empty the
assistant shows a stand-in mic (`ai-assistant/web/voicemic.tsx`): "Agent voice isn't installed …" + Install it
(plugins-menu / plugin-manager installer when present), "installed but off? Switch it on" (plugin switches) and
"Install it with <agent>" (a new chat with the selected agent).

## Never fighting over the microphone

- Every listener in the page takes mic-lease@1 first: dictation, Speak a command, recording a phrase, and the
  Assistant mic. A second one waits or says "<who> is using the microphone".
- The mic settings `pauseHandsFree` and `muteWakeWhileSpeaking` stay in the stored data but have no switch any more:
  only the retired AmberX app's native recognizer and voice honoured them.

## Live light

Banner `status` widget `status/agent-voice` (counter `agentvoice.live`, order 22, right): only while a voice agent is
selected (default), always, or never — Settings → Plugins → Agent voice → Live status light. Tones: ready = success,
speaking = accent, listening = warning, paused = neutral, error = danger. Tapping it opens that agent's voice page.
The same light (pulsing dot) sits in the Assistant title bar.

## Hooks to its settings

Plugins ▸ Agent voice (Agent voices…, Microphone & cloud voices, Stop), View ▸ Agent voices…, right-click on any page
(Agent voice…, Stop the agent talking), the banner light, the Assistant title-bar light and the mic popover
("<agent>'s voice settings"), search (actions), Settings → Plugins → Agent voice, and per agent `Talk to <name>`
actions (open the assistant on that agent and listen) for agents with Listen + the voice-command permission.

## Checks

`node --experimental-strip-types apps/console-web/plugins/agent-voice/test.mts` (22), `python3 …/agent-voice/test.py`
(37), ai-assistant `test.py` (143), console `tsc`, check-theme, check-controls, lifecycle checks, menu-reach.
