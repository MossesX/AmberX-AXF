# To-do manager fully voice and MCP controlled — report (Nov 16 2026, Opus, headless VPS)

Build `to-do-manager-fully-voice-mcp-controlled`, branch `claude/to-do-manager-fully-voice-mcp-controlled`.

## Brett said (verbatim, Nov 16 2026 20:22)
> Everything needs to be voice controlled. Make a new list called New build and a note called Build.

## Short version
Every Todo manager action now works by name, no ids, through REST, MCP, the CLI and voice. Say "make a list called X",
"add a note called Y to X", "mark Y done", "move Y to Z", "delete Y" (asks first), "what's in X", "export the list X".
The console's voice endpoint (the one AmberX uses) hands these phrases to the plugin. A new CI check fails any plugin
REST route with no MCP tool or no voice twin.

The list "New build" with the note "Build" already exists in the live store (Brett made it in the UI at 20:22). There
is also an empty duplicate "New build" (id 2), left in place; voice says "2 lists are called New build. Rename one"
until one is renamed or deleted.

## Steps
| Step | What |
|---|---|
| s1 | `server/voice.py` (name lookup: exact, starts-with, contains; ties refused with names; every answer has `say`) + `voice.json` (18 commands, phrases with `{slots}`, `covers` = command ids). Routes `/by-name/*` and `POST /voice` (auto MCP tools + CLI through plugin-commands@1, declared titles + input schemas in plugin.json). Console voice (`console_control_api.plugin_voice`) asks plugins that provide `axf.voice-phrases@1:<folder>` first (plugin_services `get_all`). Console action `todo-manager.say`. CI `framework/spec/check-plugin-voice.mjs` with ratchet `plugin-voice-baseline.json`. PORTING entry (Kotlin twin deferred). |
| s2 | Live store checked: list + note exist. Duplicate-name handling (plain answer, compound phrase reuses the newest list by id). Voice verified read-only against a copy of the live store. Build note about the empty duplicate. |
| s3 | Checks, this report, THREADS row. |

## How each action is reached
| Action | REST `/api/plugins/todo-manager/…` | MCP (plugin-commands@1) | CLI | Voice (AmberX → `console_control_voice`) |
|---|---|---|---|---|
| Make a list | `POST /by-name/list-create {title, parent?}` | `todo_manager_by_name_list_create` | `axf todo-manager by-name-list-create --title X` | "make a list called X" |
| List + item at once | `POST /by-name/list-and-entry` | `…_list_and_entry` | `axf todo-manager by-name-list-and-entry …` | "make a new list called X and a note called Y" |
| Rename / move / delete a list | `/by-name/list-rename`, `list-move`, `list-delete {confirm}` | `…_list_rename` etc. | same pattern | "rename the list X to Y", "move the list X to position 1", "delete the list X" (then "… confirm") |
| Add / edit / move / complete / delete an item | `/by-name/entry-add`, `entry-edit`, `entry-move`, `entry-complete`, `entry-delete` | `…_entry_*` | same pattern | "add a task called Y to X", "set Y priority to high", "move Y to Z", "mark Y done", "delete Y" |
| Search / read / export | `GET /by-name/find`, `lists-read`, `export` | `…_find`, `…_lists_read`, `…_export` | same pattern | "find tasks about X", "what's in X", "export the list X" |
| Any phrase | `POST /voice {text}` | `todo_manager_voice`, `console_control_voice` | `axf todo-manager voice --text "…"` | anything in voice.json |
| Open the screen | — | `console_open view:todo-manager` | `axf console do open view:todo-manager` | "open todos" |
| Phrase in the open console | — | console action `todo-manager.say` (address `function:todo-manager.say`) | — | — |

The id-based routes (`/lists`, `/entries`, …) keep their auto MCP tools; voice.json covers each with a phrase.

## Checks
| Check | Result |
|---|---|
| `python3 apps/console-web/plugins/todo-manager/test.py` | 93 pass (was 46) |
| `node framework/spec/check-plugin-voice.mjs` (new, in CI) | 71 plugins, 1 with phrases, 61 on the baseline, 0 failing |
| `node framework/spec/check-plugin-commands.mjs` | 59 checks |
| `test_console_control.py`, `console-control-parity.mjs` | 8 tests; 14 cases / 132 comparisons |
| `check-theme`, `check-controls`, `help-coverage --check`, console `tsc --noEmit` | pass |

## Known gaps
- 61 plugins with REST routes have no voice.json yet: voice reaches them only through Amber picking their MCP tool. The
  baseline only shrinks; new plugins with routes must ship phrases.
- Matching is pattern-based, not an LLM: a title containing " to " in "add a note called … to …" splits at the first
  "to". Say the list first ("make a list called X and a note called Y") or use the by-name REST/MCP call.
- The live console runs main: the new phrases answer once this branch lands and the console redeploys.
- Kotlin twin deferred (PORTING.md).
