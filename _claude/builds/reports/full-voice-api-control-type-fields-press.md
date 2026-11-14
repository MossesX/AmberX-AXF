# Full voice and API control: type into fields, press buttons, approve hands-free

Build `full-voice-api-control-type-fields-press`, phase 1 (Opus), Nov 13 2026. Branch `claude/full-voice-api-control-type-fields-press`.

Brett said (2026-11-13 17:39, verbatim): "the most important thing is full voice control for API so I can build, control
absolutely everything, don't even have to touch the phone at all"

## What shipped

console-control@1 already named screens, tabs, settings, grids, rows, steps, plugins and opted-in buttons. What it could not do
was fill in a form: a dialog's text fields, selects, switches and its Create button had no address unless the plugin registered
them by hand, so the New project form, plugin dialogs and wizards still needed a tap. This build closes that.

| Piece | Where |
|---|---|
| Field and button discovery on the surface in front (topmost dialog, else the main pane, plus open menus): every input, select, textarea, switch, checkbox, choice group, button, menu item, tab and link button gets `setting:field.<id>` / `button:<id>` under `view:<v>` or `view:<v>/panel:dialog:<id>`; set types (React sees it), picks by value or label, toggles; press clicks; state reads type, value, required, options, error | `framework/react/fieldControl.ts`, registry hooks in `framework/react/controlTargets.ts` |
| Screen read-back: `state` with no address answers `state.report` (view, title, dialog, fields with values, buttons, headings, visible text) | same; console executor keeps it (`src/control/executor.ts`) |
| Hands-free decisions: approve / veto / deny / reject / sign off run only from Brett's own signed-in axHub session (the wall caller, never the shared console token agents hold); answer and audit carry `decidedBy: owner:<name>` | `server/console_control_api.py` `owner_of`, `guarded`; `console_control.check_press(owner=)` |
| Audit: every write names `by` and `reason` (missing → "(no reason given)"; voice → "said: …"), decisions add `decidedBy`; `GET /api/console-control/audit` | `server/console_control_api.py` |
| Voice: "type X into Y", "enter X in Y", "fill Y with X" (case kept), "what's on screen" / "read the screen" / "where am I", "approve [x]" / "veto it" / "deny", one-word presses (submit, next, create, save, confirm, cancel …), "what can I say" | `framework/core/engines/console-control-voice.mjs` + Python twin `server/console_control.py`; fixture `framework/spec/fixtures/console-control-voice.json` |
| Spec | `framework/spec/CONSOLE-CONTROL.md` → Fields and buttons on any screen, Reading the screen back, Decisions hands-free, Voice |

## How each one is reached (all four channels)

| Action | REST | MCP | CLI | Voice (AmberX / in-console) |
|---|---|---|---|---|
| Read the screen | `GET /api/console-control/screen` (`/fields` without text) | `console_control_screen` | `axf console read` / `axf console fields` | "what's on screen", "read the dialog", "where am I" |
| Type into a field | `POST /fill {values}` or `/do {verb: set, address: setting:field.<id>}` | `console_control_fill`, `console_control_do set` | `axf console type <field> <text>`, `axf console fill "Name=…"` | "type Garden planner into name" |
| Pick / toggle | same (`value` = option label/value, on/off/toggle) | same | same | "set template to blank", "turn switch to it right away off" |
| Press a button / tab / menu item | `POST /do {verb: press, address: button:<id>}`, `/fill {submit}` | `console_control_do press`, `console_control_fill submit` | `axf console press Create` | "press create", "next", "save" |
| Approve / veto | `/do` press from Brett's signed-in session | refused (shared token) | refused (shared token) | "approve", "veto it" from his own session |
| Audit | `GET /audit?limit=&writes=&by=` | `console_control_audit` | `axf console audit [--all]` | — |
| Deep link | `console_open` / `console_control_focus` take any field or button address | | `axf console focus <address>` | "open …" |

## Tests

- `apps/console-web/server/tests/test_console_control.py`: 11 tests (3 new): the New project form end to end over REST (read the
  screen, Create disabled while empty, fill by label, switch off, press Create, unknown field stops and is named, voice type /
  read / create, audit has who and why, CLI maps to the same requests); decisions only from Brett's own session (token refused,
  voice refused without owner, owner voice approves with `decidedBy`, guest audience refused, `owner_of` never takes the token);
  the MCP tools (screen, fill, audit).
- `apps/console-web/scripts/console-control.e2e.mjs` (Playwright, 36 checks, 13 new): the real New project form in a browser
  through the executor: open it, read it back (Name field address, Create disabled, text keeps word breaks), type the name (the
  input shows it, so React saw it), switch off, read the field back, Create enabled, press Create (the POST carries the name),
  unknown button not_found.
- The browser run caught two bugs the fake console could not: a plugin's target and a placed dialog's target point at whole
  sections, so everything inside counted as already owned and no field was found; and the read-back text ran words together.
  Both fixed (ownership counts only real controls and settings rows; innerText).
- Checks: check-console-control (290), check-theme, check-controls, check-toolbars, console-commands plugin tests, console tsc.
- Voice fixture rows for the new phrases; Python twin matches.

## Gaps and decisions

- claude.ai chat reaches the console through the shared console token, so it can read, fill and press but not decide. Approving
  from claude.ai needs an owner OAuth identity on the MCP connector; not built here.
- AmberX on the phone decides only when it calls with Brett's own axHub sign-in (wall session), not the console token.
- Discovered addresses come from the control's `data-axf-id`, `name`, a non-generated `id`, else its label slug; a plugin that
  wants a stable id across label changes sets `data-axf-id`.
- No new UI, so no UI Review shots.
- `npm run build` in this worktree fails before vite on main's drift (sync-data copies a `pending-core.mjs` that imports a
  `build-id.mjs` the baked `src/axf/core` lacks); not this build's change. The e2e ran on `vite build` without the sync. Kotlin twin deferred (Android on hold, PORTING.md).
- No new control@1 target: `console.fields` is reached through `console.control` (any address) plus the new REST / MCP / CLI
  routes, so the control@1 contract is unchanged and no Fable step was needed.
