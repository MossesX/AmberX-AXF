# Phone Connect: pop-ups, approvals and bring-to-front — report

Build `phone-connect-popups` · PR #869 · branch `claude/phone-connect-popups` · Fable · Nov 21 2026.
Brett (Nov 20 2026, launched by hand): the AmberX phone app is gone, Phone Connect is the phone side now, "make it do the job".

## What changed

| # | Asked | What landed |
| --- | --- | --- |
| 1 | Token retry bug | Two causes. (a) The console's wall token gate answered every device route `401` (it wanted the console token; a phone carries a device token), so a paired phone could never connect: the gate now lets the mounted device prefixes through, and only those. (b) The phone retried a refused token forever: engine `linkVerdict` ends the loop on `denied` / `revoked` / `unpaired` or three bare 401 / 403 in a row; the app drops the token and says "Disconnected: tap to re-pair". The console records the refusal, shows disconnected + Re-pair on the Phone Connect card, raises one banner alert and turns the systems check red. |
| 2 | Open a page, bring it to the front | MCP `phone_open_url {url, browser: chrome\|default}` (`POST open-url`): an https amberxai.com page in Chrome, in front. `how` in the answer: `direct`, or `notification` where Android blocked the background start (high priority, one tap). |
| 3 | Approvals pop up on the phone | A watcher in the console server reads what waits on axHub every 5 s (approvals-relay@1 `pending()`, read only) and pushes each new approval or veto countdown once, console open or not. The phone shows Approve / Deny (Shelve on a countdown) on a high-priority notification; the body opens that approval in the console. Only Brett's tap decides (personOnly), phone unlocked. |
| 4 | Follow Amber on the phone | A `console_show` of a screen, settings tab or address also opens the console on the phone there (`axf.phone@1` `follow()`). Switch "Follow Amber on the phone", on by default. |
| 5 | Presence | MCP `phone_status` (`GET presence`): paired, online, last check-in, link state. |

Where: engine `framework/core/phone-connect.mjs` (+ fixture, snapshot, JSON Schema), contract `framework/spec/PHONE-CONNECT.md`,
`apps/console-web/server/main.py` (gate) and `mcp_server.py` (`console_show`), the Phone Connect, approvals banner and
Follow Amber plugins (server parts, tests), the app `apps/phone-connect` (0.2.0).

## Decisions made without asking

- Url policy `own` now covers every amberxai.com host (was: the console's host only). Other sites still need the allowlist.
- Approve / Deny decide from the notification instead of opening axHub's page. The contract already allowed a tap over the device token.
- The approvals watcher uses the relay's owner sign-in (`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`). Without it the watcher idles and says why in `status.approvals`.

## Not done

- No "clear" command: a prompt decided elsewhere stays on the phone until tapped (a countdown's goes by itself).
- The full Kotlin twin of the engine stays deferred (PORTING.md).
- The hub's own `amberx.open_url` relay (MossesX/axHub) is that repo's work; agents call `phone_open_url` on axf-console.
- UI Review: the item was **not** submitted. `review.mjs submit --console` needs `AXF_CONSOLE_URL` + `AXF_TOKEN`, and this hand-launched session was given neither. The four shots are in `phone-connect-popups/` next to this file; the command is in the PR.
- Build steps were not ticked and the PR was not linked on Builds live: there is no build `phone-connect-popups` in the builds store (launched by hand).

## Tests

| Suite | Result |
| --- | --- |
| `framework/spec/check-phone-connect.mjs` | 306 ok |
| Phone Connect plugin self-test (engine fixture replay, rejection, open-url, approvals push, follow, presence) | 324 passed |
| Approvals banner self-test (`pending()`) | 68 ok |
| Follow Amber self-test | 58 ok |
| `apps/console-web/server/test_mcp_tools.py` | 229 ok |
| plugin-commands, help, plugin lifecycle, theme, controls, toolbars, chrome assets | ok |
| `apps/console-web/server/test_wall_users.py` (the gate) | not run locally (needs the built page); the gate was checked with a standalone script; CI runs it |
| Android `LinkRulesTest` + `assembleDebug` | not compiled locally (no Android SDK on the VPS); CI compiles it |

CI state: see the checks on PR #869 (the first run was still queued when this was written).

## What Brett does on his phone

1. After the PR lands and the console has redeployed: on the phone open `https://axhub.amberxai.com/apps`, Phone Connect, Download, and install it over the old one (0.2.0). Before it lands, the same APK is the `phone-connect-debug.apk` artifact of the PR's CI run.
2. Open Phone Connect. If it says "Disconnected: tap to re-pair" or "Not paired": in the console, Settings → Plugins → Phone Connect → Re-pair (or New code); in the app, Sign in to axHub, type the code, Pair.
3. Allow notifications when Android asks. Leave Watch on.
4. For pages that come to the front by themselves: tap "Allow opening pages in front" in the app and switch it on in Android's screen. Without it, pages arrive as a notification to tap.
