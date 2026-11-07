# CONTROL — control@1, one command for every token, every AmberX entity and the planner

Status: contract since Nov 3 2026 (Urgent build `token-control` s3, Fable). Reference: `framework/core/engines/control-rules.mjs`
(pure; shared by the TS engines, the build engine, the console server's MCP + API and the CLI). Snapshot: `framework/schemas/control.json`
(the registry, tools, routes, CLI usage and JSON Schema; `check-control.mts` keeps it equal). Fixture: `framework/spec/fixtures/control.json`.
Transports (the Opus phase of the same build): the console's REST routes under `/api/control`, the MCP tools `control_*` on the console's
`/mcp` and through axHub, the CLI `axf control …` with the aliases `axf token | note | todo | task | list | plan | build …`, and the shared
JS client. Kotlin twin deferred (Android on hold). The transports run one Node runner (no Python mirror needed): the
Token control plugin (`apps/console-web/plugins/token-control`, capability `control@1`, Nov 3 2026) — `control.mjs`
(runner + CLI), `server/__init__.py` (REST; main.py mounts it at `/api/control`), the console MCP's `control_*` tools
(`mcp_server.py` → the capability), `web/client.mjs` (shared client). Token sets write `axf.tokens.<set>` overrides into
the appearance document (`core/engines/control-tokens.mjs`); the runtime applies them in `compileStyles`.

## Why one schema

Brett (Nov 2 2026): "a powerful API, MCP and CLI server/client that can change every single token (theme, style, layout); every layout
parameter is a token … control every aspect of AmberX tasks, to-dos and notes, and the console planner (Plan Studio and the Build
orchestrator)". Three surfaces, one grammar: a transport only carries a command and an answer; what a command may do, who may do it,
what it needs, and what it answers are decided here once, so the docs, the tools, the routes and the CLI never disagree.

## The command

```json
{ "$axf": "control@1", "op": "set", "target": "tokens.layout", "path": "navWidth", "value": 200, "by": "claude", "reason": "narrower rail" }
```

| Field | Meaning |
|---|---|
| `op` | `list` · `get` · `set` · `reset` · `add` · `remove` · `act` |
| `target` | `tokens.theme` · `tokens.style` · `tokens.layout` · `tokens.typography` · `tokens.density` · `tokens.sizing` · `tokens.look` · `tokens.custom` · `tokens.slots` · `tokens.nav` · `amberx.items` · `amberx.lists` · `planner.plans` · `planner.builds` · `console.screens` · `console.dialogs` · `console.settings` · `console.actions` · `console.nav` · `console.clients` · `pass.scopes` · `plugins.commands` · `plugins.reads` · `console.values` · `console.elements` |
| `path` | the token id (`navWidth`, `accent`, `scale.md`, `button.radius@amber`) or the record id; `get`/`set`/`remove`/`act` need it, `reset` without one resets the whole target |
| `value` | what to set (a token value, or the fields to change on a record) · the new record for `add` |
| `action` + `input` | the verb for `act` and what it wants (`done`, `move {list}`, `approve {phase}`, `step {step, done}` …) |
| `select` | filters for `list` (per target: `kind`, `status`, `tag`, `q`, `profile` …) |
| `confirm` | the confirm token a `remove` sends on its second call |
| `by`, `reason` | who and why; audited on every write |

Effects: `list`/`get` read · `set`/`reset`/`add`/`act` write · `remove` destructive · a target's `actEffect` may make a verb
`navigate` (console `open`, `back`, `home`, `close`: changes what a screen shows, no data). The MCP tool annotations (`readOnlyHint`,
`destructiveHint`) and the permission a call needs come from the effect.

## Targets

**Tokens** (`tokens.*`): a `set` is an override on top of the active asset, stored per asset id and shared through the axHub look
(Nov 1 2026 rule: any look change applies to every app); `reset` drops it; `list` names every token with its kind, unit, default
and range. The static targets (theme, style, layout, typography, density, sizing) are listed by the registry itself; `look`,
`custom` and `slots` are listed by the running app (look@1 ids, asset-customize@1 tokens, the appearance slot types).
`tokens.slots` set = `runtime.swap(type, id)`, the hot-swap.
`tokens.nav` (nav-style@1, `core/engines/navstyle-rules.mjs`) tunes the navigation menu with sub menus: colours, font, icons,
density, width, the sub-menu animation, behaviour, pinned / hidden / ordered items and `accents.<item id>`; only navs that opt in
(nav-menu `navStyle: true`) read it.

**AmberX** (`amberx.items`, `amberx.lists`): amberx-notes@1 records (apps/amberx-droid notes core; one store for notes, to-dos and
tasks on every device). Fields, filters and verbs are the notes core's own (`done`, `move`, `merge`, `pin`, `star`, `check` on items;
`move`, `reorder`, `rename` on lists). System lists (`inbox`, `plugins`, `voice-notes`) can't be removed.

