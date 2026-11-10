# No veto timer on navigation / Follow Amber; "open X" brings Chrome + the console to the front

Build `no-veto-timer-on-navigation-follow-amber-open-x`, Phase 1 (Opus), Nov 10 2026.

Brett (Nov 10 2026, 20:45): "I don't want the timer on Follow Amber. Do stuff right away. If console's not open in Chrome,
open it in Chrome and bring the page to the front. If Chrome's not in front, bring Chrome to the front and open it."

## Cause

- axHub runs the AXF console's MCP tools on the `recommended` preset (live: `axf-console`, preset recommended): read-only
  tools run at once, writes wait on the 90 s veto. `console_open`, `console_settings`, `console_dialog`, `console_show`
  were already read-only, but **`console_action` is a write** (an action can change data), so every "open the terminal",
  "open builds" etc. that went through an action waited 90 s. Auto plugin-command tools for the console's own routes
  (`console_commands_open`, `_dialog`, `_back` …) were writes too.
- Follow Amber's `console_show action:<id>` never worked for actions: it runs with the navigate grant only, and the
  control@1 gate asks `control.console.write` for any `console.actions run` before the action's own effect is looked at.
- A console that is open but behind (Chrome in the background, phone locked) got the command "live": it ran out of sight,
  and nothing brought Chrome to the front. Only a *closed* console woke AmberX (after 3 s).

## Fix

| Part | Before | After |
|---|---|---|
| Navigation through an action | `console_action` (write → 90 s veto) | New MCP **`console_go {action, args?, to?}`**, read-only → axHub runs it at once. The runner (`console.mjs`) runs it only when the action's own effect is `navigate`; a write or destructive action answers `denied` before anything is sent (no confirm token). Needs `control.console.navigate`, not write. |
| Other ways in | — | REST `POST /api/console/go {id, args?, to?}`, CLI `axf console nav <action> [args…]`, `navigateOnly: true` on any whole control@1 console command; plugin commands `console_commands_go|open|dialog|back|home|close` declared read-only (plugin.json) |
| Follow Amber `console_show action:…` | denied (gate wanted write) | sent `navigateOnly`: navigation actions run with the navigate grant alone |
| Console behind | run unseen in the background tab | owner + navigation + every target console `front: false` → queued for a console in front, AmberX asked **at once** (no 3 s delay, no 45 s throttle) to open `…/?axf-cmd=<id>` in Chrome. The console that comes to the front (hello with the pick, or `seen` with `front: true`) runs it; `delivery.how: "brought to the front"`. AmberX unreachable / wake off → delivered to the console behind, as before. Data changes are never held. |
| AmberX intent | new Chrome tab each time | `Browser.EXTRA_APPLICATION_ID` = AmberX: Chrome reuses the tab it opened for AmberX and brings it to the front |
| Setting | — | `front` (default on): Settings → Plugins → Console commands → "Bring the console to the front for anything Amber opens"; `GET|POST /api/console/settings {front}` |
| Amber's instructions | — | MCP server instructions + `console_action`'s description send opens to `console_show / console_open / console_settings / console_dialog / console_go` |

Builds on PR #454 (`claude/amberx-open-url-tapping-the-command-waiting-noti`, merged into this branch): the "command waiting"
card opens Chrome, not AmberX, and AmberX asks once for "Display over other apps". With that permission on, AmberX starts
Chrome from the background by itself; without it Brett gets one tap.

## API reach (all four the same)

- MCP: `console_go` (new), `console_open`, `console_show`, `console_settings`, `console_dialog`; plugin commands
  `console_commands_go` etc.; setting through `console_commands_settings_run_set_settings`, read `console_commands_settings`.
- REST: `POST /api/console/go`, `POST /api/console` with `navigateOnly`, `GET|POST /api/console/settings {front}`.
- CLI: `axf console nav <action>`, `axf console open <screen>`.
- Voice (AmberX): "open X" goes to Amber, who calls these tools through axHub; read-only → no veto. The bring-to-front
  is server-side, so it applies to every caller.
- Deep link: the settings sub-tab `console_settings plugins/console-commands`; the state is in `GET /api/console/settings`
  and each answer's `delivery.how`.

## Tests

| Suite | Before | After |
|---|---|---|
| `console-commands/server/test_console_commands.py` | 83 checks | 104: go runs navigation / refuses write + destructive, a hub user with navigate only can go but not action, navigateOnly on a whole command, bring-to-front (AmberX asked at once in Chrome with the command's link, the background console doesn't run it, it runs when the console comes to the front, `how`), data changes not held, phone unreachable → console behind, setting off → live |
| `console-commands/test.mjs` | 7 tests | 7 tests, more asserts (runner navigateOnly, `axf console nav`) |
| `follow-amber/test.py` | 35 | 36 (action shows are navigateOnly) |
| `server/test_mcp_tools.py` | 205 | 209 (console_go read-only + navigateOnly, instructions) |
| `check-theme`, `check-controls`, console `tsc --noEmit` | pass | pass |

`test_console_commands.py` failed once in five runs on the existing "reconnect within the wake delay" check (a 15 s
join on a loaded VPS); the other four runs were green. That check didn't change here.

## Not done / gaps

- AmberX: the one-line intent change compiles only in CI (no Android SDK on the VPS); install the APK from the PR's CI run.
  Real-phone check not done (no phone link from the VPS).
- UI Review: the headless console only showed "Waiting for axHub" (the test browser can't reach the hub), so there are no
  usable shots of the new switch. Not submitted. The change is one framework `Switch` in an existing panel.
- Kotlin twin: none (no engine change; console plugin server + runner only).
- On desktop a console in a background *window* still counts as in front (the page is visible); only a hidden tab or
  minimised window counts as behind.
