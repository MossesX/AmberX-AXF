# Approval rules: Save and Apply the default from the Phone Connect app

Build `approval-rules-save-apply-default-don-t` · branch `claude/approval-rules-save-apply-default-don-t` · Fable · Nov 21 2026

## The cause (s1)

**Both buttons asked their question with the browser's `confirm()` dialog, and the WebView that Phone Connect opens
cannot show one. It answers "no" at once, without drawing anything, so the press ended before any request was made.**

How a tap travelled:

1. Phone Connect opens a console page in the console app (`apps/console-droid`). With the floating toolbar on, the page
   shows in the expanded overlay (`how: console-overlay`), which is the usual case since "open straight on the phone".
2. The console app has one WebView for the whole process (`WebHost`), built on a `MutableContextWrapper`. In the
   overlay its base context is `OverlayService`, not an activity.
3. Save and Apply the default are framework `Button`s with `confirm="…"`. `Button` calls `globalThis.confirm(question)`
   and returns when the answer is false (`framework/react/components/Controls.tsx`).
4. Android's WebView can only draw a JavaScript dialog when its context unwraps to an `Activity`. `WebHost.Chrome` did
   not override `onJsConfirm`, so the WebView's own handler ran, found no activity, logged "Unable to create JsDialog
   without an Activity" to logcat and cancelled the dialog. `confirm()` returned `false` in the same tick.
5. `Button` took that as "Brett said no": `onClick` never ran. Apply the default never staged its draft, Save never
   sent the PUT, and nothing was shown because, to the page, nothing had failed.

That explains both symptoms exactly: "Apply the default stages nothing" (staging is the first thing its handler does)
and "Save does not reach axHub". It also explains why it works in a desktop browser and in the console app's own
activity, where the dialog can be drawn.

The same dead end hit every other confirm in the console while it shows in the overlay: every `Button confirm=` and 26
direct `confirm()` calls in plugins (delete a note, remove a key, uninstall an agent and so on).

### What was ruled out

| Suspect | Finding |
| --- | --- |
| CORS on the hub's policy route | Fine. Live preflight from `https://console.amberxai.com` for `PUT` + `content-type`: 204, `access-control-allow-origin: https://console.amberxai.com`, `allow-credentials: true`, methods `GET, PUT, OPTIONS`. |
| Hub session missing in the WebView | Not the cause of the silence, but a real second way to get nothing. The console is behind the hub's wall (a signed-out `GET /` is a 401 from axHub), so a page that loaded has a hub session, and `console.amberxai.com` → `axhub.amberxai.com` is same-site, so the WebView's third-party cookie block does not apply. But when the read falls back to the console token (`ownerFetch`: a 401 or a redirect on the session try), `canSave` is false and both buttons were just greyed, the reason only in a hover `title` that a phone never shows, with no way to sign in from the tab. |
| A swallowed error | The tab does show errors from the stage call and from the PUT (`run()` → the alert line). The swallow was one level up: a cancelled dialog is not an error. One real gap: a session that expired between the read and the PUT answered "Sign in to axHub in this browser first." with no link. |
| The trusted-click check (`ownClick`) | A real tap in a WebView is `isTrusted`. Unchanged. |

### How this was established

From the code of both apps and the WebView's documented behaviour, plus live read-only checks of the hub (the
preflight and the wall's 401 above). It was not run on the S26 Ultra: this box has no phone and no Android toolchain.
The browser run in s3 reproduces the WebView's behaviour (a `confirm()` that answers false without showing, and no hub
session) against the built console.

## The fix (s2)

Three layers, so it works today on the app Brett has installed and stays fixed.

**1. The tab asks its own question** (`plugins/gate/web/ApprovalRulesTab.tsx`). Save and Apply the default no longer
use `confirm()`. The press opens the question on the tab; **Yes, save** / **Yes, apply the default** is the press that
does it, and **Cancel** drops it. This ships with the console deploy: no app update needed.

**2. A missing session is said, with a way in** (`web/approvalRulesState.ts`).

- No axHub session on the page (`canSave` false): a note says "Save and Apply the default are off here. This page is
  not on your axHub sign-in" with a **Sign in to axHub** button. It opens the hub's sign-in and comes back to the tab
  (`/auth/login?rd=<this page>`); the draft waits on the console server.
- The session ran out between the read and the save (the hub answers 401): "Not saved: your axHub session is missing
  or has run out here. Sign in to axHub, then press it again. The draft is kept." with the same button.
- Any other failure (hub unreachable, hub refused): "Not saved: <the reason>". Every failed save shows on the tab
  and as a toast; `saveApprovals` throws a `SaveError` with a `code` (`owner`, `signin`, `refused`) for every path.

**3. The console app draws the page's questions in the overlay** (`apps/console-droid` 0.2.0: `JsDialogs`,
`DialogRules`, `WebHost.Chrome.onJsAlert / onJsConfirm / onJsPrompt`). In the overlay the shell shows a system dialog
in an overlay window; in the activity the WebView's own dialog stays. This fixes the other 26 `confirm()` calls and
every other `Button confirm=` in the console. The bridge announces it as feature `dialogs`.

Until the phone runs 0.2.0, the console tells an unseen answer apart from a real one (`src/native/axfNative.ts`,
`nativeRules.mjs`): a `confirm()` that says no within 40 ms was never shown, and the console says "The question for
that press couldn't be shown in the floating console, so nothing was done…" instead of doing nothing.

Kept on purpose: saving is still Brett's own click only. The answer button's click is the one checked
(`isTrusted`), so a console-control press of Save only opens the question and a remote press of the answer is refused
before anything is read or sent. On a phone the toolbar buttons keep the framework's tap-to-confirm (tap, tap again),
then the question: that is the standing toolbar behaviour, not part of this bug.

### How each surface reaches it

| What | Deep link / state | REST · MCP · CLI · voice |
| --- | --- | --- |
| The tab | `view:gate/tab:gate.tabs=approvals`, `vps.approvals.open` | unchanged |
| Read, stage | `setting:vps.approvals.*` | `GET /api/plugins/gate/approval-rules`, `POST …/draft` · `vps_approval_rules(_stage)` · `axf gate approvals …` · `vps.approvals.*` (unchanged) |
| Save, Apply the default, the answer | `button:vps-approvals-save`, `-default`, `-confirm`, `-cancel` are addressable; a remote press opens or cancels the question | never a command (owner-only, as before) |
| Sign in | `button:vps-approvals-signin` | a browser navigation to the hub; signing in is Brett's |
| Does the phone app draw questions | `panel:phone-app` state → `native.features` has `dialogs` | `native.state` on all four |
