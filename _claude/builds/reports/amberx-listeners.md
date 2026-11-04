# AmberX: one listener, no repeat "Note saved", no ding loop (Nov 1 2026)

Opus, one session. Branch `claude/amberx-listeners`. App: `apps/amberx-droid` (+ the console's veto banner plugin,
which AmberX loads). Codebase changes entry: `chg-20261101-dc8c8610d8`. Follows
`amberx-fix-loop-securescreen.md` (Oct 31): that fix was on main and in the installed APK, but the loop was still there.

## Result

- **"Note saved" loop: fixed and proven.** The cause is in Brett's own data: 125 notes saved by voice on Nov 1
  (180 since Oct 31), almost all of them AmberX hearing its own reply. Replayed with the real transcripts: before = one
  note said on purpose → **41 notes saved, "Note saved" spoken 41 times** (stopped only by the 40-round cap);
  after = **1 note, said once**.
- **Chrome "ding ding ding": fixed.** The web app was running hands-free (synced on from the phone) with a recognizer
  that restarted instantly; Chrome on Android plays its start "ding" every restart. Now a browser only listens when
  switched on for that browser, only in one tab, with backoff; and in a phone's browser it makes no sound by default.
- **New in Settings → Sound and microphone:** **Quiet** (kills all speech, tones and alarms at once, every device, and
  the Android service with the app closed), who speaks/rings on this device, **who holds the microphone**, and two
  per-browser switches (Sounds in this browser, Listen hands-free in this browser).
- Tests: AmberX `test.mjs` **2045 → 2101 checks, all pass** (56 new); veto banner `test.mts` 10 → 11.

**Install the new APK** once CI on main is green: the `android.yml` run for the merge commit builds it (job
*AmberX*, artifact **`amberx-debug.apk`**) and puts it in the app catalog bundle, which the Dev Console loads into the
hub's Apps catalog. On the phone: axHub → Apps → AmberX → install (or download the artifact from that Actions run).
The web app (amberx.amberxai.com) updates itself from main within ~5 minutes; reload any open tabs once (29 were open).

## Every listener in AmberX

| # | Listener / sound maker | Where | Speaks / dings? | Duplicated? |
|---|---|---|---|---|
| 1 | Hands-free service (Vosk wake listener + Google one-shot, or classic Google loop) | `WatchService.java`, `WakeListener.java` | hears; sends `wake` | no (one service) |
| 2 | `wake` event → page (`wakeInApp`, retained) and launch-intent wake (`deliver`, retained) | `AmberxNativePlugin.java`, `MainActivity.java` | triggers speech | **yes: replayed** (see cause 2) |
| 3 | Page `wake` / `heard` / `spoken` / `level` / `monitor` / `voiceSettings` listeners | `plugins/voice/web/index.tsx` | `say()` speaks | added with no removal (now keyed, 1 each) |
| 4 | `say()` → native TTS (`speak`, holdMic) | voice plugin → `AmberxNativePlugin.speak` | **speaks "Note saved to Inbox."** (notes `applyIntent` reply) | — |
| 5 | Notes intent: local parser, then the **AI parser for any sentence** | voice `handle()` → `notes/core.ts`, `ai/client.ts` | saves notes | — |
| 6 | Dictation tones (WebAudio) + its "Saved to Inbox." | `plugins/dictation/web/index.tsx` | tone + speech | no |
| 7 | Browser hands-free: continuous Web Speech, restarted on end | `native.ts` (web fallback) | **Chrome start "ding"** each restart | **yes: every tab, on top of the phone app** |
| 8 | Browser approval notices (monitor) | `plugins/monitor/web/index.tsx` | notification sound | every open tab |
| 9 | Veto banner: browser alarm (WebAudio/file) + browser notices | console `approvals-banner/web/veto.tsx`, `alarm.ts` | **alarm tones** | every open tab, in-memory "rang" list (reload re-rings) |
| 10 | Native veto alarm (alarm stream) + held-call notifications | `VetoAlarm.java`, `VetoAlerts.java` | alarm + notification | no (persisted rang ids) |
| 11 | Native approval alerts | `WatchService.alert` | notification | no |
| 12 | lib-hub SSE / polls (approvals feed, settings, notes store sync) | `axf/libs/hub*`, `notes/store.ts` | none (checked: no speech or sound on refresh) | — |
| 13 | Agent voice / Plan Studio speech (console plugins) | `agent-voice/engine.ts`, `plan-studio/voice.ts` | speak on use only | — (native `speak` now obeys Quiet) |

