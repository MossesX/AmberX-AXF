# phone-connect-open-straight-phone-no-tap (Phone Connect, Nov 21 2026)

Build "Phone Connect: open straight on the phone, no tap-to-open notification". Model: Fable. Branch
`claude/phone-connect-open-straight-phone-no-tap`. Apps: `apps/phone-connect` (0.3.0), `apps/console-droid`; console
plugins `phone-connect`, `console-commands`.

## Why the wake fell back to the tap-to-open notification

Three causes, all in code, none of them Android refusing a start it was allowed to make:

1. **The wake never asked for the console app.** `console-commands/server/wake.py` named a browser, and
   `hub_tool` turned any named browser into `where: browser`. That path skips the console app and needs Phone
   Connect's *own* "Display over other apps". With the permission granted to the console app only (the app that has
   the floating toolbar), the phone posted the notification.
2. **The console app refused when its toolbar was off.** `PhoneConnectRules.handOff` answered `no_overlay` for
   "toolbar off OR permission missing". The permission alone is Android's exemption from the background-start block,
   so with it the app can come to the front by itself; it just never tried.
3. **Nobody used the other app's permission.** When the console app lacked the permission and Phone Connect had it,
   Phone Connect opened Chrome instead of starting the console activity it was allowed to start.

On top of that the result lied both ways: the phone answered `opened: true` for a notification, and the wake called an
unanswered command "notified".

## What changed

| Where | Change |
| --- | --- |
| `console-commands/server/wake.py` | the wake asks the paired phone for `where: overlay` (console app first, the named browser after it); `phone_outcome()` reports what the phone said |
| `phone-connect/server/service.py` | `hub_tool` honours an explicit `where`; `opened_how()` = `{answered, opened, notified, how, why, message}`; `open-url` returns `opened`, `notified`, `how`, `why`; `MIN_APP` 0.3.0 (the systems check asks for the update) |
| `apps/console-droid` `PhoneConnectRules` / `PhoneConnectProvider` | the permission alone is enough: toolbar on → the overlay (`how: console-overlay`), toolbar off → the app in front (`how: console-app`); the provider answers `ok` only once the page is on screen (overlay, or the activity resumed within 2 s), else `unavailable`; `state` carries `visible` |
| `apps/phone-connect` `ConsoleOverlay.kt`, `Commands.kt` | console app first; when it answers `no_overlay` and Phone Connect may start activities, Phone Connect starts `ConsoleActivity` on the page and waits for the console app to say it is on screen; then the browser; the notification last, with `opened: false`, `notified: true`, `why: no-permission · launch-failed` |
| `apps/phone-connect` `ApprovalOverlay.kt`, `Shows.kt`, `WatchService.kt` | a held approval floats over whatever is on screen as a card with Approve / Deny (Shelve where offered) and Hide; the notification is still posted (lock screen, fallback); the outcome replaces both |

### The approval card and personOnly

A tap on the card takes exactly the road of the notification action: `WatchService` sends `data.decision` with
`by.kind: person` and a fresh tap id over the device token; the engine's `decisionErrors` is unchanged. The card is a
`TYPE_APPLICATION_OVERLAY` window, which Android does not draw over the lock screen; a tap while the keyguard is up
is ignored, and buttons set `filterTouchesWhenObscured`, so a tap through another app's window is never a decision.
There is still no decide command on any API.

The card is a plain View window (a service has no Compose host). Every colour, size, radius and border is read from
the compiled theme tokens (`AxfTheme.from(runtime.compiled)`), so it follows the look.

## API (four ways, unchanged names)

| What | REST | MCP | CLI | Voice |
| --- | --- | --- | --- | --- |
| Open a page, hear what happened | `POST /api/plugins/phone-connect/open-url` → `opened`, `notified`, `how`, `why` | `phone_open_url` | `axf phone open <url>`, then `axf phone command <id> --wait 10` | "open … on my phone" (the same plugin command) |
| Wake result | `delivery.wake` on a console command: `opened`, `notified`, `how`, `message` | the console action's answer | `axf console action …` | the same action |
| What the phone did with one open | `GET /api/plugins/phone-connect/commands/{id}` → `command.opened` | the plugin command `command-result` | `axf phone command <id>` | n/a (a read) |
| Approval card | shows from the `approval` command (server watcher); Approve / Deny are never commands (personOnly) | — | — | — |

Deep link: `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect` (unchanged).

## Tests

- `apps/console-web/plugins/phone-connect/test.py`: 333 checks (wake routing `where: overlay`, `opened_how` for
  direct / console-app / console-overlay / notification with both reasons / no answer / collapse, an older app's
  `opened: true` on a notification, app version gate).
- `apps/console-web/plugins/console-commands/server/test_console_commands.py`: 154 checks (`phone_outcome`).
- `PhoneConnectRulesTest` (console app): permission without toolbar opens the app, opened only when on screen, the
  Kotlin twin's names. `LinkRulesTest` (Phone Connect): `consoleHow`, `notifiedWhy`, `approvalShown`, button words.
- `framework/spec/check-phone-connect.mjs`: 306 checks (engine unchanged; `how` is result data, not schema).

## Not verified on a device

This box has no Android toolchain or phone: the Kotlin and Java are compiled and unit-tested by CI
(`android.yml`), and the on-device behaviour (background start of the console app, the floating card) was not run on
the S26 Ultra. The provider's on-screen check exists so that a start Android holds back is reported as a failure and
falls back to the notification instead of being called opened.

## Installing

CI on main publishes `phone-connect` 0.3.0 and the console app in the `app-apks` bundle; they appear under
axHub → Apps. Both need installing (the console app carries the provider change). Until the phone runs 0.3.0 the
systems check shows the update item with where to get it.