**Planner** (`planner.plans`, `planner.builds`): plan@1 plans (Plan Studio) and builds@1 records through the orchestrator (the one
builds store; every write journalled). Verbs are the orchestrator's own actions (`step`, `approve`, `status`, `note`, `rename`,
`rename-step`, `add-step`, `edit-step`, `skip-step`, `remove-step`, `move-step`, `archive`, `hide`, `unhide`) and Plan Studio's
(`park`, `build`, `restore`, `export`, `step`, `comment`).

**Veto passes** (`pass.scopes`): timed passes that let token changes skip axHub's veto; see *Veto passes* below.

**Console** (`console.*`, build console-commands, Nov 3 2026): Brett tells a Claude session "open Plan Studio" and his open console
goes there. `console.screens`, `console.dialogs` and `console.settings` (tabs and sub-tabs, `plugins/<id>`) take `act open` with
`path` = the id, the title or words to search for; `console.actions` takes `act run` (input `args`); `console.nav` (path `here`)
takes `get` (where the console is) and `act back | home | close`; `console.clients` lists the consoles open for the caller. Every
list and resolve runs against the catalog the open consoles report (their search index: views, settings tabs, dialogs, actions),
so plugins' screens are found too. Every act takes `input.to`: `recent` (default, the console Brett is looking at: a client in front wins, then the one used last), `all`, or a client id.
A console inside a host says so (Nov 3 2026, build `molly-console-commands`): `app: molly/console-web`, `host: molly`, and `front` (its page is visible
and the host shows its frame, embed@1 `shown`); before it runs a command while hidden it asks the host to bring it forward (embed@1 `show`), and
Molly with xLayout opens the Console frame hidden at start (`warm`), so a command while Molly is open always lands in Molly.
Delivery and resolution: `core/engines/console-commands.mjs`; the console server's `console-commands` plugin keeps one mailbox
per signed-in user (the console token and hub admins share the owner's) and streams to each open console, which runs the command
through its own runtime (`rt.search.focus`, `rt.dispatch`) and acks what it opened.
A command never fails just because no console is connected (build console-wake, Nov 3 2026): the engine flags that failure
`noConsole: true`, and the server queues an `act` for `recent`/`all` (per user, TTL 2 min by default) and delivers it once to the first
console that says hello (checked first against that user's last catalog, so a wrong name still answers `not_found` at once). The call
waits up to 60 s. After 3 s with no console, the owner's AmberX phone is asked through axHub (`amberx.open_url`, amberxai.com only)
to open `…/?axf-cmd=<id>`. Every sent answer carries `delivery.how`: `live` · `after reconnect` · `woke via AmberX` · `queued`
(`queued: true`, still waiting when the call returned). A command for one named client that isn't there still answers `not_found`.

**Everything by hand, by API** (`console.values`, `console.elements`, build full-api-control, Nov 7 2026, Brett: "the API must be
able to do anything I can do by hand in the console and every plugin"). `console.values` is every setting the open console's
settings registry declares (its plugins' too; the catalog carries key, label, control kind, tab, choices and range): `list`
(`select.q`, `select.tab`), `get` (its value now; a secret is never read back), `set` (checked against its kind, choices and range
before it is sent, then written by the console exactly as its control would, the setting's own `requires` checked there) and
`reset` (its default). A key no group declares (toolbar and chrome keys) takes any plain value. `console.elements` is what the
open console shows right now — every button, switch, tab, menu and context-menu item, toolbar button, field and link, dialogs and
pop-ups included — with a stable id `<where>/<role>:<label>` (`data-axf-id` when the element sets one) and its state:
`list` (`select.q` = words), `get`, and `act press | toggle (input.on) | set (input.value) | focus | context` (opens its right-click
menu, whose items `list` then shows). A press of an element that deletes or resets (its label, or a danger style) answers
`confirmation_required` with a confirm token and needs `control.console.delete` on the second try. Brett's own taps stay his:
anything inside `[data-axf-person-only]` (approval Approve / Deny / Shelve, Approve upgrade, owner-only Claude settings, guarded
notifications) is listed with `personOnly: true` and refused, and every press runs inside `rt.actions.asRemote`, where a
`personOnly` action refuses. A window that is a screen (the Terminal) is named by the action that opens it (`ActionMeta.screen`), so
`console.screens open terminal` works. The console answers these ops itself: the ack carries `data` (the value, the elements), and
the answer is that data. Shortcut MCP tools `console_value`, `console_elements`, `console_press`; CLI `axf console value <key> [v]`,
`axf console list elements [words]`, `axf console press <element>`. The Terminal is typed into through its plugin commands
(`console-terminal/open-tab | type | keys | screen | close-tab | tabs`). The coverage registry (`apps/console-web/api-coverage.json`,
`node framework/cli/api-coverage.mjs`) lists every UI element of the console with its API path; CI fails on a gap.

**Follow Amber** (build follow-amber, Nov 3 2026, Brett): one switch for the owner's consoles. While it is on, a Claude session
calls MCP `console_show` {target, highlight?, say?} every time it mentions something in the console; the Follow Amber plugin
(`follow-amber@1`) opens it through `console.screens` / `console.settings` / `console.dialogs` (a bare name is tried in that
order; `kind:name` picks one; `approval:<id>` pops up a waiting axHub approval) with the single grant `control.console.navigate`,
so a show can never change data, then highlights `highlight` (CSS selector or exact visible text) and shows `say` as a note.
Off: `console_show` answers `shown: false` and nothing opens. `console_follow` reads the switch. REST
`/api/plugins/follow-amber/{state,show,approval,stream}`; CLI `axf follow-amber <command>`. <!-- axf-plugin:follow-amber -->

**Plugins** (`plugins.commands`, `plugins.reads`, build plugin-commands-auto, Nov 3 2026, Brett: "every plugin, existing and
new, automatically exposes all of its commands and reads"): one registry (`core/engines/plugin-commands.mjs`, plugin-commands@1)
made from what every plugin already has — its server routes (GET = a read, POST/PUT/PATCH = a command, DELETE or a deleting word =
destructive), its registered web actions (run in the open console through the Console commands plugin, like `console.actions`),
its data folder (`data`, `data-file`, secrets redacted) and `info` — plus plugin.json `commands` (titles, input schemas, flags,
extra commands, skips that say why). `path` = `<plugin>/<command>`; `plugins.reads` takes `act read`, `plugins.commands` takes
`act run`, both with `input` = what the command takes; `list` filters by `plugin`, `app`, `effect`, `q`. A command that deletes needs
`control.plugins.delete` and a confirm token (the same two-step flow as `remove`). Every transport is generated from the registry
and follows installs and uninstalls by itself: REST `GET|POST|DELETE /api/control/<plugin>/<command>`, MCP tools
`<plugin>_<command>` (annotations from the effect) plus `plugin_commands`, `plugin_read`, `plugin_run`, and the CLI
`axf <plugin> <command> [--field value]…` / `axf plugins [plugin]`. Runner: the Plugin commands plugin
(`apps/console-web/plugins/plugin-commands`, capability `plugin-commands@1`). The lifecycle check fails a plugin whose route or
action can't be exposed, whose declarations name something gone, or that has no reads without saying why (`commands.noReads`).

## Auth

Permissions: `control.<domain>.read | write | delete` (`control.tokens.write`, `control.amberx.delete`, `control.pass.write`, `control.plugins.read`, …), plus
`control.console.navigate` for console verbs that only navigate, declared in an app's
uac-policy; `control.*`, `control.<domain>.*` and `*` are wildcards (the UAC engine's own rule). The console token = the admin role;
a call through axHub carries the hub user's role; a remote caller never exceeds the app's own UAC role (INTEROP.md). The gate, in order:

1. the target exists (`not_found`) and takes the op (`invalid`);
2. the caller's grants cover the permission (`denied`, naming it);
3. the command validates (`validation`, every problem named: unknown token, value out of range, missing input, bad filter);
4. a destructive op carries a valid confirm token (else `confirmation_required` with the token).

Console actions keep their own policy on top: `console.actions run` is gated as `control.console.write`, then the console engine
looks the action up — an action that only navigates (`nav:`, `dialog:`, `settings.open:`, windows, help, search) needs only
`control.console.navigate`; one that `requires` a UAC permission needs it in the caller's grants too; one marked destructive
(`effect: 'destructive'` on the action, or a known destructive id) needs `control.console.delete` and a confirm token, the same
two-step flow as `remove`. The open console then runs it under the signed-in user's own role (`rt.dispatch` checks `requires`).

## Deletes need confirm

`remove` never runs on its first call. The gate answers `confirmation_required` with a **confirm token** bound to the exact command
(op, target, path, action, value: `canonicalControl`) and the server's salt, in ten-minute buckets; the same command sent again with
`confirm: <token>` runs while the token is good (ten to twenty minutes). A different path or value makes a different token, so a
confirm can't be replayed on another record. The CLI prints the token and the exact command to repeat; the MCP tool says so in its
description; the console's docs show the two-step flow.

## Answers

Success: `{ $axf, ok: true, op, target, path?, action?, …data, audit? }` with `data` per op (`list` → `items`, `total`; `get` → `value`
or `item`; `set`/`reset`/`add`/`act` → `changed`, `item?`; `remove` → `removed`); writes carry `audit { by, reason, at }`.
Failure: `{ $axf, ok: false, code, message, … }` with a wire code from INTEROP.md (`invalid`, `denied`, `not_found`, `validation`,
`confirmation_required`, `not_implemented`, `unexpected`); unknown codes read as `unexpected`.

## Projections

- `controlTools()` → the seven MCP tools `control_list … control_act` with input schemas and annotations.
- `controlRoutes()` → REST: `GET /api/control/{target}`, `GET|PUT|DELETE /api/control/{target}/{path}`, `POST …/reset`, `POST …/act/{action}`,
  and `POST /api/control` taking a whole command.
- `controlCli()` → `axf control <op> <target> …` and the aliases.
- `controlSchema()` → the JSON Schema with every target's fields, filters, verbs and static paths under `$defs`.

A new target or verb is added to `CONTROL_TARGETS` (append-only) and every projection, the docs page and the fixture follow.

## Veto passes (control-pass@1)

Status: since Nov 3 2026 (Urgent builds `theme-veto-pass` and `pass-all`, Opus). Reference: `framework/core/engines/control-pass.mjs`
(pure); store, approval and signing: `apps/console-web/plugins/token-control/lib/pass.mjs`. The axHub side is build <!-- axf-plugin:token-control -->
`axhub-veto-pass` plus `axhub-pass-all` (axHub repo); this section is the contract both sides follow.

Brett (Nov 3 2026): "allow everything for the next 30 minutes … It's 30 minutes to do whatever I tell you." Every changing call
through axHub is a veto call (90 s countdown). A **pass** lets every command run at once for a while, after Brett approved the pass
itself once. By default it covers **everything**; a narrower token scope is still there for "only theme changes".

### Scopes

| Scope | Covers | CLI |
|---|---|---|
| `all` (**default**) | every write on every control@1 target (`set`, `reset`, `add`, `remove`, `act`: tokens, AmberX notes / to-dos / tasks / lists, Plan Studio plans, orchestrator builds) and **every call axHub holds** (any service, any tool: console commands, VPS, GitHub, notes vault, …). Ordinary deletes run without the confirm token. | `axf pass grant 30` (`all`, `everything`) |
| `tokens.theme` | `set` / `reset` on `tokens.theme` | `--scope theme` (`colour`, `color`) |
| `tokens.style` | `set` / `reset` on `tokens.style` | `--scope style` |
| `tokens.layout` | `set` / `reset` on `tokens.layout` | `--scope layout` |
| `tokens.*` | the three above | `--scope tokens` |

`PASS_SCOPES` is append-only. A narrow scope never covers `remove`, `add`, `act` or a target outside it. **No pass ever covers the
pass target itself** (`pass.scopes`, the `pass_*` / `token_pass_*` tools): a pass can't grant, approve or widen a pass.

**Irreversible commands** are the exception inside `all`: a delete nothing can bring back. control@1 marks them per target
(`CONTROL_TARGETS[t].irreversible`, today `remove` on `amberx.items` and `amberx.lists`, hard deletes on every device; a plan's
delete keeps its history and a build's is journalled, so those are ordinary); axHub marks its own tools (see below). They still
confirm unless the `all` grant was made with **`include_irreversible: true`** (`axf pass grant 30 --include-irreversible`). The
flag only goes with `all`. A covered irreversible command answers `confirmation_required` with `irreversible: true` and a note.

Word change: until `pass-all`, the CLI word `all` meant `tokens.*`; it now means everything. `tokens` is the word for the three
token scopes.

### Commands

`pass.scopes` takes `list`, `get <scope>` and `act <scope> <verb>`:

| Verb | Input | What it does |
|---|---|---|
| `grant` | `minutes?` (1-240, default 30, capped by the console's *Longest pass* setting), `reason?`, `include_irreversible?` (all only) | files a request; on at once only when the transport carries Brett's approval |
| `approve` / `deny` | `request` | Brett only (see below): turns a waiting request on / refuses it |
| `revoke` | – | ends the scope's pass now and withdraws a waiting request |
| `undo` | – | rolls back what can be rolled back: every token the scope's latest pass changed goes back to its value before the pass first touched it. Everything else (AmberX, planner, other commands) is listed in `notUndoable` (`{at, by, op, target, path?, action?, what}`) and in the answer's `text`, to check by hand. The pass stays as it is |

One pass per scope: an approved grant on a scope that already has an active pass replaces it from the approval on and carries its
change log (so undo still reaches the first change). Requests nobody approves lapse after 15 minutes. **Expiry is the server's
clock** (`passActive(p, now)`); no client decides it.

Transports: REST under the plugin mount `/api/plugins/token-control/pass…` (`GET pass` signed publication, `GET pass/status`, <!-- axf-plugin:token-control -->
`GET pass/check?target=&op=` or `?call=<service.tool>&irreversible=`, `POST pass/grant {scope = all, minutes?, reason?,
include_irreversible?}`, `POST pass/approve|deny {scope, request}`, `POST pass/revoke|undo {scope = all}`, `GET|PUT pass/settings`);
the generic `/api/control` routes and `control_act` with `target: pass.scopes`; MCP `pass_grant` (scope `all` by default),
`pass_status`, `pass_revoke`, `pass_undo` (the `token_pass_*` names are the same tools); CLI `axf pass grant 30`,
`axf pass grant 30 --scope theme`, `axf pass grant 30 --include-irreversible`, `axf pass status`, `axf pass revoke`, `axf pass undo`
(and the older `axf token pass grant theme 30`). Answers carry `text`, one plain sentence: "Every command runs without veto until
10:42 AM (30 min left)." (time zone: the setting, default America/New_York).

### A grant traces to Brett

A command can never say it was approved. The runner takes the approval from the **transport** (`runControl(…, { approver, proof })`):

- `console`: the request came from Brett's signed-in axHub session in the console (wall caller `via: "session"`, admin). The
  banner and the Passes tab send owner actions without the console token, so the session is what the server sees; a bearer
  token (what agents, the CLI and the MCP hold) only ever files a request.
- `axhub`: axHub forwards Brett's own approval of the held `pass_grant` call (a straight approval, never a veto: a pass must
  not turn on by a countdown nobody watched) as `POST pass/approve {scope, request}` with headers
  `X-AXF-Pass-Approver: <hub user>` and `X-AXF-Pass-Approval: t=<ms>,v1=<hex>` where
  `hex = HMAC-SHA256(secret, "<t>.approve.<request>.<scope>.<minutes>.<hub user>")`, with `.irreversible` appended when the request
  has `include_irreversible` (so an approval of a plain pass can't turn on a wider one), good for five minutes. axHub's approval
  page says "Everything for 30 min" (and "irreversible deletes included" when set).
- `local`: a console with no token configured at all (local development).
- `cli-tty`: `axf pass grant|approve` at a real terminal, after typing the scope word back (`all`, `theme`, …). Pipes, scripts and
  agents' shells have no terminal and only file a request.

MCP tools and the `control@1` capability never carry an approval. Deny needs the same proof; revoke and undo don't (they only take
power away or put values back).

### What axHub reads

`GET /api/plugins/token-control/pass` (console token) answers the publication, signed in `X-AXF-Pass-Signature: t=<ms>,v1=<hex>`, <!-- axf-plugin:token-control -->
`hex = HMAC-SHA256(secret, "<t>.<exact response body>")`:

```json
{ "$axf": "control-pass@1", "at": "…", "active": [{ "id": "pass-…", "scope": "all", "label": "Everything", "state": "active",
  "include_irreversible": false, "expiresAt": "…", "remainingMs": 1740000, "warn": false, "covers": ["*"],
  "ops": ["set", "reset", "add", "remove", "act"], "changes": 3, "undoable": 1, "notUndoable": 2, "approvedBy": "brett", "text": "…" }],
  "pending": [], "scopes": { "all": { "targets": ["*"], "ops": [ … ], "includes": [ … ] }, "tokens.theme": { "targets": ["tokens.theme"], "ops": ["set", "reset"] }, … },
  "default": "all", "excluded": ["pass.scopes"], "irreversible": "covered only by an active all pass with include_irreversible: true" }
```

(The `never` field of the theme-veto-pass publication is gone: what a scope covers is its `targets` + `ops`.)

The secret is `AXF_PASS_SECRET`, else `AXF_WALL_SECRET` (the console's copy of the hub's wall secret, already on both sides).
axHub refuses a publication whose signature fails or is older than five minutes.

**Deciding a held call** (axHub, build `axhub-pass-all`):

1. The pass tools (`pass_*`, `token_pass_*`, `control_act` on `pass.scopes`) are never skipped.
2. Is the call irreversible? axHub marks its own tools (a hard delete of a repo, a branch, files on the hub, a database row with
   no history; `irreversible: true` in the tool's hub policy). For the console's control@1 tools, `control_remove` /
   `amberx_remove` on `amberx.items` / `amberx.lists` are irreversible (`pass/check` answers `irreversible`).
3. If an active pass with `scope: "all"` and `expiresAt` ahead of axHub's own clock is published, and the call isn't irreversible
   or the pass has `include_irreversible: true`: run the call at once (no countdown, no hold) and note the pass id on the job.
4. Otherwise, for a control@1 `set` / `reset` on a token target, a narrow pass whose `covers` has the target and `ops` the op
   covers it as before.
5. Else hold it as usual.

`GET pass/check?call=<service.tool>&irreversible=true|false` answers step 3 for one call (`{scope: "all", covered, pass?}`);
`GET pass/check?target=…&op=…` answers it for one control@1 command (`{scope, irreversible, covered, pass?}`).

**Inside the console** the runner applies the same rule: a control@1 write an active pass covers runs; a `remove` it covers runs
without the confirm token (`confirmSkipped: true` on the answer); an irreversible one still confirms unless the pass includes
irreversible commands.

**Stamp on every answer**: every control@1 write answer carries `passScope` (the narrowest scope a pass would need: the token scope
for token set / reset, `all` for every other write, `null` for the pass target) and, when an active pass covered it,
`pass {id, scope, expiresAt}`, so axHub and the logs see which pass a change ran under.

### Visibility and safety

- Banner chip (Pass): one chip per active pass, **"Everything: 29:41 left"** (or the scope name: "Theme: 4:10 left"; "+irreversible"
  when included) with **Extend**, **Undo N**, **Revoke**; it turns to the warning tone with "ending soon" two minutes before the
  end. Waiting requests show as "<who> asks: everything without veto for 30 min" with **Approve** / **Deny**.
- Every grant, request, approval, change (who, token, old → new; or the command for anything else), revoke, undo (with what it
  couldn't roll back) and end is one audit row (`audit.jsonl`, with the pass id) and one line under `## Token passes (log)` in
  THREADS.md (the hub's copy where mounted).
- Each pass keeps its changes (bounded to 400, the first touch of every token always kept so undo is exact).

### Recommended axHub policy for the console MCP

| Tool kind | Policy | Why |
|---|---|---|
| `readOnlyHint: true` (every `*_list`, `*_get`, `*_status`, `*_find`, `overview`, `build_queue`, `build_next`, `pending_list`, `pending_steps`, `project_*` reads, `tracker_summary`, `libraries`, `build_options`, `app_validate`, `terminal_tail`, `pass_status`, `token_pass_status`) | **allow**: run at once, no veto | they change nothing; `apps/console-web/server/test_mcp_tools.py` fails CI if a read tool loses the hint |
| navigation (`console_open`, `console_dialog`, `console_settings`, `console_back`, `console_refresh`, `console_show`, `console_follow`: `readOnlyHint: true`) | **allow**: run at once, no veto | they only open or move the screen, never change data (Brett, Nov 3 2026: navigation never waits 90 s); `console_action` stays a write because an action can change data |
| writes (`readOnlyHint: false`, `destructiveHint: false`) | **veto** (90 s), skipped while an `all` pass (or a narrow pass covering the call) is on | normal changes |
| `destructiveHint: true` (`control_remove`, `amberx_remove`) | **confirm**; skipped while an `all` pass is on, unless the call is irreversible and the pass doesn't include irreversible | deletes; the runner applies the same rule to its confirm token |
| `pass_grant`, `token_pass_grant` | **approval** (straight, not veto), forwarded as the signed approval above; never skipped | a pass must trace to Brett |
