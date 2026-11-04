# urgent-approval-popup-crash — report (Nov 4 2026)

## Brett said (verbatim)
> "The pop-up approval is blank." ... "Why is the approval pop-up dialog just showing the sad face?" ... (after reloading) "Damn, sad face again."

## Root cause
1. **The pop-up framed axHub, and axHub refuses to be framed by the console or Molly.** On the console (and the console
   inside Molly) there is no host that can sign a decision, so a tap on Approve / Deny took the `frame` route:
   `HubFrame` loaded `https://axhub.amberxai.com/auth/admin/approvals/<id>` in an iframe. axHub's CSP is
   `frame-ancestors https://patches.amberxai.com https://amberx.amberxai.com`, so the browser blocks the frame and draws
   its own error page: blank in Chromium, the sad-face icon on phone Chrome. Reproduced in Chromium (Pixel 7 viewport):
   `Framing 'https://axhub.amberxai.com/' violates the following Content Security Policy directive: "frame-ancestors
   https://patches.amberxai.com https://amberx.amberxai.com". The request has been blocked.`
   ([screenshot](urgent-approval-popup-crash/before-refused-frame-phone.png)). On Android the blocked page still fires
   `load`, so the 8 s "stuck → Open on axHub" fallback never kicked in: the sad face stayed. The lib-approvals host
   already had a `frame` flag for exactly this (the hub frames only for the origins it lists); follow-amber ignored it.
2. **The console was down (503) at 15:25–15:45.** The 15:25 auto-update (merge of #296) died part way after removing the
   old `axf-console` container; the next 5-minute tick saw "main unchanged" and exited, so it stayed down. Fixed now by
   re-running the installer (container up 15:51, wall answers 401 again), and the update script now retries a failed run.

## Fix
- `follow-amber/web/core.ts`: new `open` route. A decision is framed only when the host says the hub frames this origin
  (`approvalsHost().frame`); otherwise the tap opens axHub's page (host `open`, else a new tab) and says so. No refused
  frame in the pop-up any more.
- `drawable()`: every field the pop-up draws is forced into shape (a reason object where a title string belongs, missing
  decisions, a junk `veto` / `source`): it shows the raw call with Approve / Deny.
- `ApprovalBoundary`: if the pop-up still throws, it shows "Couldn't draw this approval" with the raw call and
  Approve / Deny / Open in axHub instead of a broken dialog (error logged to the browser console).
- Lazy loader (`src/pluginLoader.tsx`, `src/lazyEngine.ts`): a chunk-load error is retried once; if it fails again (the
  console was redeployed under the page) the loader is marked stale and a "New version, reload" notice shows (also on
  Vite's `vite:preloadError`); the plugin's own error note gets a "Reload for the new version" button.
- `framework/deploy/axf-deploy.sh` `axf_update_script`: a run whose status is `failed` runs again on the next tick even
  when main hasn't moved.

## Tests
- `plugins/follow-amber/web/check.mts`: 11 → 13 checks (routes now `open` unless framed; open-only hosts; regression with
  vps.run / control_add / build_start held-call shapes plus hostile fields).
- `scripts/lazy-loader-check.mts`: 11 → 12 (one retry, then give up; code bugs not retried).
- `framework/deploy/test.sh`: 43 → 45 (retry after a failed run, then quiet again).
- `tsc --noEmit` (console) clean; `check-theme.mjs`, `check-controls.mjs` pass.

## Not done / gaps
- A live end-to-end run of the pop-up needs Brett's signed-in hub session (the feed is read with his cookie); the repro
  above is the exact frame the pop-up made. UI Review shots of the fallback were not submitted from this headless run.
- If Brett wants decisions *inside* the pop-up from the console, axHub must add `https://console.amberxai.com` (and
  Molly's origin) to `AXHUB_APPROVALS_FRAME_ANCESTORS` and the console set `setApprovalsHost({ frame: true })`.
