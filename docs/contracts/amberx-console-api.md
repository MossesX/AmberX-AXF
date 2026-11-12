# AmberX console API — amberx-console-api@1

Status: contract, Nov 12 2026 (build `move-amberx-web-app-into-the-console-amberx-andr`, step s1, Fable). Brett (Nov 12 2026):
"Now what we're gonna end up doing is just moving everything over the console and making AmberX app read the console instead of
AmberX." This document is the one source for what the phone calls once the AmberX web app (`apps/amberx-droid`, served at
`https://amberx.amberxai.com` by `server/main.py`) is folded into the Dev Console (`apps/console-web`, `https://console.amberxai.com`).
Every later step of the build (s2 to s15) implements a row of this document; a route or tool that is not here is added here first.

Companion specs: `framework/spec/CONTROL.md` (control@1: the `amberx`, `console` and `plugins` domains this contract reuses),
`framework/spec/INTEROP.md` (wire codes), `framework/python/axf_server/wall.py` (who is calling behind axHub's sign-in wall),
`apps/console-web/plugins/plugin-commands` (plugin-commands@1: how a plugin route becomes an MCP tool and a CLI command).

## 1. What changes, in one paragraph

Today the phone (the Capacitor shell plus the native Java in `android/app/src/main/java/ai/amberx/droid`) loads the AmberX site,
calls the AmberX server for AI, Molly, the walkthrough, the approvals relay and forwarded console plugins, calls **axHub** directly
for sign-in, the approvals feed, approve / deny / veto actions, the notes and recordings tables (`/data/...`) and the AXPP device
link, and reads the **console** only for alerts. After this contract the phone loads the console site and calls the **console** for
everything the AmberX server did and for everything the hub's data server held (notes, lists, to-dos, recordings, settings). Only
three things stay on axHub, because axHub owns them: the sign-in session (the wall), the approvals ledger (approve / decline /
deny / approve-now / shelve are hub decisions; the console relays them as it does today for its own browser), and the AXPP device
link (axHub decision #108) until s8 and s12 move `open_url` and the recorder commands onto the console's own stream.

## 2. Auth and token rules

One rule set for every caller of every route below. Nothing here is new: it is the console's existing wall and token model
(`apps/console-web/server/main.py`, `server/wall.py`), stated so the phone and the AmberX server forwarding (s11) follow it exactly.

| Caller | How it signs | What it reaches |
|---|---|---|
| The phone's WebView (the console site loaded in the shell) | The axHub session cookie. `console.amberxai.com` and `axhub.amberxai.com` share the parent domain, so the one hub sign-in covers both; the wall in front of the console adds the signed headers (`X-Auth-Via: session`, user, role, perms, signature). | Everything a hub **admin** reaches. A plain hub **user** reaches the page, read-only framework routes and `wallUsers` / granted plugins only (`wall.user_may`). Browser writes must come from the console's own origin (`wall.same_origin`). |
| Native Java (`WatchService`, `VetoAlerts`, `OutputRecordUploader`, `AxppLink`) | The same hub session, read from Android's cookie store, sent as `Cookie` to the console host. Never follows a redirect, replies capped (`HubRules.readLimited`, 256 KB). | The same as the WebView. A reply that is not `200` JSON means signed out: the service shows "sign in at the hub" and never falls back to anonymous. |
| A machine (CI, the AmberX server's forwarding in s11, a Claude session) | `Authorization: Bearer <AXF_TOKEN>` (the console token from the token file `.axf-console/env`; never a GitHub or hub token). The hub marks it `X-Auth-Via: token` and the console checks the token on every route, reads included. | Admin role. |
| axHub calling the console's MCP | Bearer `AXF_TOKEN` on `/mcp`; the hub user's role rides along and never exceeds the console's own UAC role (INTEROP.md). | Per control@1 permissions (`control.amberx.*`, `control.console.*`, `control.plugins.*`). |

Rules:

1. **No token in the page, ever.** The phone's web code holds no console token; it signs with the session. `src/console/plugins.ts`
   (`noToken`) is already written this way. The native side holds the hub session only; it is excluded from backups (as today).
2. **Admin-only writes.** Every route that changes data under this contract is admin or token only, as every AmberX server write is
   today (`USER_ROUTES` in `server/main.py` is the full list of what a plain user may call; it carries over unchanged as the
   `wallUsers` set of the AmberX plugin group).
3. **Decisions need the person.** Approve / decline / deny / approve-now / shelve run only for a signed-in admin **browser** with the
   hub cookie (`approvals-banner/server` `_admin_browser`), or natively with the phone's session straight to the hub. The console
   token is refused there, exactly as the AmberX server refuses `AMBERX_TOKEN` on `/api/approvals/decide`. MCP and CLI cannot decide
   an approval; they can list and open one.
4. **Destructive calls confirm.** A `remove` (an item, a list, a recording, a notification) answers `confirmation_required` with a
   confirm token on the first call and runs on the second (CONTROL.md, Deletes need confirm). The phone UI performs the two calls
   behind one "Delete" tap plus the framework's confirm dialog; MCP and CLI show the token.
5. **Reason on every write.** Writes carry `by` and `reason` (audited); the phone sends `by: "amberx:<device>"` using the device name
   the notes store already keeps (`amberx.device`).
6. **Body caps.** 256 KB per request (chat images through forwarded plugins: 12 MB, as today); recordings go up as 44 000-byte parts
   (section 4.6), never as one file.
7. **Same-origin for session writes.** A browser-session `POST`/`PUT`/`DELETE` must carry the console's own `Origin`; the native
   side sends `Origin: https://console.amberxai.com` on its writes (as it sends the hub as Origin today).

### Versioning

- This contract is `amberx-console-api@1`. Every JSON answer that is a document carries its `$axf` format
  (`amberx-notes@1`, `audio-recording@1`, `alert@1`, `listener-state@1`, `hub-settings@1`), unchanged from today, so no stored
  data changes shape.
- Routes are not prefixed with a version. A breaking change to a route's shape ships as a **new route** beside the old one and a new
  row here; the old route stays until no phone build calls it (the s11 request log says when). The console's `GET /api/me` gains
  `"amberx": { "api": 1 }` so the phone can refuse to run against a console that is too old (the "console too old" screen in s12).
- MCP tool names and control@1 target names are append-only (CONTROL.md: "A new target or verb is added ... append-only").
- The phone's `capacitor.config.json` `server.url` moves to `https://console.amberxai.com`; `allowNavigation` becomes that host plus
  the hub. The s13 switch (`amberx.backend` = `console` | `amberx-web`, default `console`) picks the host at start, so a bad console
  deploy rolls back without a new APK.

## 3. Everything the phone calls today

Collected from `server/main.py`, `src/native.ts`, `src/plugins/*/web`, `src/console/plugins.ts` and the Java under
`android/app/src/main/java/ai/amberx/droid`. "Host" says who answers today.

| # | Feature | Call today | Host | Payload (today) |
|---|---|---|---|---|
| T1 | Health, who am I | `GET /api/health`, `GET /api/me` | AmberX server | `{ok, app}`; `{wall, hub, user, admin}` |
| T2 | AI: status, parse a sentence to an intent, summarize, ask my notes, free prompt | `GET /api/ai/status`; `POST /api/ai/parse {transcript, lists[], today}`; `POST /api/ai/summarize {text}`; `POST /api/ai/ask {question, notes[]}`; `POST /api/ai/prompt {prompt, notes[]?}` | AmberX server (`router.py`, keys in `$AMBERX_DATA_DIR/ai.json`) | answers `{intent, answeredBy, model}`, `{title, summary, tags}`, `{answer}` |
| T3 | AI settings (admin) | `GET|PUT /api/ai/config`; `POST /api/ai/keys/{id}`; `POST /api/ai/profiles`; `POST /api/ai/primary/{id}`; `POST /api/ai/test/{id}` | AmberX server | provider profiles without keys, order, active, Claude plan/api switch |
| T4 | Molly | `GET /api/ai/molly/status`; `POST /api/ai/molly {task, page?, app?}` | AmberX server, forwarded to the console's `molly-guide` plugin | `{answer, walkthrough?}` |
| T5 | Walkthrough videos | `GET /api/walkthrough/{name}`, `.../walkthroughs.json`, `.../{wid}/{name}`, `.../{wid}/chapters/{name}`; `POST /api/walkthrough/{wid}/render` | AmberX server (files in `$AMBERX_DATA_DIR/walkthrough`); render forwarded to the console | mp4 with Range, vtt, chapters.json, poster |
| T6 | Approve / decline in place from the page | `GET /api/approvals/relay`; `POST /api/approvals/decide {id, action, rev?}` | AmberX server, relayed to the hub with the browser's cookie | `{ok, state}` |
| T7 | Console plugins loaded in AmberX (AI assistant, Agent manager, Agent voice, Approvals banner, Audio extract, Builds, Chat viewer, Output recorder, Plan Studio) | `ANY /api/console/plugins/{folder}/{rest}` | AmberX server, forwarded to `console/api/plugins/{folder}/{rest}` with the console token | pass-through, SSE kept |
| T8 | Sign-in, session, CSRF | `GET /auth/api/session` (native); hub sign-in page in `HubWebActivity` | axHub | `{signedIn, admin, csrf}` |
| T9 | Approvals feed (watch service, page) | `GET /auth/admin/approvals.json` | axHub | `{pending[], count, signedIn, admin}` |
| T10 | Approve / decline / veto actions, auto-approve | `POST /auth/api/approvals/{id}/approve|decline|deny|approve-now|shelve` (hub Origin + CSRF) | axHub | hub status |
| T11 | Notes, lists, to-dos, tasks (amberx-notes@1) | `GET|PUT /data/amberx-axf/amberx-notes/{lists|items}/head.json` (+ `rows-N.json`), `If-Match` ETag, through lib-hubstore; `hubGet` / `hubPut` natively | axHub data server | hub-table@1 documents; the page queues ops in `localStorage` `amberx.notes.queue` while offline |
| T12 | Voice notes (read-only in AmberX) | `GET /data/amberx-axf/voice-notes/...` | axHub data server | hub-table@1 |
| T13 | App settings on every device (hub-settings@1), appearance | `GET|PUT /data/_shared/settings/apps/amberx-droid.json`, `.../settings/appearance.json` | axHub data server | per-key merge, mirrored by lib-hubsync |
| T14 | Recorder uploads | `PUT /data/amberx-recordings/output-recorder/parts/{id}/NNNN.json` (`audio-part@1`), `PUT .../recordings/{id}.json` (`audio-recording@1`), then read back to confirm | axHub data server | 44 000-byte base64 parts, SHA-256 index |
| T15 | Recorder transcripts | `GET /api/console/plugins/output-recorder/status`, `POST .../run` | console (through T7) | worker status | <!-- axf-plugin:output-recorder -->
| T16 | Recorder remote and open_url (AXPP) | `POST /axpp/v1/hello|next|answer` (`X-AXPP: axpp@1`), capabilities `recorder@1`, `open-url@1`; commands `recorder.start|stop|status`, `browser.open {url, browser}` | axHub device relay; the console asks the hub (`console-commands/server/wake.py`, tool `amberx.open_url`) | long poll, answers `{opened, notified}` |
| T17 | Console alerts as phone notifications | `GET https://console.amberxai.com/api/alerts` (`view=phone` or a `Dalvik/` UA) | console | `{alerts[], unread, version, notify: {off[]}}` |
| T18 | Listeners (listener@1) | native registry (`ListenerRegistry`), policies through T13; the console reads devices from `/projects/amberx-axf/_data/listeners/devices` | hub data + console plugin `amberx-listeners` | `{micOff, micHolder, listeners[]}` |
| T19 | Veto alarm, quiet, mic off, talk mode, hands-free, monitor start/stop | native only (`AmberxNative` plugin methods) | the phone | no network |

## 4. The contract: what the phone calls after the move

Prefix `C` = console route. Every row names the REST route, the MCP tool, the CLI form and the voice phrase (AmberX voice registers
one phrase set per action through `registerVoiceCommands`; Amber on the console reads the same MCP tools), so a feature is reached
the same four ways (Brett, Nov 8 2026: everything comes with an API). Deep links use `console_open` / `console_show` targets.

### 4.1 Identity and health

| Call | Replaces | REST | MCP | CLI | Notes |
|---|---|---|---|---|---|
| C1 | T1 | `GET /api/health` → `{ok, app: "console", amberx: {api: 1}}`; `GET /api/me` → `{wall, hub, user, admin, role, plugins[], amberx: {api: 1}}` | `overview` | `axf me --remote` | `amberx.api` is this contract's version. The phone refuses a console without it (section 2). |

### 4.2 Notes, lists, to-dos and tasks (amberx-notes@1)

The store stays amberx-notes@1 in hub project `amberx-axf`, folder `amberx-notes/`, tables `lists` and `items`; the console already
reads and writes those files on the mounted `/projects` volume (`token-control/lib/amberx.mjs`, `notesDir()`), so **no data moves**
for notes (s2 adds the migration for what did live only in the AmberX server: `ai.json` profiles and the walkthrough files). The
phone stops writing hub-table documents itself and sends intents to the console; the console applies them with the same
`validateIntent` → `applyIntent` core (generated into `token-control/lib/amberx-core.mjs` by `gen-amberx-core.mjs`).

| Call | Replaces | REST (control@1, mounted at `/api/control`) | MCP | CLI | Voice |
|---|---|---|---|---|---|
| C2 list items | T11 read | `GET /api/control/amberx.items?kind=&list=&status=&due=&tag=&q=&pinned=&starred=&limit=` → `{items[], total}` | `amberx_find`, `control_list(target="amberx.items")` | `axf note list`, `axf todo list`, `axf task list` | "what's on my list", "read my inbox" |
| C3 get item | T11 read | `GET /api/control/amberx.items/{id}` → `{item}` | `control_get` | `axf note get <id>` | "read note <n>" |
| C4 add item | T11 write | `POST /api/control/amberx.items {value: {kind, text, title?, list?, due?, tags?, priority?, checklist?}, by, reason}` → `{changed, item}` | `amberx_add` | `axf note add "…" --list inbox`, `axf todo add`, `axf task add --due` | "note in work: …", "add a todo … by friday" |
| C5 change item | T11 write | `PUT /api/control/amberx.items/{id} {value: fields}` | `amberx_update` | `axf note set <id> --title …` | "rename the last note to …" |
| C6 item verbs | T11 write | `POST /api/control/amberx.items/{id}/act/{done|undone|move|merge|pin|star|check} {input}` | `amberx_done`, `amberx_move`, `control_act` | `axf todo done <id>`, `axf note move <id> --list ideas` | "tick off …", "move the last note to ideas", "pin that" |
| C7 remove item | T11 write | `DELETE /api/control/amberx.items/{id}` (two-step confirm) | `amberx_remove` | `axf note remove <id>` then with `--confirm` | "delete that note" (AmberX asks "Delete <title>?" and sends the confirm on yes) |
| C8 lists | T11 | `GET /api/control/amberx.lists?parent=&q=`; `POST /api/control/amberx.lists {value: {name, parent?, icon?, aliases?}}`; `PUT .../{id}`; `POST .../{id}/act/{move|reorder|rename}`; `DELETE .../{id}` (system lists `inbox`, `plugins`, `voice-notes` refuse) | `control_list|add|set|act|remove(target="amberx.lists")` | `axf list …` | "make a list called groceries", "give me the list of lists" |
| C9 intent | T2 parse + apply | `POST /api/control/amberx.items/intent/act/apply {input: {intent}}` → applies one validated amberx-notes@1 intent (the local parser's or the AI's) | `control_act(target="amberx.items", path="intent", action="apply")` | `axf amberx intent '<json>'` | every sentence the voice plugin parses locally goes through this |
| C10 bulk sync | T11 offline queue | `POST /api/control/amberx.items/queue/act/flush {input: {ops[]}}`: the phone's queued ops (`{table, id, row|null}`) applied in order, idempotent by `(id, updatedAt)`; answers `{applied, skipped, store: {lists, items}}` | not an MCP tool (phone-only) | `axf amberx flush <file>` | none |
| C11 live changes | T11 polling | `GET /api/control/amberx.items/stream` (SSE, `event: changed {table, ids[], at}`) so every device sees a change without reloading | none | `axf amberx watch` | none |
| C12 export | notes Export view | `GET /api/control/amberx.lists/{id}/export.md` | `control_get(path="<id>/export")` | `axf list export <id>` | "export my work list" |

Deep links: `console_open("amberx-notes", focus="<list id>")` opens the Notes screen on a list; `console_open("amberx-notes",
focus="item:<id>")` opens one item; `console_show({target: "screen:amberx-notes/<list>"})` while Follow Amber is on. Tasks:
`console_open("amberx-tasks", focus="today|upcoming|todo|all|done")`.

Built in s3 (console plugin `amberx-notes`, Apps → AmberX → Notes): the Notes screen over C2–C8; its own routes <!-- axf-plugin:amberx-notes -->
`GET state`, `GET|PUT settings`, `POST settings/reset` (MCP `amberx-notes_state`, `amberx-notes_settings`, <!-- axf-plugin:amberx-notes -->
`amberx-notes_set-settings`, `amberx-notes_reset-settings`; CLI `axf amberx-notes …`); deep link focus `<list id>`, <!-- axf-plugin:amberx-notes -->
`item:<id>`, `search:<words>` or `new` (action `amberx-notes.focus`); voice "open notes", "new note", "read my inbox". <!-- axf-plugin:amberx-notes -->

Built in s4 (console plugin `amberx-tasks`, Apps → AmberX → To-dos): tabs Today · Upcoming · To-dos · All · Done over C2–C7; <!-- axf-plugin:amberx-tasks -->
its own routes `GET state` (counts per tab, overdue), `GET items?tab=&list=&q=&limit=`, `POST add {text, kind?, list?, due?}`, <!-- axf-plugin:amberx-tasks -->
`POST complete {id, done?}`, `POST reorder {ids[]}` (control@1 `set order` per item), `POST remove {id, confirm?}` (two-step), <!-- axf-plugin:amberx-tasks -->
`GET|PUT settings`, `POST settings/reset` (MCP `amberx-tasks_<id>`, CLI `axf amberx-tasks <id>`); the items stay control@1 <!-- axf-plugin:amberx-tasks -->
`amberx.items` (kind `todo` | `task`), so `control_*`, `amberx_*` and `axf todo …` reach the same rows. Deep link focus <!-- axf-plugin:amberx-tasks -->
`today|upcoming|todo|all|done`, `item:<id>` or `new` (action `amberx-tasks.focus`); voice "what's due today", "show todos", "new todo". <!-- axf-plugin:amberx-tasks -->

Built in s4 (console plugin `amberx-tasks`, Apps → AmberX → To-dos): tabs Today · Upcoming · To-dos · All · Done over <!-- axf-plugin:amberx-tasks -->
C2–C7; routes `GET state`, `GET items?tab=`, `POST add|complete|reorder|remove`, `GET|PUT settings` (MCP <!-- axf-plugin:amberx-tasks -->
`amberx-tasks_*`; CLI `axf amberx-tasks …`; `reorder` sets control@1 `order` per item, so `axf todo set <id> --field <!-- axf-plugin:amberx-tasks -->
order=N` is the same); deep link focus as above plus `item:<id>`, `new`; voice "what's due today", "show todos", "new todo". <!-- axf-plugin:amberx-tasks -->

Built in s5 (console plugin `amberx-lists`, Apps → AmberX → Lists): the list tree over C8 and the items of one list; <!-- axf-plugin:amberx-lists -->
routes `GET state|list|export`, `POST lists/add|rename|move|remove`, `POST items/add|edit|check|remove`, `GET|PUT settings` <!-- axf-plugin:amberx-lists -->
(MCP `amberx-lists_*`, CLI `axf amberx-lists …`); C12's Markdown export is `GET export?id=` there. Deep link focus <!-- axf-plugin:amberx-lists -->
`<list id>` or `new`; voice "open lists", "make a new list". <!-- axf-plugin:amberx-lists -->

Voice notes (T12) stay read-only under the `voice-notes` system list; the console's `voice-notes` plugin keeps owning them.

### 4.3 AI

The AI router (`server/router.py`) and its intent checker (`intent.py`) move into a console plugin `amberx-ai` (s3 brings it
with notes, since parse needs the lists). Keys move from `$AMBERX_DATA_DIR/ai.json` into the console credential store
(`server/credentials.py`), by the s2 migration; the console's `ai-keys` plugin lists them. Molly needs no route: the phone calls
the console's `molly-guide` plugin directly (C21).

| Call | Replaces | REST (`/api/plugins/amberx-ai/...`) | MCP (plugin-commands@1) | CLI | Voice |
|---|---|---|---|---|---|
| C13 | T2 status | `GET status` → `{ok, provider, model, reason, checkedAt, answeredBy}` | `amberx-ai_status` | `axf amberx-ai status` | "is the AI up" |
| C14 | T2 parse | `POST parse {transcript, lists[], today}` → `{intent, answeredBy, model}` (422 when no usable intent) | `amberx-ai_parse` | `axf amberx-ai parse --transcript "…"` | internal: the voice plugin's AI fallback |
| C15 | T2 summarize | `POST summarize {text}` → `{title, summary, tags[]}` | `amberx-ai_summarize` | `axf amberx-ai summarize` | "summarize this note" |
| C16 | T2 ask | `POST ask {question, notes[]}` → `{answer, answeredBy}`; `notes` optional: left out, the server loads the caller's own notes (C2) | `amberx-ai_ask` | `axf amberx-ai ask "…"` | "ask my notes …" |
| C17 | T2 prompt | `POST prompt {prompt, notes[]?}` → `{answer}` | `amberx-ai_prompt` | `axf amberx-ai prompt` | AI snippets and chains |
| C18 | T3 config | `GET|PUT config`; `POST keys/{id} {key, refresh?} | {clear: true}`; `POST profiles {kind, label?, key, refresh?, primary?}`; `POST primary/{id}`; `POST test/{id}` | `amberx-ai_config`, `amberx-ai_profiles`, `amberx-ai_primary`, `amberx-ai_test` (`keys` is skipped from MCP: a secret never crosses MCP) | `axf amberx-ai config`, `axf amberx-ai key <id>` (prompts) | "switch the AI to Claude plan" |

Plain hub users keep `status`, `parse`, `summarize`, `ask`, `prompt` (the plugin is `wallUsers: true` for those routes);
everything else is admin.

Deep link: `console_settings("plugins/amberx-ai")`.

### 4.4 Approvals

Approvals are axHub's. The console already has the relay the AmberX server has (`approvals-banner/server`: `GET relay`,
`POST decide`), and the Approvals banner plugin already targets `amberx-droid`. Nothing new is designed; the phone just calls the
console's copy. Natively the phone keeps posting decisions straight to the hub with its session (T10): it is the shortest path and
the hub is the authority. The watch service's feed read (T9) moves to the console (C20) so the console is the one place that
knows what is waiting, and it also tells the phone about veto calls and console-side approvals (planner approvals, UI Review).

| Call | Replaces | REST | MCP | CLI | Voice |
|---|---|---|---|---|---|
| C19 relay | T6 | `GET /api/plugins/approvals-banner/relay` → `{ok, relay, via, reason}`; `POST /api/plugins/approvals-banner/decide {id, action, rev?}` (admin browser, same origin, cookie; token refused) | none (a person's tap only; declared `skip` in the plugin manifest) | none | "approve that", "deny it" run through the phone's native action with the person's session, never a token | <!-- axf-plugin:approvals-banner -->
| C20 feed | T9 | `GET /api/plugins/approvals-banner/pending?since=<version>` → `{pending[{id, tool, summary, url, status, rev, secondsLeft?}], count, version, signedIn, admin}`; `GET .../pending/stream` (SSE) | `approvals_pending` (read) | `axf approvals pending` | "anything waiting?" (reply `{waiting}`) | <!-- axf-plugin:approvals-banner -->
| C20a auto-approve | T10 auto | stays native: `POST <hub>/auth/api/approvals/{id}/approve` with the phone's session, under the monitor rules (`monitor/web/core.ts`: never `amberx.recorder_start`, `vps.run` only when named). The console exposes the rules as settings (C32) but never approves. | none | none | none |

Deep links: `console_open("approvals", focus="<approval id>")`; `console_dialog("approvals.veto", arg="<id>")` for a held veto call.

Built in s6 (Approvals banner plugin): the Approvals page (view `approvals`, action `approvals.focus:<id>`) lists every <!-- axf-plugin:approvals-banner -->
waiting and held call with Review and comments. C20 is `GET pending?since=` from the console's own watch (the stream <!-- axf-plugin:approvals-banner -->
is left for s12: the phone polls `since`). New: `GET approval?id=`, `GET comments?id=`, `POST comment {id, text}` <!-- axf-plugin:approvals-banner -->
(axHub has no comment field: comments stay on the console and never decide), `GET|PUT settings` (`pollSeconds`, <!-- axf-plugin:approvals-banner -->
`keepComments`). MCP `approvals-banner_pending|approval|comments|comment|settings|set-settings`. Deciding is unchanged <!-- axf-plugin:approvals-banner -->
(rule 3): `decide` stays skipped from MCP and the CLI. Voice "open the approvals page", "check approvals". <!-- axf-plugin:approvals-banner -->

### 4.5 Molly, walkthroughs, forwarded console plugins

| Call | Replaces | REST | MCP | CLI |
|---|---|---|---|---|
| C21 Molly | T4 | `GET /api/plugins/molly-guide/walkthroughs`; `POST /api/plugins/molly-guide/ask {task, app: "amberx", page?}` → `{text, walkthrough?}` | `molly-guide_ask` | `axf molly-guide ask` | <!-- axf-plugin:molly-guide -->
| C22 walkthrough media | T5 | `GET /api/plugins/molly-guide/amberx-walkthrough/{wid}/{name}` (mp4 with `Range`, vtt, chapters.json, poster.jpg, `?download=1`), `.../walkthroughs.json`, `.../{wid}/chapters/{name}`; files move from `$AMBERX_DATA_DIR/walkthrough` to the plugin's `dataDir` (s2) | `molly-guide_walkthroughs` | `axf molly-guide walkthroughs` | <!-- axf-plugin:molly-guide -->
| C23 re-voice | T5 render | `POST /api/plugins/molly-guide/amberx-walkthrough/rerecord {walkthrough, voiceOnly, overrides: {voice, speed, lines}, chapter?}` (the same `walkthrough_edits` limits: 10 voices, speed 0.75–1.3, 600 lines, 64 KB) | `molly-guide_rerecord` | `axf molly-guide rerecord` | <!-- axf-plugin:molly-guide -->
| C24 console plugins in AmberX | T7 | the phone calls `/api/plugins/{folder}/{rest}` on the console directly; `src/console/plugins.ts` `pluginUrl` drops the `/api/console/plugins/` hop. The forwarder in `server/main.py` becomes the s11 proxy. | unchanged | unchanged |

### 4.6 Recorder

Recordings keep `audio-recording@1` and `audio-part@1` in hub project `amberx-recordings` (the console's `output-recorder`
transcripts already read that folder from `/projects`). The phone uploads to the console instead of the hub's data server; the
console writes the same files, so the transcript worker and the AmberX page read nothing new.

| Call | Replaces | REST (`/api/plugins/output-recorder/...`) | MCP | CLI | Voice | <!-- axf-plugin:output-recorder -->
|---|---|---|---|---|---|
| C25 upload part | T14 | `PUT recordings/{id}/parts/{n}` body `{$axf: "audio-part@1", id, n, b64}` (≤ 64 KB) → `{ok, n, sha256}`; idempotent | none (phone-only) | `axf output-recorder upload <dir>` | none |
| C26 upload index | T14 | `PUT recordings/{id}` body `audio-recording@1 {id, name, startedAt, endedAt, parts, bytes, sha256, session?, mic}` → `{ok, confirmed}`; `confirmed` true only when every part is on disk and the SHA-256 matches, which is when the phone deletes its local copy (as `OutputRecordUploader` does today) | none | none | none |
| C27 list / get | new (the page listed by reading hub tables) | `GET recordings?since=&limit=` → `{recordings[], total}`; `GET recordings/{id}` → the index plus `transcript?`; `GET recordings/{id}/audio` streams the parts joined (`Range` honoured) | `output-recorder_recordings`, `output-recorder_recording` | `axf output-recorder list`, `axf output-recorder get <id>` | "play the last recording" |
| C28 remove | new | `DELETE recordings/{id}` (two-step confirm; irreversible) | `output-recorder_remove` | `axf output-recorder remove <id>` | "delete that recording" (confirm by voice) |
| C29 transcripts | T15 | `GET status`; `POST run`; `POST recordings/{id}/transcribe` | `output-recorder_status`, `output-recorder_run`, `output-recorder_transcribe` | `axf output-recorder run` | "transcribe the last recording" |
| C30 remote start / stop / status | T16 recorder commands | `POST recordings/act/start {session, mic?}` → an approval on axHub first (never auto-approved), then the phone's own Android consent prompt; `POST recordings/act/stop`; `GET device/status` → `{on, since, session, file, uploadedParts, queue}` as the phone last published it | `output-recorder_start` (writes; axHub veto), `output-recorder_stop`, `output-recorder_device_status` | `axf output-recorder start --session …` | "start recording" (replies "waiting for your approval"), "stop recording" |

The phone receives start / stop over the device stream (C36) once s12 lands; until then the AXPP link stays (T16) and the console
plugin forwards start / stop to axHub's `amberx.recorder_start|stop` tools, which is what the AmberX server's Molly path already
does for other hub tools.

Deep links: `console_open("output-recorder", focus="<recording id>")`.

Built in s7 (Audio Output Recorder plugin, `server/recordings.py`): C25–C30 as above, plus `POST device/status` (the <!-- axf-plugin:output-recorder -->
phone publishes, `GET device/status` reads) and `GET|PUT settings` (`autoTranscribe`, `listLimit`). The delete confirm <!-- axf-plugin:output-recorder -->
token is the plugin's own (HMAC over the id, five-minute window); a deleted recording keeps a tombstone index. Start / <!-- axf-plugin:output-recorder -->
stop call axHub's `amberx.recorder_start|stop` until s12's device stream. The screen gains "Recordings on the console" <!-- axf-plugin:output-recorder -->
(play, transcript, transcribe, delete, remote start / stop, phone status); action `output-recorder.focus:<id>`. <!-- axf-plugin:output-recorder -->

### 4.7 open_url

| Call | Replaces | REST (`/api/plugins/console-commands/...`) | MCP | CLI | Voice | <!-- axf-plugin:console-commands -->
|---|---|---|---|---|---|
| C31 send | T16 `browser.open` | `POST open-url {url, browser?: "chrome"|"default", to?: "<device id>"}` → `{id, state: "queued"|"sent"|"opened"|"notified"|"refused", reason?}`; the console checks the URL with the same rule as `OpenUrlRules.allowed` (https, `amberxai.com` or a subdomain, no user info, default port, ≤ 2000 chars) and the phone checks it again | `console-commands_open_url` | `axf console-commands open-url https://console.amberxai.com/?axf-cmd=…` | "open the console on my phone" |
| C31a state | new | `GET open-url?since=` → `{items[{id, url, state, at, device}]}`; `POST open-url/{id}/cancel` | `console-commands_open_url_list`, `..._cancel` | `axf console-commands open-url list` | none |
| C31b settings | new | part of C32 (`amberx.openUrl.browser`, `amberx.openUrl.notifyWhenBlocked`) | `control_set(target="amberx.settings", …)` | `axf amberx set openUrl.browser default` | "open links in the default browser" |

Delivery: through the device stream (C36) when the phone is connected; through axHub's `amberx.open_url` (today's path,
`wake.py`) when it is not, so the console wake (Nov 3 2026) keeps working during the switch.

Built in s8 (Console commands plugin, `server/open_url.py`): C31 / C31a as above with the MCP names <!-- axf-plugin:console-commands -->
`console-commands_open-url`, `console-commands_open-url-list`, `console-commands_open-url-cancel` (plugin-commands ids). <!-- axf-plugin:console-commands -->
Until C36 the phone's pick-up is `GET open-url/pending?device=` and `POST open-url/{id}/answer {opened, notified, error?}`; <!-- axf-plugin:console-commands -->
a phone that polled in the last 20 s gets the URL queued, otherwise it goes through axHub at once. Settings (the <!-- axf-plugin:console-commands -->
plugin's own until s10 mirrors them as `openUrl.*`): `browser`, `openUrlViaHub`, `openUrlNotifyWhenBlocked`. The panel <!-- axf-plugin:console-commands -->
"Open a page on the phone" is under Settings → Plugins → Console commands. <!-- axf-plugin:console-commands -->

### 4.8 Notifications

The console's alerts hub (`server/alerts.py`, `alert@1`) already answers the phone (T17). It becomes the one notification feed:
approvals waiting, veto calls, builds, CI, deploys, merge failures, systems check, FYIs (s15: "I want all the notifications ...
through the console"). Nothing new in the shape; the additions are per-device delivery state and history.

| Call | Replaces | REST (`/api/alerts...`) | MCP | CLI | Voice |
|---|---|---|---|---|---|
| C33 feed | T17 | `GET /api/alerts?view=phone&since=<version>` → `{alerts[alert@1], unread, version, notify: {off[]}}`; `GET /api/alerts/stream` (SSE) | `alerts_list` | `axf alerts` | "what's new" |
| C34 raise | new for AmberX | `POST /api/alerts {source, severity, title, body, key?, link?, meta?}`; `POST /api/alerts/test` | `alerts_raise`, `alerts_test` | `axf alerts raise …` | none (machines raise) |
| C35 read / dismiss / resolve | T17 (`ack` / `resolved` flags) | `POST /api/alerts/ack {ids[]}`; `POST /api/alerts/dismiss {ids[]}`; `POST /api/alerts/resolve {keys[]}` | `alerts_ack`, `alerts_dismiss`, `alerts_resolve` | `axf alerts ack <id>` | "dismiss that", "mark them read" |
| C35a types and quiet | T17 `notify.off` | the `notify-control` plugin's `GET state|types`, `POST set|master|app|quiet|test|reset`, groups and triggers, unchanged (`/api/plugins/notify-control/...`) | `notify-control_*` | `axf notify-control …` | "quiet for an hour" | <!-- axf-plugin:notify-control -->
| C35b history | new | `GET /api/alerts/history?device=&since=&limit=` → every alert delivered to this device with `deliveredAt`, `readAt`, `tappedAt` | `alerts_history` | `axf alerts history` | none |

Deep link: `console_open("alerts", focus="<alert id>")`; an alert's `link` (checked by `OpenUrlRules.linkOr`) is what a tap opens.

Built in s9: `server/alerts.py` keeps the per-device history (alert-history@1 in `alerts-history.jsonl`, the file the s2
migration started): `GET /api/alerts?device=<name>` records what that device was shown (`deliveredAt`), `POST
/api/alerts/ack {ids|all, device?}` sets `readAt`, the new `POST /api/alerts/tapped {id, device}` sets `tappedAt`;
`GET /api/alerts/history` (C35b) and `GET /api/alerts?since=<version>` (C33, `unchanged` when nothing moved). The MCP
and CLI forms are the Alerts bell plugin's commands over the same hub (`alerts-bell_feed`, `_history`, `_raise`, <!-- axf-plugin:alerts-bell -->
`_read`, `_dismiss`, `_resolve`; `axf alerts-bell …`) instead of the `alerts_*` names above. The Notification history <!-- axf-plugin:alerts-bell -->
screen is view `alerts-history`, deep link `alerts-history.focus:<alert id>` or `device:<name>`. <!-- axf-plugin:alerts-bell -->

Built in s15 (every notification is raised and pushed by the console; none needs the AmberX web app):

- **Approvals and veto calls.** The approvals banner's watch reads axHub's feed every 30 s with the console's owner sign-in
  (`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`) and keeps one alert per waiting call: source `approvals`, key
  `approvals:<id>` (type `approvals.waiting`, warning) or `approvals:veto:<id>` (type `approvals.veto-call`, critical). A
  decided or expired call resolves its alert; a failed read changes nothing. It only reads. State `GET
  /api/plugins/approvals-banner/watch`, read now `POST .../watch/poll` (MCP `approvals-banner_watch`, <!-- axf-plugin:approvals-banner -->
  `approvals-banner_watch-poll`; CLI through plugin commands). Both types start with the AmberX channel off, because the
  phone's own watch still rings for approvals straight from axHub; s12 turns it on when that watch goes. <!-- axf-plugin:approvals-banner -->
- **FYIs.** `POST /api/plugins/notify-control/fyi {title, body?, link?, key?}` (MCP `notify-control_fyi`) raises source <!-- axf-plugin:notify-control -->
  `fyi` (type `fyi.note`); the same `key` updates one FYI and buzzes again. <!-- axf-plugin:notify-control -->
- **Push at any severity.** A type the notify gate marks must-buzz (`push: true`, or AmberX picked in the Notifications
  panel) now reaches the console's own ntfy and web push whatever its severity, as it already reached AmberX; before, a
  warning such as "Back in Pending" or "Approval waiting" only reached the phone through the AmberX app. A channel switched
  off for the source in Settings → Alerts stays off; a repeat never pushes twice.
- Builds, CI, deploys, merge failures (`merge.blocked`, `merge.kicked`), systems check and UI Review already raise console
  alerts; nothing changed there.

### 4.9 Device stream (replaces AXPP for AmberX, s12)

One long-lived channel per phone so the console can push without going through axHub:

| Call | Replaces | REST (`/api/plugins/amberx-devices/...`) | MCP | CLI |
|---|---|---|---|---|
| C36 hello / stream / answer | T16 AXPP | `POST hello {device, app, version, capabilities: ["recorder@1", "open-url@1", "listeners@1", "notify@1"]}` → `{deviceId, streamUrl}`; `GET stream` (SSE: `event: command {id, tool, args}` for `recorder.start|stop|status`, `browser.open`, `listener.set|restart`, `alert`); `POST answer {id, ok, result}`; `POST bye` | `amberx_devices` (read), `amberx_device_command` (write; recorder start stays an axHub approval) | `axf amberx-devices list`, `axf amberx-devices send <device> browser.open --url …` |
| C37 state | T18 devices | `POST state {listeners: listener-state@1, mic: {off, holder}, recorder: {...}, monitor: {...}}` every change and at least every 5 minutes; `GET devices` → each device's last state | `amberx-listeners_devices` (already exists) | `axf amberx-listeners devices` |

The stream is signed by the phone's hub session like every other call. Commands carry an `id`; the phone answers each once, and
the console drops unanswered ones after 2 minutes (the console-commands TTL).

### 4.10 Settings

AmberX settings keep their hub-settings@1 document `shared/settings/apps/amberx-droid.json` (mirrored by lib-hubsync to every
device) and the appearance document; the console reads and writes them on `/projects/_shared/_data/settings/...` as the
`amberx-listeners` plugin already does for listener policies. The phone reads the document through the console instead of the
hub's data server. Every AmberX setting becomes a control@1 path, which gives REST, MCP, CLI and voice for free (CONTROL.md
projections).

| Call | Replaces | REST (control@1) | MCP | CLI | Voice |
|---|---|---|---|---|---|
| C32 settings | T13 | new target `amberx.settings` (domain `amberx`, ops `list`, `get`, `set`, `reset`): `GET /api/control/amberx.settings` lists every key with kind, default, range and label; `GET|PUT /api/control/amberx.settings/{key}`; `POST .../reset` | `control_list|get|set|reset(target="amberx.settings")` | `axf amberx get voice.lang`, `axf amberx set monitor.interval 30` | "set the watch interval to a minute", "turn hands-free off" |
| C32a document | T13 | `GET /api/control/amberx.settings/document` → the whole hub-settings@1 document with its `ETag`; `PUT` with `If-Match` for the phone's lib-hubsync mirror | none | `axf amberx settings export` | none |
| C32b appearance | T13 | unchanged: the look is `tokens.*` (CONTROL.md) and the appearance document; the phone reads it through `GET /api/control/tokens.slots` and the console's appearance source | `control_*` | `axf token …` | "switch to the dark theme" |

Keys (append-only; the full list comes with s10 from the plugins' settings groups): `voice.lang`, `voice.handsFree`, `voice.wake`,
`voice.swears`, `monitor.hub`, `monitor.interval`, `monitor.listen`, `monitor.autoApprove`, `monitor.autoApproveAll`,
`monitor.autoApproveTools`, `monitor.consoleAlerts`, `listeners.<id>.<policy field>` (listener@1), `veto.alarm.*`, `quiet`,
`mic.off`, `recorder.mic`, `recorder.transcribe`, `openUrl.browser`, `openUrl.notifyWhenBlocked`, `backend` (s13:
`console` | `amberx-web`), `ai.*` (the C18 config minus keys).

Deep link: `console_settings("plugins/amberx", anchor="setting:<key>")`.

Built in s10 as the console plugin `amberx-settings` instead of a new control@1 target: adding `amberx.settings` to <!-- axf-plugin:amberx-settings -->
control@1 changes the control-rules engine and its schema (Fable work with a Kotlin twin), so C32 is served by plugin <!-- axf-plugin:amberx-settings -->
commands on the same keys: `GET settings`, `GET|PUT settings/{key}`, `POST settings/{key}/reset`, `GET|PUT document` <!-- axf-plugin:amberx-settings -->
(C32a, ETag / If-Match) under `/api/plugins/amberx-settings/`; MCP `amberx-settings_list|get|set|reset|document`; CLI <!-- axf-plugin:amberx-settings -->
`axf amberx-settings set voice.lang en-GB`. The keys are in the plugin's `registry.json` (short name → document key). <!-- axf-plugin:amberx-settings -->
The watch's auto-approve keys change only from a signed-in admin browser (403 for the token). Settings tab `amberx` <!-- axf-plugin:amberx-settings -->
(Settings → Plugins → AmberX), one setting `amberx-settings.focus:<key>`. The control@1 target stays a follow-up. <!-- axf-plugin:amberx-settings -->

### 4.11 Stays on the phone (no route)

T19: speech recognition, text to speech, the quiet switch, mic off, secure screen, talk mode, hands-free, the veto alarm, the
monitor service itself and its notifications. They are reached through C32 (their settings), C37 (their state) and C36 (their
commands); the console never holds a microphone.

## 5. Mapping summary

| Today | After | Step |
|---|---|---|
| `https://amberx.amberxai.com` (site) | `https://console.amberxai.com` (the AmberX screens are console plugins: Notes, Tasks, Approvals, Recorder, Settings → Plugins → AmberX); the old host proxies and logs (s11) | s3–s10, s11 |
| `GET /api/health`, `/api/me` | `GET /api/health`, `/api/me` with `amberx.api` | s11 |
| `/api/ai/*` | `/api/plugins/amberx-ai/*` | s3 |
| `/api/ai/molly*`, `/api/walkthrough/*` | `/api/plugins/molly-guide/...` | s11 (routes exist) | <!-- axf-plugin:molly-guide -->
| `/api/approvals/relay`, `/decide` | `/api/plugins/approvals-banner/relay`, `/decide` | s6 | <!-- axf-plugin:approvals-banner -->
| `/api/console/plugins/{folder}/...` | `/api/plugins/{folder}/...` | s11 |
| hub `/data/amberx-axf/amberx-notes/...` | `/api/control/amberx.items`, `amberx.lists` (+ intent, flush, stream) | s3, s4, s5 |
| hub `/data/amberx-recordings/...` | `/api/plugins/output-recorder/recordings/...` | s7 | <!-- axf-plugin:output-recorder -->
| hub `/data/_shared/settings/apps/amberx-droid.json` | `/api/control/amberx.settings` | s10 |
| hub `/auth/admin/approvals.json` | `/api/plugins/approvals-banner/pending` (+ stream) | s6 | <!-- axf-plugin:approvals-banner -->
| hub `/auth/api/approvals/{id}/{action}` | unchanged, native, the person's session | — |
| hub `/axpp/v1/*` (`browser.open`, `recorder.*`) | `/api/plugins/amberx-devices/stream` (+ `console-commands/open-url`) | s8, s12 |
| console `/api/alerts` | unchanged, plus `since`, `stream`, `history` | s9, s15 |

Built in s11 (`apps/amberx-droid/server/forward.py`): every address the AmberX server answers is in one table with its
console address and how it is handled today: `proxy` (console plugins, `/api/console/plugins/…` → `/api/plugins/…`),
`relayed` (Molly, the walkthrough re-voice), `redirect` (pages, only with `AMBERX_FORWARD_PAGES=redirect`) or `local`
with the reason (the AI routes wait for the `amberx-ai` plugin; walkthrough media for a console media route; the
approvals relay and decide answer for the calling browser's own hub session). Every request is logged
(`$AMBERX_DATA_DIR/forward-log.jsonl`); `GET /api/forward/log` (admins) and `python forward.py summary` show per
route how often, when last, from which client (phone native, phone page, browser) and which routes are still answered
here; `python forward.py table` prints the table. Nothing changes for the current phone until the switches are set.

Built in s12 and s13 (`apps/amberx-droid`, the AmberX Capacitor shell, which the Android hold excepts): the installed
app becomes the Console app (name "Console", same package so it updates in place). `ConsoleBackend.java` holds the
rules: the site is `https://console.amberxai.com` unless the backend switch says `amberx-web`; `MainActivity` builds
Capacitor's config from it at start. The native side talks to the console: alerts read with the device's name (C33,
C35b), pages the console queued for the phone opened and answered every watch round (C31 pick-up), recordings uploaded
to the console's routes and deleted locally only on `confirmed` (C25, C26). Console calls go through
`HubRules.consoleSend` (console API only, console as Origin, no redirects). The switch is the console setting `backend`
(amberx-settings: REST `PUT /api/plugins/amberx-settings/settings/backend`, MCP `amberx-settings_set`, CLI `axf
amberx-settings set backend amberx-web`, voice "switch the phone back to amberx"); the watch reads it every round and the
app opens on it from the next start; `AmberxNative.backendGet|backendSet` read and set it on the phone. Still on the
old paths until a later step: the approvals feed (T9, native straight to the hub), the AXPP link (T16) and the voice
plugin, whose phrases the console page registers only when the AmberX page's voice registry is present.

## 6. What this contract does not decide

- The Android client code (s12, s13): this is the server side the client is written against. No Kotlin or Java changes are part of
  s1; the twin gap is recorded in `framework/spec/PORTING.md` when s12 starts.
- Storage layout for anything that already lives under `/projects` does not change. The s2 migration
  (`apps/console-web/migrations/amberx-import/`, amberx-import@1) moves `ai.json` profiles and keys and the walkthrough
  media, starts the C35b history store (`alerts-history.jsonl`, alert-history@1) from the alerts the phone polled, and
  checks and counts the hub data in place; it is idempotent and has a rollback. The request log does not exist until s11.
- The merge of the AmberX plugins' UI into the console (which nav items, which banner) is the s3–s10 UI work, reviewed in UI Review.
