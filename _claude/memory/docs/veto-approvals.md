# Veto approvals (veto@1), AmberX-AXF side

(Updated Oct 30 2026: see the last section for Approve, Shelve, 90 s and the alarm.)

Brett, Oct 28 2026 21:35 EDT: "Change approval system: Claude sends a command request to the VPS through Vinnie on
axHub. Vinnie sends a notification through the AmberX Android app that waits 3 minutes before running the command in
the AmberX terminal through Vinnie. After the 3-minute countdown appears on the approval page and in a banner in the
console — but instead of an Approve button I can Deny it and stop it from running before time is up. Put a setting in
AmberX to configure the notification sound and vibration, and the notification sound for time running out and for
running. When the timer starts, open a tab in the AmberX terminal with the countdown before running."

Built on branch `refactor-all/veto` (refactor-all steps s83–s86, group veto-approvals, Opus). The hub side (axHub repo,
branch `claude/veto-approvals`) holds, counts down, runs and streams the call; this repo shows it and lets Brett deny it.

## The contract this side reads (veto@1)

- Feed `GET /auth/api/approvals` and legacy `/auth/admin/approvals.json`: a held call is in `pending` with
  `status: "held"`, `veto: { runsAt, secondsLeft, countdownSeconds }`, `jobId`, `denyUrl`, `streamUrl`; also in `held[]`
  with `heldCount`. The explain layer (`/auth/api/approvals/<id>`) carries `status: "held"` + the same `veto`.
- Deny: `POST /auth/api/approvals/<id>/deny` (admin session + hub Origin + `X-AxHub-CSRF`).
- Stream: `GET /auth/api/jobs/<jobId>/stream` (SSE `countdown {secondsLeft}`, `state {state}`, `output {stream, text}`,
  `done {state, exitCode}`).
- Push: `{ type: "veto", phase: "held"|"warning"|"running", id, jobId, title, command, runsAt, secondsLeft, denyUrl,
  streamUrl, approvalUrl }`.
- States: held → running → ran | failed; denied; expired.

## What was built, where

