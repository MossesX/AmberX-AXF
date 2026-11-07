# API Browser

Every API path of the Dev Console in one place (build `full-api-control`, addendum Nov 7 2026, Brett: "A real, polished
API Browser plugin in the console listing EVERY API path … from one generated registry").

## What it lists

One generated registry, **api-registry@1** (`framework/cli/api-registry.mjs`), made from the code that defines each way in:

| Group | From | REST | MCP | CLI |
|---|---|---|---|---|
| control@1 | every target × op / act verb (`core/engines/control-rules.mjs`) | `POST /api/control` | `control_<op>` + the `console_*` shortcuts | `axf control …`, `axf console …` |
| Plugin commands | every plugin read and command (plugin-commands@1) | `/api/control/<plugin>/<command>` | `<plugin>_<command>` | `axf <plugin> <command>` |
| MCP tools | the rest of `apps/console-web/server/mcp_server.py` | — | the tool | — |
| REST routes | `apps/console-web/server/main.py` | the route | — | — |
| CLI | `framework/cli/axf.mjs` | — | — | `axf <command>` |

Each entry: what it does, input schema, **policy** (Instant = reads and navigation; Veto = a change waits out axHub's
90 s veto when a remote caller sends it; Confirm = deletes and resets need a confirm token; Approval; Brett's tap = only
his own click decides), REST + MCP + CLI names, the UI elements it stands for (**api-coverage@1**,
`framework/cli/api-coverage.mjs`) and its docs.

## Views

A TabGroup (`api-browser.views`) drawn on one of the plugin's three tab-group looks (`assets/tab-group/`, UI Review
choice set `api-browser-look`: top tabs, side rail, chips; Settings → Plugins → API Browser, or right-click the switcher):

- **Grid** — framework DataGrid grouped by kind, sortable (what it does, policy, REST, MCP, CLI, UI count), hide columns
- **Tree** — Dev Console › plugin / control domain / MCP area › kind › path
- **Cards** — one card per path, 60 at a time
- **Coverage** — every UI element of the console and its API path; red rows are gaps (CI fails on one)

Search and the Kind / Policy (or Status) filters apply to every view. The detail pane copies names and runs **Try it**:
control@1 and plugin commands go to `POST /api/control` as one command, REST entries to their own path, with the
browser's own session (the same policy as any click in the console). Reads run at once; a change asks once; a delete's
first run answers with its confirm token and a second button runs it with it; Brett-only paths, MCP-only tools and CLI
commands say why they don't run from here. Setting *Try it may run changes* off = reads only.

## Server (`/api/plugins/api-browser/`)

`GET registry[?refresh=1]` · `GET entry?id=` · `GET coverage[?status=&q=]` · `GET|PUT settings`. The registry is made by
running the generator in Node, cached in memory until one of its source files changes (or 5 minutes), with a note of the
last one in the data folder (`.axf-console/plugins/api-browser`). Every route is a plugin command too
(`axf api-browser registry`, MCP `api-browser_registry` …).

## Actions

`api-browser.find:<words>` opens the page searching for those words.

## Tests

`python3 apps/console-web/plugins/api-browser/test.py` (server, against the real registry) and
`node --experimental-strip-types apps/console-web/plugins/api-browser/test.mts` (filters, tree, sample bodies, Try it requests).