Brett's theory (two listeners for the same events) is half right: the web app in Chrome and the Android app each ran
their own hands-free listener, because the hands-free settings are synced through axHub
(`/projects/_shared/_data/settings/apps/amberx-droid.json`: `handsFree: true`, **`alwaysArmed: true`**). The repeats
inside the Android app were a feedback loop, not two subscribers.

## The exact cause of "Note saved" looping

1. **Always armed + the AI notes parser = every sentence in the room becomes a note.** With *Always armed* on, every
   final result with no wake phrase is a command; a sentence that isn't one goes to the notes path, and with the AI
   connected the AI parser turns *any* sentence into a note. AmberX then says **"Note saved to Inbox."**
2. **The mic hears that reply, mis-heard,** so the Oct 31 echo filter (exact copies, 0.8 s tail) let it through. From
   the hub's notes (`/projects/amberx-axf/_data/amberx-notes/items`), transcripts every ~6 s from 06:06 to 06:20 UTC:
   `no save ten bucks` (×60+), `no safety inbox`, `note save ten bucks`, `no safety bucks`, `tonight and saved inbox`…
   Each became a note ("Save ten bucks" ×63, "Safety" ×28) and each save said "Note saved to Inbox." again (a save
   counts as a change, so the repeat gate let it speak). That is the loop.
3. **Opening the app restarted it.** Android hands old wake events to the next page: `wakeInApp` used Capacitor's
   `retainUntilConsumed` (it keeps *every* event while the page isn't listening and replays them all when the page
   adds its listener), and `MainActivity.onCreate` re-delivered `getIntent()`'s wake sentence on every re-create and
   every open from Recents. So each open replayed sentences → saves → "Note saved" → the loop above.

No save loop through hub events: nothing reloads-and-saves on a data event (the notes store only reads on focus /
30 s and writes its own queue); the duplicates are real voice saves.

## The exact cause of the dings (web app)

- The synced hands-free + always-armed settings made **every amberx.amberxai.com tab run browser hands-free**.
- `native.ts` restarted Web Speech recognition **instantly** on every `end`. Chrome on Android plays its start ding
  every time; with the mic held by the AmberX app's service (the MIC-IN-USE icon), recognition ends immediately, so it
  restarted (and dinged) back to back. Hidden tabs stop, the visible one dings forever.
- Each tab also ran its own veto alarm and approval notices with an in-memory "already rang" list, so several tabs (29
  were open) and every reload could ring the same held call again.

## What changed