| Piece | Where |
| --- | --- |
| Parser + client (web) | `framework/libs/hub/veto.ts` (baked into amberx-droid, console-web, axhub-web `src/axf/libs/hub/veto.ts`): `interpretVeto`, `splitFeed`, `fetchVetoFeed` (same read rules as `fetchHubFeed`), `secondsLeftNow` (local clock), `vetoPhase` (30 s warning), `notifyPlan`, `vetoFromPush`, `vetoEvent` + `followVeto` (SSE), `denyVeto` (hub-origin pages). `hub.ts` is unchanged. Kotlin twin deferred (PORTING.md). |
| AmberX notifications (s83) | Plugin `apps/amberx-droid/src/plugins/approvals` (store, settings, browser notifications + tones). Shell: `android/.../VetoAlerts.java` (one channel per phase made from the chosen sound + vibration; one card per call with a live countdown and a **Deny** action; warning and running scheduled at their local times; Deny posted with the phone's hub session), `HubRules.vetoes` / `deny`, `WatchService.check` (reads every 10 s while something is held), `native.ts` `vetoSettings` / `vetoDeny` / `vetoTest` + `veto` events. Held calls are never shown as approvals and never auto-approved on the phone. |
| AmberX settings | Settings → Plugins → **Approvals**: timer-started sound, vibration, time-running-out sound, running sound (Android: notification default / alarm / ringtone / silent; browser: tones), each with **Test**; "Open a terminal tab when a timer starts". |
| AmberX Terminal (s84) | `plugins/approvals/web/terminal.tsx`, nav → **Terminal**, action `approvals.terminal[:<id>]`: a tab per held call with title, command, countdown, Deny; output from the job stream when it runs; final state kept until closed. The console's Terminal plugin is a PTY on the console server, so it isn't installed in AmberX. |
| Console banner (s85) | `apps/console-web/plugins/approvals-banner` 0.3.0: held rows with countdown + Deny (no Review/Approve); Deny/tap opens the call's page on the hub in the review dialog. |
| AXHub web app (s85) | `apps/axhub-web/src/views/HeldCall.tsx`: countdown + Deny on the first screen of `ApprovalDetail` (in place of the actions; re-reads every 3 s) and in the grid row's header; no Approve. |
| Rule (s86) | `_claude/shared/rules/RULES.md`: "Veto calls are sent once and never polled". |

## How to test

- `npx -y tsx apps/amberx-droid/test.mjs` (veto block: feed split, links, countdown, notify plan, push, stream, deny, alert config, store).
- `cd apps/amberx-droid && npm run build`; `cd apps/axhub-web && npm run build`; `cd apps/console-web && npm run typecheck && npm run build`.
- `node framework/cli/check-theme.mjs`, `node framework/cli/check-controls.mjs`.
- Android (CI): `HubRulesTest.heldVetoCalls`; on the phone: Settings → Plugins → Approvals → each Test button plays its
  channel; send a held `vps.run` through axHub and check the three notifications, Deny from the notification, and the
  Terminal tab.
- Browser: open AmberX, allow notifications, Test buttons play tones; a held call opens a Terminal tab.

## Known gaps

- AmberX has no push transport yet (the phone polls the feed); `vetoFromPush` is ready for it.
- AmberX's own Approvals page, the monitor's in-browser alerts and lib-hub `fetchHubFeed` still count a held call as
  waiting (hub.ts unchanged; filtering there is a cross-port contract change).
- Deny from the console or a browser opens the hub page (the hub accepts a Deny only under its own Origin).

## Oct 30 2026: Approve + Shelve, 90 s, the veto banner owns notices, screen and alarm (orchestrator `veto-everywhere` s5–s9)

Brett (voice, Oct 30 2026): countdown 90 s; the veto notices, Deny screen and alarm belong to the veto banner plugin so
they work in any app it is installed in (AmberX included); a configurable alarm; tapping a phone notice opens a screen
with the countdown and Deny / Approve / Shelve, and the notice carries those buttons too; Approve = run it now (no more
notices), Shelve = pause the countdown until he approves or denies.

- **axHub** (decision #104, branch `claude/veto-complete` on #103): `POST /auth/api/approvals/<id>/approve-now` and
  `/shelve` (same guards as Deny), `veto.state: "shelved"`, `veto.actions`, `approveNowUrl`, `shelveUrl`; pushes add
  `shelved` + `cleared` phases and `actions`; CLI `confirmations approve-now|shelve`; default countdown 90 s. The AI
  client can never approve, hurry or shelve (the bearer token never reaches `/auth/api`).
- **lib-hub `veto.ts`**: `VetoCall.shelved / approvedNow / actions`, `actionsOf` (no actions = Deny only, an older
  hub), `vetoActionUrl`, `vetoAction` (hub-origin pages), `runVetoAction` (host → hub origin → open the hub page),
  frozen countdown while shelved, no notices for shelved / approved calls, push phases `shelved` / `cleared`, and the
  **host seam** `setVetoHost` (an app's native side: act with its session, alarm, notification events).
- **Veto banner plugin** (`apps/console-web/plugins/approvals-banner` 0.4.0, `targets`: console + `amberx-droid`):
  banner rows with Deny / Approve / Shelve, the **veto screen** dialog `approvals.veto`, browser notices (unless the
  host raises them), the **alarm** (`web/alarm.ts`: tone list + his own file, volume, louder over time, ring length,
  repeats + gap, vibration, start point in the countdown, through silent mode) with Test / Stop; self-test `test.mts`.
- **AmberX**: `src/native.ts installVetoHost` (called from `main.tsx`); shell `VetoAlerts.java` cards with Deny /
  Approve / Shelve (tap = veto screen), shelved card, `HubRules.act`; `VetoAlarm.java` plays the plugin's alarm on the
  alarm stream (USAGE_ALARM / STREAM_ALARM) so it rings through silent mode. AmberX's own plugin `approvals` is now
  just the Terminal view (0.2.0); its old sound settings are gone (the alarm replaces them).
- **AXHub web app**: `HeldCall.tsx` shows Deny / Approve / Shelve and "Shelved".

Gaps: the alarm settings are per app (the console's and AmberX's are separate settings stores); the phone rings only
while the watch service runs (Monitor on); Kotlin lib-hub twin still deferred (PORTING.md).
