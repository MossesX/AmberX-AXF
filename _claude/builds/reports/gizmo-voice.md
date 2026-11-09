# Gizmo voice in AmberX: talk mode starts, listens and doesn't hear itself (`gizmo-voice` + `amberx-voice-echo-fix`)

Brett, Nov 7 2026: "Gizmo inside AmberX won't turn on / isn't listening." (urgent run of `gizmo-voice` s3 and
`amberx-voice-echo-fix` s1–s3). Brett, Nov 5 2026 (echo fix): "Echo fix … how do I make it so I don't have to keep
cooking the mic to talk to you".

Opus 5.5, one session, branch `claude/gizmo-voice-fix`, change-log entry `chg-20261107-b51fb218b7`. The stopped
`claude/gizmo-voice` worktree had no unlanded code: its s1 + s2 (TalkService, talk.ts on the service) had already
landed with `gizmo-rebuild-fable`.

## Why Gizmo didn't start or listen

1. **Talk mode paused itself on every turn.** Since the Nov 6 rebuild `TalkService` held audio focus for the whole
   session and paused ("Paused: another app is using the microphone") on *any* focus loss. Google's speech recognizer
   asks for transient focus itself as it starts listening, so every turn it opened took focus from AmberX: pause →
   recognizer closed → focus back → resume 3 s later → pause again, forever. Nothing was ever heard.
2. **"Hey Gizmo" / "talk to Gizmo" was cancelled before it heard a word.** The one-shot after the wake phrase in
   `WatchService` had the same rule (`cancelOneShot()` on any loss), so the command never arrived.
3. **After that, hands-free stayed paused for good.** The one-shot gives its focus back when it ends, so no
   `regained` ever came and `focusLost` stayed true: hands-free kept yielding "for another app" until the app restarted.

## Why Gizmo heard himself (echo)

4. **Gizmo's speech bypassed the speech gate.** The companion called `native.speak` directly, so the voice plugin's
   gate (the thing that knows "that's my own voice") never saw what Gizmo said: hands-free, dictation and the notes
   parser could take his reply as a command or a note, and talk mode's echo test only knew AmberX's own lines.
5. **Outside talk mode his speech didn't hold the mic** (with "stop when I talk over Gizmo" on), so hands-free kept
   listening to him read a reply aloud.
6. **"Note saved to Inbox." parsed as a new note** ("note" + text "saved to inbox") whenever the echo filter's clock
   had run out: the Nov 1 loop could still happen with a late echo.

## What changed

- **FocusRules** (new, pure Java, `FocusRulesTest` 4 tests): a focus loss lets go of the mic only for a call or another
  app's recording (by policy), never for AmberX's own recognizer or voice, nor an app that only plays sound.
  `TalkService` and the `WatchService` one-shot use it, look again 0.8 s after a loss, and a paused talk mode resumes
  once nothing really wants the mic. `focusLost` is cleared when the one-shot gives its focus back.
- **TalkService**: the interrupt listener never mutes media while Gizmo's voice plays there ("silence-all" phones);
  a refused start still calls `startForeground` first, so Android can't kill the app for a service that never went
  foreground.
- **Gizmo's voice is in the speech gate**: every sentence goes through `markOwnSpeech` / `markOwnSpeechDone` (voice
  plugin), and outside talk mode it holds the mic (hands-free steps aside while he talks).
- **Talk-mode judge** (`judgeHeard`, companion `core.ts`, pure): while Gizmo talks only a stop word that isn't his own
  words stops him; after he stops, his voice within 1.5 s or a close copy (letter-pair likeness ≥ 0.75) is dropped and
  everything else is Brett's next message. The old 0.4 bar would have dropped real follow-ups ("what's in the merge
  queue" after "it's in the merge queue now" scores 0.55; echoes score 0.89+). Hands-free keeps its 0.4 bar.
- **Speech gate**: `isEcho` takes `content` (words only), `like` and `tail`; `TALK_ECHO_LIKE`, `TALK_TAIL_MS`.
- **Notes**: `isOwnReply` recognises AmberX's own notes replies (saved / moved / removed / renamed / made / already
  there); `parseIntent` never parses one, and the voice plugin drops it before commands and the AI notes parser.

## Tests

- `npx -y tsx apps/amberx-droid/test.mjs`: 2259 → **2316** checks, all green. New: own replies never parse (11) and
  real commands still do (6); a replay of "Note saved to Inbox." into the listener 12 times, in and past the echo
  window, still leaves one note; the conversation echo bar; the judge (8 cases); a whole talk turn replayed (Gizmo's
  reply heard while talking, just after and 3.5 s later mis-heard = nothing sent, no self-interrupt; Brett's follow-up
  sharing his words is sent); Android wiring.
- `FocusRulesTest` (JUnit, 4) run in a JDK 17 container; `ListenerRulesTest` etc. unchanged. `tsc --noEmit` clean.
- Not run here: Gradle `:app:testDebugUnitTest :app:assembleDebug` (no Android SDK on the VPS; CI's AmberX job builds
  and tests it).

## How Brett gets it

- **Web half** (talk.ts, speech gate, notes, voice): the AmberX shell loads the hosted site, which updates from main
  every 5 minutes. Once the PR lands, close and reopen AmberX.
- **Native half** (TalkService, WatchService, FocusRules): needs the new APK. CI's AmberX job builds
  `amberx-debug.apk` on the PR and on main; after the merge it is in the app catalog (Dev Console / axHub → Apps →
  AmberX → Download), or the `amberx-debug.apk` artifact of the Android CI run. Install over the old one (same
  signing key, settings kept).
- **Phone test** (gizmo-voice s3, Brett's): open Gizmo → Talk mode, say something, wait for the spoken reply, say
  something else; screen off mid-conversation; say "stop" while he talks; say "hey AmberX, note buy milk" and check
  only one note is saved.

## Known gaps

- The focus fix can't be proven on a phone from here: the evidence is the code path (Google's recognizer requesting
  transient focus) and the tests of the rule. If talk mode still pauses, Settings → Plugins → Listeners shows the
  reason on the `talk` row.
- An echo mis-heard badly enough to score under 0.75 and arriving more than 1.5 s after Gizmo stops still reaches him
  as a message (rare: his TTS voice is clear).
