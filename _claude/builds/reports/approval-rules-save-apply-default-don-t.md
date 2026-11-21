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
