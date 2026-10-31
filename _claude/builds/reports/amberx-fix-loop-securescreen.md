# AmberX fix: voice loop + screen recording blocked (Oct 31 2026)

Headless fix build, Opus, one session. Branch `claude/amberx-fix-loop-securescreen`. App: `apps/amberx-droid`.
Codebase changes entry: `chg-20261031-d379147a2b`.

Rules were read from this checkout (`CLAUDE.md`, `_claude/shared/rules/RULES.md`, `_claude/rules/RULES.md`,
`_claude/THREADS.md`): the axHub `memory_read` call wasn't permitted in this headless session and `claude-sync` had no
token. Brett asked for this fix directly and is blocked, so it went ahead.

## Result

- **Voice loop fixed.** Empty states are never spoken, a sentence is said at most once per real change, the mic is held
  while AmberX talks, and anything the mic hears that is AmberX's own voice is dropped.
- **Screen recording works.** No FLAG_SECURE on any normal screen. New opt-in setting **Hide sensitive screens from
  recordings** (Settings → Account & security → Screen recording, **off by default**) hides the window only while a
  password / key / vault field is on screen.
- Tests: AmberX `test.mjs` **1996 → 2037 checks, all pass** (41 new). `tsc --noEmit` clean, `vite build` ok,
  framework + app asset validation, theme check and project manifests all pass. The Java side compiles only in CI
  (no JDK/SDK here): CI's `android.yml` builds the new APK.

## Not pushed yet (land attempt, Oct 31 2026, late)

Second session, to land it. Done:
- Merged `origin/main` (f7170f65, #217 build profiles registry) cleanly → merge commit `c9a80e50`.
- Retested after the merge: AmberX `test.mjs` **2037/2037**, `tsc --noEmit` clean, `check-theme` ok, `check-controls`
  ok, framework + amberx-droid validate ok, project manifests ok, `check-profiles` ok, `check-build-steps` 44 ok,
  plugin lifecycle ok on every lifecycle plugin (clean export of HEAD; the worktree's untracked session archives and
  gitignored `_claude/shared` copies trip it locally only). `tracker.mjs --check` fails the same way on `origin/main`
  itself (391 items without a status), so it isn't from this merge and was left alone.

Blocked: both pushes failed again, same error:

```
$ git push origin HEAD:main
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/MossesX/AmberX-AXF.git/'
```

(`git push origin HEAD:refs/heads/claude/amberx-fix-loop-securescreen` → same.) No other token on the VPS; axHub
tools are denied in headless sessions. A console banner item ("VPS GitHub token is invalid: pushes blocked") was
raised. To land: new token (github.com → Settings → Developer settings, `repo` + `workflow`) →
`gh auth login -h github.com` → in `/root/axf-builds/amberx-fix`: `git fetch origin && git merge origin/main`,
`npx -y tsx apps/amberx-droid/test.mjs`, `git push origin HEAD:main` and push the branch. CI builds the APK.

## Bug 1: the voice loop ("no saved inbox / no saved notes" over and over)

### What was wrong

Three things together made a loop between the speaker and the mic:

1. **`say()` never held the mic.** `src/plugins/voice/web/index.tsx` called `native.speak({ text, lang })` without
   `holdMic`, so hands-free kept listening while AmberX talked.
2. **Android's `speak` returns as soon as speech starts** (`AmberxNativePlugin.speak` resolves right after
   `tts.speak`). So `await say(...)` didn't wait: "Yes?" was followed by listening at once, and dictation's
   "Saved to Inbox." was followed 350 ms later by the next dictation.
3. **Classic hands-free ignored the mic hold anyway.** `WatchService.appMic(true)` only restarted the loop in wake
   mode; in classic mode Google's recognizer kept running until its next result.

So the mic heard AmberX's own reply ("Nothing in Inbox.", "There's no list called notes.", "Saved to Inbox."), took
it as the next command or the next dictated note, and AmberX answered again. The notes replies for an empty store are
all empty states (`Nothing in Inbox.`, `Nothing in Voice notes.`, `Nothing found.`, `There's nothing to remove.`), and
dictation's "Saved to Inbox" plus "Save and dictate another" could write its own reply down as a note.

No poll or refresh speaks on its own (checked: monitor, approvals, AI badge, notes store sync); every spoken line comes
from `say()`, the command runner (through `say`), the voice wizards (through `say`) or dictation (direct
`native.speak`, now through `say`).

### Files touched

