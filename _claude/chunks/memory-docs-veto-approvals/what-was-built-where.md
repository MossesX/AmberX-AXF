<!-- memory-chunk@1 source=_claude/memory/docs/veto-approvals.md tokens=559 -->
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
