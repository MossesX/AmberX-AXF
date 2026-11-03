/**
 * Token control guides (token-control s13): plain Markdown the Docs tab renders next to the per-target reference it
 * generates from the control@1 registry. Pure data (no React), so scripts and the help coverage check can read it.
 */
export interface Guide { id: string; title: string; body: string }

export const GUIDES: Guide[] = [
  {
    id: 'start',
    title: 'Start here',
    body: `Every change goes through **one command**, control@1, whichever way you send it:

\`\`\`json
{ "op": "set", "target": "tokens.layout", "path": "navWidth", "value": 200, "reason": "narrower rail" }
\`\`\`

- **op**: \`list\` · \`get\` · \`set\` · \`reset\` · \`add\` · \`remove\` · \`act\`
- **target**: a token set (\`tokens.theme\`, \`tokens.style\`, \`tokens.layout\`, \`tokens.typography\`, \`tokens.density\`, \`tokens.sizing\`, \`tokens.slots\`), AmberX (\`amberx.items\`, \`amberx.lists\`) or the planner (\`planner.plans\`, \`planner.builds\`)
- **path**: the token id or the record id
- **value** / **action** + **input** / **select**: what to set, which verb to run, which filters to list with

Three ways in, same answers: the REST API (\`/api/control\`), the MCP tools (\`control_*\`, \`amberx_*\`, \`plan_park\` on the console's \`/mcp\` and through axHub) and the CLI (\`axf control …\`, \`axf token | note | todo | task | list | plan | build …\`).`,
  },
  {
    id: 'tokens',
    title: 'Tokens: change the look of every app',
    body: `A token \`set\` never edits a theme. It writes an **override** into the axHub look document (\`axf.tokens.<set>\`), and every app on the framework applies it on top of whichever theme is active, live.

\`\`\`sh
axf token layout get navWidth
axf token layout set navWidth 200 --reason "narrower rail"
axf token theme set accent "#ff8800"      # any colour (theme-ok)
axf token style set radius.md 10
axf token typography set scale.md 1
axf token layout reset navWidth          # back to the theme's own value
axf token theme reset                    # drop every colour override
axf token slots set color-theme arctic-daylight   # hot-swap the active asset
\`\`\`

\`list\` shows every token with its value now, the theme's own value (\`base\`), its unit and range, and whether it is overridden. Values are checked against the token's range (layout and scale tokens) or type (colours, fonts, numbers); a wrong value answers \`validation\` and names the problem.

\`tokens.look\` and \`tokens.custom\` (the old look sliders and per-asset tokens) were retired on Nov 1 2026: set the same thing through the token sets above.`,
  },
  {
    id: 'amberx',
    title: 'AmberX notes, to-dos, tasks and lists',
    body: `\`amberx.items\` are the notes, to-dos and tasks every AmberX device shows; \`amberx.lists\` the list tree they live in.

\`\`\`sh
axf todo add "Buy milk" --list groceries
axf todo list --select status=not-done
axf note list --select q=meeting
axf todo done <id>            # or: undone, pin, star
axf todo move <id> groceries
axf task check <id> --field item=<checklist id> --field done=true
axf list add "Groceries"
axf list rename <id> "Food"
\`\`\`

MCP: \`amberx_find\`, \`amberx_add\`, \`amberx_update\`, \`amberx_done\`, \`amberx_move\`, \`amberx_remove\` (or the generic \`control_*\` tools). Inbox, Plugins and Voice notes are system lists: they can't be removed.`,
  },
  {
    id: 'planner',
    title: 'The planner: plans and builds',
    body: `\`planner.plans\` are Plan Studio plans; \`planner.builds\` are Build orchestrator builds (the one builds store; Pending, the queue and the Build manager follow every change).

\`\`\`sh
axf plan add "Voice macros" --field category="Apps > AmberX"     # parked: "put it in a plan for later"
axf plan list --select status=parked
axf plan comment <plan id> "Needs the recorder first"
axf plan build <plan id> --field profile=main --field buildId=voice-macros   # an orchestrator build
axf build list --profile urgent
axf build step token-control s12 --profile urgent               # tick a step (add "undo" to untick)
axf build note token-control "halfway" --profile urgent
axf build approve token-control --field phase=1 --profile urgent
\`\`\`

\`--profile\` (or \`select.profile\` / \`input.profile\`) picks the build profile; without it the active profile is used. Approving a model switch is Brett's call: only send \`approve\` when he said so.`,
  },
  {
    id: 'deletes',
    title: 'Deletes need a confirm token',
    body: `\`remove\` never runs on its first call. It answers \`confirmation_required\` with a **confirm token** bound to that exact command; send the same command again with the token within 10 minutes.

\`\`\`sh
$ axf note remove n-abc123
remove amberx.items n-abc123 deletes; send the same command again with this confirm token within 10 minutes
confirm token: c1.1ffaf70b770e59e9
repeat to delete: axf note remove n-abc123 --confirm c1.1ffaf70b770e59e9
\`\`\`

REST answers \`409\` with \`confirm\`; the MCP tools return it as data. A token made for one record can't delete another.`,
  },
  {
    id: 'api',
    title: 'REST API',
    body: `Base: \`https://console.amberxai.com/api/control\`, header \`Authorization: Bearer $AXF_TOKEN\` (the console token = the admin role).

| | |
|---|---|
| \`GET /api/control/{target}?filter=value\` | list |
| \`GET /api/control/{target}/{path}\` | get |
| \`PUT /api/control/{target}/{path}\` body \`{ value, reason? }\` | set |
| \`POST /api/control/{target}/reset\` body \`{ path? }\` | reset |
| \`POST /api/control/{target}\` body \`{ value }\` | add |
| \`DELETE /api/control/{target}/{path}\` body \`{ confirm? }\` | remove (409 first) |
| \`POST /api/control/{target}/{path}/act/{action}\` body \`{ input }\` | act |
| \`POST /api/control\` body = a whole command | any |

Status codes: 400 invalid · 403 denied · 404 not_found · 409 confirmation_required · 422 validation · 501 not_implemented. JS: \`controlClient({ base, token })\` from \`plugins/token-control/web/client.mjs\`.`,
  },
  {
    id: 'mcp',
    title: 'MCP (Claude, axHub)',
    body: `The console's MCP server (\`https://console.amberxai.com/mcp\`, registered in the repo's \`.mcp.json\` as \`axf-console\`, plus the local stdio \`axf\`; axHub proxies it) carries:

- \`control_list\`, \`control_get\`, \`control_set\`, \`control_reset\`, \`control_add\`, \`control_remove\`, \`control_act\`: every target
- \`amberx_find\`, \`amberx_add\`, \`amberx_update\`, \`amberx_done\`, \`amberx_move\`, \`amberx_remove\`
- \`plan_park\`: "put it in a plan for later"

Reads are marked read-only, removes destructive. A failure raises a tool error with its code; a delete's first call returns the confirm token as data, so ask the user before sending it back.`,
  },
  {
    id: 'console',
    title: 'Console: load a screen for Brett',
    body: `The \`console.*\` targets move Brett's **open console** (the Console commands plugin runs them; the console used last gets them, \`input.to\` = \`all\` or a client id for others).

| Say | MCP tool (console /mcp, also through axHub) | REST | CLI |
|---|---|---|---|
| open Plan Studio | \`console_open {screen: "plan studio"}\` | \`POST /api/console/open {"screen": "plan studio"}\` | \`axf console open plan studio\` |
| open a plugin's settings | \`console_settings {tab: "plugins/token-control"}\` | \`POST /api/console/settings {"tab": …}\` | \`axf console settings plugins/token-control\` |
| open a dialog | \`console_dialog {dialog: "asset-json"}\` | \`POST /api/console/dialog {"id": …}\` | \`axf console dialog asset-json\` |
| run an action | \`console_action {action: "terminal.open"}\` | \`POST /api/console/action {"id": …}\` | \`axf console action terminal.open\` |
| back / home / close | \`console_back {move: "back"}\` | \`POST /api/console/back\` | \`axf console back\` |
| where is it | \`console_where\` | \`GET /api/console/where\` | \`axf console where\` |
| what can it open | \`console_list {kind: "screens", q: "build"}\` | \`GET /api/console/list?kind=screens&q=build\` | \`axf console list screens build\` |

Names resolve by id, title or a few words, against what the open console reports (plugins' screens included). Opening only **navigates** (\`control.console.navigate\`). An action that changes data needs \`control.console.write\` plus the permission the action itself requires; one that deletes or resets answers \`confirmation_required\` with a token first, like a remove. The same commands work as control@1 here: \`{ "op": "act", "target": "console.screens", "path": "plan studio", "action": "open" }\`.`,
  },
];
