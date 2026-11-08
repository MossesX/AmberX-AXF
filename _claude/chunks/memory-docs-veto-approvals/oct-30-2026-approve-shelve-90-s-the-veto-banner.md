<!-- memory-chunk@1 source=_claude/memory/docs/veto-approvals.md lines=56-83 tokens=662 -->
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
