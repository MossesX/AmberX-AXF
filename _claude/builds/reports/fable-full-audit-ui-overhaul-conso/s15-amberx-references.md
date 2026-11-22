# s15: stale references to the retired AmberX app

Build `fable-full-audit-ui-overhaul-conso`, step s15 (Opus). The AmberX Android app (`apps/amberx-droid`) was removed
on Nov 19 2026 (commit ba07bfa0b, report `remove-amberx-app-code-once-phone.md`). That change cleared the app, its CI
job and every app list. This step cleared what it left behind in live code and copy. The AmberX brand, the
`ai.amberx.axf.*` ids and the AmberX AXF framework name stay.

## Removed (dead code)

| Where | What | Why |
| --- | --- | --- |
| `agent-voice/web/engine.ts` | The `AmberxNative` Capacitor bridge: native TTS, voice list, `spoken` listener and its wait map; `amberxNative()` and `isAmberX()` | Only the AmberX shell provided `Capacitor.Plugins.AmberxNative`. The console Android app (`apps/console-droid`) has no Capacitor, so the branch could never run. |
| `agent-voice/web/mic.ts` | Native `listen()` loop and native mic-permission query | Same bridge |
| `agent-voice/web/index.tsx`, `engine.ts` | `SpeakJob.holdMic` | Only the native voice read it |
| `agent-voice/web/console.tsx` (+ help entry) | Switches "Hands-free listening steps aside while this listens (AmberX)" and "Hands-free can't hear the agent's voice as a command (AmberX)" | Nothing reads them now. The fields stay in `MicSettings` so stored settings still load. |
| `plan-studio/web/voice.ts`, `plan-studio-2/web/voice.ts` | `nativeVoice()` listen and speak branches | Same bridge. Web Speech and agent-voice@1 paths are unchanged. |

## Reworded (user-visible copy that named the AmberX app for work Phone Connect does now)

- Claude badges: the phone badge says "No phone is paired" / "The phone is offline" / "The phone is connected". The
  classifier still matches axHub's own `amberx.recorder_status` wording.
- Notifications (notify-control): the `amberx` channel, app and group labels say Phone / Phone Connect, and
  "Checked by the AmberX app" now says "Checked on the phone". The ids are unchanged (stored switches).
- Systems check: the push-path item is "Push to the phone", and its summaries name Phone Connect.
- Console commands: "Wake the console through your phone…" and "Browser the phone opens". Help targets were renamed
  to match.
- Build watchdog: "Tell the phone what was cleaned" and "one phone push per pass". Help target renamed.
- Approvals banner settings, Claude settings (notifications, recording), console help (countdown pushes).
- Claude handoff default rules: "Android work is on hold except Voice Vault app code" (it said "…and AmberX app code").

## Docs and comments

- `apps/console-web/plugins/README.md`: dropped "also in AmberX" from both Plan Studios. The AmberX listeners line
  now says no device publishes rows since the retirement.
- `agent-voice/README.md`: the AmberX native and microphone sections were rewritten for the web-only plugin.
- `lease.ts`, `src/plugins.ts`: dropped pointers to files that were deleted.
- `notes-tasks/DESIGN.md`, `_claude/plans/axhub-vault-management.md` (+ the shared notes copy): a dated note that the
  AmberX parts are history.
- `deploy/claude-login-notify.mjs`: comment wording.

## Kept on purpose

- History: `changes/`, `_claude/builds/shipped`, `_claude/builds/reports`, `sessions/archive`, THREADS, build-breaker
  asks, plan data, the What's shipped labels and the shipped-features classifier. These record what happened.
- `_claude/handoff/*`: a dated generated snapshot (Oct 27). Regenerating it is a separate job.
- Data and protocol: phone-connect@1 migrated `amberx-droid` records, `settings/apps/amberx-droid.json`, the `amberx.*`
  axHub tool aliases and the `amberx` notification ids.
- The `amberx-listeners` plugin. It reads rows only the AmberX app published, so it shows nothing new. Removing it is
  a feature removal, and it is the console side Phone Connect would publish listener@1 into. Left for Brett to decide.
- `framework/libs/*` comments that mention AmberX's Java twins (`ListenerRules.java`). These files are baked into
  four apps. Changing a comment means a re-bake, which isn't worth it for a comment. Fix them with the next real
  library change.
- The systems-check "AmberX app backups" item. `/opt/amberx-app` is still on the VPS.

## Checks

agent-voice `test.mts` 22, plan-studio 27, plan-studio-2 17, build-orchestrator 35, console-commands 11 + server 141,
claude-badge 73, notify-control 133, systems-check 231, claude-handoff 82 + 95: all pass. check-theme, check-controls
and check-toolbars pass. Help coverage is back at 100%: the now-static "Device voice" tab got a help entry. Plugin
lifecycle is clean for every touched plugin. Console `tsc`: the only error is the git-ignored generated
`src/control/inventory.json`, which is missing from this worktree and was not caused by this change.

UI Review: none submitted. The visible changes are wording plus two switches removed from Agent voice → Microphone.
No console was running in this headless worktree to capture them. The lander should take desktop and phone shots of
Agent voice → Microphone, Console commands settings and the Claude badges before the PR is called ready.
