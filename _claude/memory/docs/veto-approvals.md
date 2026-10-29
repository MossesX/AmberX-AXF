# Veto approvals (veto@1), AmberX-AXF side

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