| File | Before | After |
| --- | --- | --- |
| `src/plugins/voice/web/speechgate.ts` (new) | — | Pure speech gate: `isEmptyState`, `shouldSpeak` (empty states never; same sentence within 30 s dropped unless `asked`/`change`), `markSpeaking`/`markDone`, `isEcho` (while talking, 0.8 s after, or a copy of a sentence said in the last 15 s). |
| `src/plugins/voice/web/index.tsx` | `say()` = `native.speak({ text, lang })`, fire and forget on Android | `say(rt, text, opts)` goes through the gate, sends an utterance `id` and `holdMic: true`, and waits for the `spoken` event (or a length estimate) before returning. `askAloud` and "Yes?" pass `asked: true`; notes replies pass `change: r.changed`. The `wake` and `heard` listeners drop AmberX's own voice (`heardEcho`). New `spoken` listener. |
| `src/plugins/dictation/web/index.tsx` | `void native.speak({ text: msg })`, then `start()` again at once | `say(rt, msg, { change: true })`, and "dictate another" starts only after it was said. A dictated turn that is AmberX's own voice counts as empty. |
| `android/.../WatchService.java` | `appMic(true)` restarted only the wake loop | Classic mode: `appMic(true)` cancels the running recognizer and re-checks every second until the mic is free. |

### Before / after

- Before: Inbox empty, hands-free on (always armed or classic) → "Nothing in Inbox." → mic hears it → "Nothing in
  Inbox." → … forever. After: "Nothing in Inbox." shows in the conversation log, nothing is spoken, and even a spoken
  reply can't be heard back as a command.
- Before: dictation "Save and dictate another" → "Saved to Inbox." gets dictated as the next note. After: the next
  dictation starts after the reply ends, and an echo is dropped.
- Test: `speech gate: a repeated empty refresh speaks nothing` reads the empty Inbox, Voice notes, a missing list, a
  search and a remove ten times a minute apart (past the repeat window): 0 spoken.

## Bug 2: "can't record due to security policy"

### What was wrong

`MainActivity.onCreate` set `FLAG_SECURE` on AmberX's only window ("approvals and hub pages are never captured"), and
`HubWebActivity` did the same. With it, Android refuses screenshots and screen recording on every AmberX screen, and
AmberX's own screen recorder (Audio Extract, MediaProjection) records AmberX as black.

### Files touched

| File | Before | After |
| --- | --- | --- |
| `android/.../MainActivity.java` | `addFlags(FLAG_SECURE)` always | `SecureScreen.apply(this, SecureScreen.sensitive)` on create and resume: clear unless opted in and sensitive. |
| `android/.../HubWebActivity.java` | `addFlags(FLAG_SECURE)` always | `SecureScreen.apply(this, true)`: hidden only when the setting is on (the page can be the hub sign-in). |
| `android/.../SecureScreen.java` (new) | — | Setting in SharedPreferences `amberx.secure` (`hideSensitive`, default false); `apply()` sets or clears FLAG_SECURE. |
| `android/.../AmberxNativePlugin.java` | — | `secureScreen({ hide, sensitive })` plugin method. |
| `src/native.ts` | — | `secureScreen` in the API; browser fallback does nothing. |
| `src/securescreen.ts` (new) | — | Setting **Hide sensitive screens from recordings** (Account & security, off by default); a MutationObserver reports a sensitive screen while `input[type=password]` or `[data-amberx-sensitive]` is on the page (AI keys / tokens use password fields), debounced, one native call per change. |
| `src/App.tsx` | — | Installs `secureScreenLibrary`. |

### Before / after

- Before: Android screen recorder and screenshots blocked on every AmberX screen; Audio Extract's recorder got black
  frames of AmberX. After: both work everywhere by default.
- With the setting on: only screens showing a password / key field (and hub pages) are hidden; everything else stays
  recordable.

## Tests added (`apps/amberx-droid/test.mjs`)

Speech gate (empty refresh silent, empty-state list, repeat once, real change said, questions repeat, echo while
talking / just after / copy of its sentence, new commands and short answers still heard), the wiring (gate + holdMic,
echo filters, `say()` the only speaker, dictation through the gate, classic mic hold), and screen capture (off by
default, on + normal = recordable, on + password = hidden, no FLAG_SECURE left in MainActivity / HubWebActivity,
native method present, App installs it).

## Known gaps

- Java not compiled here; CI (`android.yml`) is the compiler.
- UI Review: one new settings toggle; no phone screenshots could be taken in this headless session, so it is not
  submitted to UI Review yet.
- The Android TTS `holdMic` is released the moment the TTS queue empties; the 0.8 s echo tail in the page covers room
  echo after that.
