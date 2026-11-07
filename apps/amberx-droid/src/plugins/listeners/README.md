# Listeners (AmberX plugin)

The control panel for every background listener in AmberX (listener@1, `framework/libs/listeners`). Built Nov 6 2026
(Fable, build `gizmo-rebuild-fable`) after Brett: "I need more powerful controls over the background listeners for
AmberX. I've had problems with the microphone... it's crashing with other apps, and sometimes it'll just do that sound
over and over."

## What it shows

One row per listener, on the phone and in the page:

| Listener | Where | What it is |
| --- | --- | --- |
| Hands-free (wake word) | phone | the silent Vosk wake listener, or the classic Google loop (`WatchService`) |
| Command after the wake word | phone | the one Google utterance after a wake phrase |
| Speak button | phone | one utterance when you tap Speak / push to talk |
| Gizmo talk mode | phone (`TalkService`) / browser | the conversation that keeps going with the screen off |
| Recorder microphone | phone | the Audio Output Recorder's opt-in mic track |
| axHub watch | phone | the approvals feed poll |
| Veto alarm | phone / page | the alarm for held commands |
| Hands-free in this browser, Dictation, Speak a command, Assistant microphone, Voice notes | page | the mic lease holders |

Each row: a state chip (Listening · Paused: a call is using the microphone · Paused: another app is using the
microphone · Stopped: <reason> · Not allowed), **Has the mic**, the retry count, the last error with its time.

## Controls (per listener, app settings synced through axHub)

| Setting key | What |
| --- | --- |
| `amberx.listeners.<id>.on` | allowed at all (off = it never opens the mic or runs, on any device) |
| `amberx.listeners.<id>.pauseOnCall` | let go while the phone rings or is in a call (phone or VoIP), come back after |
| `amberx.listeners.<id>.pauseForOtherApps` | let go while another app records or takes audio focus, come back after |
| `amberx.listeners.<id>.sound` | the start tone, only for a start you asked for (restarts and resumes are always silent) |
| `amberx.listeners.<id>.retries` | quick failures in a row before it gives up: 0, 3, 6 (default), 10 or -1 (keep trying, backing off to 30 s) |

Plus **Restart now** (allowed off → on on the native side) and *Show this device in the Dev Console* (publishing).

The native side gets every policy at once (`native.listenerSet`) and keeps it in prefs, so the services obey it with
the app closed; the console changes the same keys on the hub's settings document and lib-hubsync brings them here
(on focus, and every minute while the panel is open).

## What the rules do (framework/libs/listeners, Android `ListenerRules.java`, same `cases.json`)

- **Restarts back off and give up:** a listener refused at once (another app has the microphone, the recognizer is
  busy, no audio) waits 1 s, 2 s, 4 s… (cap 30 s) and after `retries` quick ends in a row stops in state *error* with
  the reason, then tries once more cold a minute later. Silence restarts at once. No permission never restarts.
- **Silent restarts:** the start sound plays only for a start the person asked for.
- **Yield:** a call, Android silencing AmberX's recording, another app recording or taking audio focus → the mic is
  let go (by policy) and comes back after it has stayed free for 3 s.
- **One owner of the mic:** talk mode > Speak > the mic lease holders > the wake-word command > hands-free > the
  recorder mic (`MicGuard.acquire`); the lower one pauses and comes back.

## For the Dev Console

The phone publishes `listener-state@1` (`deviceDoc`) to the hub table `amberx-axf/_data/listeners/devices` (one row
per device, every few minutes and on every change); the console's `amberx-listeners` plugin lists every device and
changes the policies on the hub (REST `/api/plugins/amberx-listeners`, MCP `amberx-listeners_*`, CLI
`axf amberx-listeners …`).

## Tests

`npx -y tsx apps/amberx-droid/test.mjs` (the plugin's pure core + wiring), `npx -y tsx framework/spec/check-listeners.mts`
(the shared rules), `./gradlew :app:testDebugUnitTest` (`ListenerRulesTest` on the same cases).