| File | Change |
|---|---|
| `src/listeners.ts` (new) | Pure core: `HandledIds` (persisted handled event ids), `eventVerdict` (replayed / stale > 20 s), `Subscriptions` (listeners keyed: re-binding removes the old one), `createOwner` / `electOwner` (one owner per device: Web Locks, else BroadcastChannel heartbeat), `soundAllowed` + `deviceSoundsDefault` (phone browser: off), `DingGate` (one ding per new id, never for empty/first read/replay, 8 s rate limit), `restartDelay` (recognizer backoff, give up after 12 quick ends). |
| `src/sound.tsx` (new) | Settings tab **Sound and microphone**: Quiet (synced), who speaks, mic holder (hands-free / mic lease / nobody), per-browser Sounds and Hands-free switches (device-only). Runs the owner election and publishes `globalThis.__axfSoundOwner` (sound-owner@1). Quiet → `native.quiet`, stop speech, stop alarm. App menu: *Quiet (stop all sound)*. |
| `src/plugins/voice/web/wakeflow.ts` (new) | The wake decision, pure: replay/stale → ignore; not owner → silent; echo (exact, mis-heard, or unprompted within 4 s) → ignore; marks sentences without a wake phrase as **unprompted**. |
| `src/plugins/voice/web/speechgate.ts` | `soundsLike` (letter-pair Dice ≥ 0.4 = echo), unprompted tail 4 s, loop guard (same sentence twice in 60 s → not a third time), save-loop breaker (3 unprompted saves in 60 s → unprompted saves paused 2 min, toast). |
| `src/plugins/voice/web/index.tsx` | `say()` silent unless `mayMakeSound()`; native listeners bound by key; wake → `wakeflow`; unprompted sentences **never go to the AI parser** and never get a spoken "Sorry, I don't know that one"; browser hands-free only for the owner tab with the per-browser switch on. |
| `src/native.ts` | `quiet()`; wake events carry `id` + `at`; browser recognizer backoff + stop on refused/busy mic. |
| `src/plugins/dictation/web/index.tsx` | Tones only when `mayMakeSound()`. |
| `src/plugins/monitor/web/index.tsx` | Browser approval notices through `DingGate` (persisted seen ids, owner only, a second within 8 s shows silently). |
| `src/App.tsx` | Installs `soundLibrary`. |
| `android/.../AmberxNativePlugin.java` | In-app wake hits not retained (dropped if the page isn't listening) and carry `id` + `at`; launch-intent wake carries its id/time; `quiet()` method; `speak` silent while Quiet. |
| `android/.../MainActivity.java` | Launch intent delivered once (`state == null`, not `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY`), extras stripped after delivery (`spent`). |
| `android/.../WatchService.java` | Wake intents carry `EXTRA_WAKE_ID` / `EXTRA_WAKE_AT`; approval alerts silent while Quiet. |
| `android/.../VetoAlarm.java`, `VetoAlerts.java` | No ring while Quiet (counted as rung); held-call notifications silent while Quiet. |
| `android/.../Quiet.java` (new) | The Quiet flag in SharedPreferences (`amberx.sound`), so the service obeys it with the app closed. |
| console `approvals-banner` 0.5.1 → 0.5.2 | `soundAllowed()` (sound-owner@1; the console has none = unchanged): only the owner tab rings or posts notices, ringing stops when it isn't allowed; rung ids kept in `localStorage` (`approvals-banner.alarmed`) across reloads and tabs. |

The mic: Android already lets go when hands-free is off (`listenLoop` → `stopListening`); the browser now releases its
recognizer and mic stream unless it is the owner tab with *Listen hands-free in this browser* on. Settings shows who
holds it. Note: Brett's synced settings still have **Always armed on**; with this fix it's safe, but he may want it off.

## Tests (fail before → pass after)

New in `apps/amberx-droid/test.mjs` (run against the pre-change code, the new checks fail or the module is missing;
the loop simulation is in the numbers above):

- one save by voice = exactly one "Note saved"; 40 mis-heard echoes (tonight's transcripts) save nothing; echoes 3.5 s
  later too; loop guard (third identical reply not said); save-loop breaker.
- open/resume ×10 with retained wake sentences: nothing runs, nothing is said; same id again = replay; > 20 s = stale.
- replayed events after a reconnect are silent.
- listeners: one per event after 20 register/resume cycles; all removed on clear.
- owner: two tabs → one owner; a third (lower id) tab → still one; owner closes → another takes over; web view owns.
- dings: phone with the app + two Chrome tabs → one ding per new approval; "All clear", refreshes, heartbeats, later
  reads, reopened tabs → none; rate limit.
- browser recognizer: backoff, gives up, a minute with the mic held elsewhere = 8 starts (was a restart per end).
- mic released when hands-free is off (browser + Android); Quiet wiring (web + Java); native replay wiring.

Checks run: AmberX `test.mjs` 2101/2101; `tsc --noEmit` clean (baked copy and freshly re-baked framework); `vite build`
ok (both); veto banner `test.mts` 11/11; console `tsc` no errors in the plugin; framework + amberx-droid validate;
project manifests; project fixtures; build steps (44); profiles; ui-review (91); check-theme; check-controls;
check-plugin-pages. Already red on a clean export of HEAD, not touched here: `tracker.mjs --check` (391 items without
a status) and `plugins.mjs --check` (asset-browser plan item). Plugin lifecycle for `approvals-banner`: see the commit
log entry (run on a clean export; the worktree's untracked session archive trips it locally only).

Java isn't compiled here (no JDK/SDK on this box): CI's `android.yml` builds it and the APK.

## Screenshots

UI Review → Screenshots, group **AmberX listeners - Nov 1**: Settings → Sound and microphone, phone
(`s-20261101-cb5d8074`, phone browser: sounds off by default) and desktop (`s-20261101-8ed3a892`).

## Notes and gaps

- Duplicate notes from the loop are still on the hub (it started Oct 29: "save ten bucks" ×52 since Oct 30, "safety"
  ×26…). **Dry run:** `amberx-listeners-notes-dryrun.md` = remove **122 of 206**, keep the oldest of each (84 left).
  Not deleted: a delete on the hub waits for Brett's go.
- An older APK sends wake events without ids: the page still applies the echo, unprompted and owner rules to them, but
  only the new APK stops the replay on open. **Install the new APK.**
- No orchestrator card / build-profile question: headless session, Brett asked for this fix directly.
