# HUB-CONSOLE — hub-console@1, every axHub web page as a console screen

Status: contract (build `move-everything-axhub-web-console`, Nov 17 2026, Fable). Route table (data, the single source):
`framework/schemas/hub-console.json`; JSON Schema `framework/schemas/json/hub-console.schema.json`; fixture
`framework/spec/fixtures/hub-console.json`; validator and derivations `framework/core/hub-console.mjs` (step 3) with
`framework/spec/check-hub-console.mjs`. Kotlin twin deferred (PORTING.md). The inventory that produced the table is kept
below.

## The contract

**One table, five projections.** `hub-console.json` lists every hub screen once; the hub-admin plugin draws its nav and
TabGroup row from it, the console server mounts its reads and actions from it, the MCP tools, the CLI and voice name
things from it, and the parity check walks it. Nothing about a hub screen is decided in a component.

| Field | Meaning |
| --- | --- |
| `view`, `tabRow` | the console view (`view:hub`) and its TabGroup settings id (`tab:hub.tabs=<screen>`) |
| `plugin`, `settingsSubtab` | the console plugin (`hub-admin`) and its Settings → Plugins sub-tab (`subtab:settings.subtabs=hub`) |
| `screens[]` | one per hub screen: `id` (tab value, REST segment, CLI word, voice word), `title`, `icon`, `order`, `gate` (`none` / `user` / `admin`: who the hub lets read it), `replaces[]` (the axHub web hash routes it retires), `state`, `rows?`, `actions[]`, `settings[]`, `health?` |
| `state` / `rows.read` | a read: `channel`, the hub call as text, its MCP `tool`, the named `shape` it answers, its `fields`, `params`, `poll` |
| `rows` | the grid (`grid:hub.<screen>`), the id field and the path to the rows in the state, an `idPattern` that gates `row:<id>` addresses, an optional per-row read |
| `actions[]` | `id`, `label`, `who`, `effect` (`read` / `write` / `destructive` / `navigate`), `row` (acts on one row), the hub call or `null` with a `missing` block (`why`, `proposed` route for the axHub repo, the hub's `cli` line today) or `channel: console` (the plugin does it alone) or `opens` (a navigate) |
| `settings[]` | registered settings under `axf.hub.*` with kind, default, range; `who` when a set writes to the hub; `personOnly` + `ownedBy` for owner-only values shown read-only |
| `deferred[]` | hub areas with no screen on either side and why (parity treats them as intentional) |

**Who may run an action** (`who`, enforced three times: the table, console-control, the relay):

- `person`: Brett's own tap in his signed-in console browser (wall admin, same origin, user activation). Registered
  `personOnly`, so console-control's catalog never lists it and `console_control_*`, `axf console …` and voice refuse it
  with `denied` / `requires: person`. **Never** an MCP tool, a CLI line or a voice action (`tool` is forbidden on it).
  Approve, Deny, Shelve, Postpone, Ignore, Revoke, Reopen, auto-approve on, Grant pass, Go pass, set a password,
  sign out, create a token.
- `confirm`: a command may run it, but the first call answers `confirmation_required` and the second carries the
  confirm token (console-control@1); every call is audited with `by` and `reason`. Revoke pass, user role / permissions /
  disable / sign-out / delete, invite, policy set, connector add / reconnect / remove, handoff clear, token revoke,
  OAuth client add / remove.
- `command`: a plain command on every transport. Extend a pass, request a pass (asks Brett; the grant stays his click),
  end the go pass, stop auto-approve, save a profile, enable a user, mark a handoff sent, check, download.

**Channels.** Reads go through the hub-admin server: `bearer` reads (the feed, `GET /auth/api/policy`, MCP
`list_services` / `describe_service`) use the console's hub token; `session` reads (`/auth/api/*`) use the console's
own hub session — the tapping browser's `axhub_session` cookie forwarded by the approvals-banner relay when there is
one, else the server's owner sign-in (`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`, env only). Writes always use the
session channel and, for `person`, only the browser's or owner's session on Brett's tap. **The console token never
decides and never writes to the hub.** `console` channel actions touch only the plugin's own data.

**Reaches** (derived, `reachesOf`): for screen `s`, row `r`, action `a`:

| Reach | Read | Row read | Action |
| --- | --- | --- | --- |
| deep link | `view:hub/tab:hub.tabs=s` | `…/grid:hub.s/row:r` | `…[/grid:hub.s/row:r]/button:a` |
| REST | `GET /api/plugins/hub-admin/s` | `GET …/s/r` | `POST …/s[/r]/a` (`DELETE …/s/r` when the action carries `method: DELETE`: it removes the row itself) | <!-- axf-plugin:hub-admin -->
| MCP | `state.tool` | `rows.read.tool` | `action.tool` (fixed in the table or `hub_<s>_<a>`), none for `person` |
| CLI | `axf hub s` | `axf hub s r` | `axf hub s a [r] [--confirm]`, none for `person` |
| voice | `hub.s` | `hub.s` | `hub.s.<camelCase a>`, none for `person` |

A REST action route exists for every action, `person` ones included: that is the route the browser's own tap uses, and
it refuses anything but a wall admin's same-origin browser request (the relay's rules), so the route's existence is not a
way in. Settings live at `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=hub/setting:<key>` and are
control@1 `console.pluginsettings` entries; `who: confirm` settings (the veto countdown) write through the hub's policy
route with a confirm.

**Hub routes the hub lacks** are in the table as `missing` blocks (9 today: connector add / reconnect / remove, handoff
accept / clear, token create / revoke, OAuth client add / remove). The console shows them as a plain "this hub hasn't got
it yet" note with the proposed route and the hub's CLI line; the API answers `{ ok: false, code: "hub_missing",
proposed }`. Step 28 opens the matching axHub-repo item from `hubMissing(table)`.

**Hash routes** (`routeToScreen`): the retired axHub web addresses (`#/approvals?status=…`, `#/approvals/<id>`,
`#/approvals/log?pass=…`, `#/handoff/<id>?file=…`, …) map to a screen plus params (`row` only when it matches the
screen's `idPattern`; unknown params dropped); deferred areas answer `{ screen: null, deferred }`; anything else `null`.
The deploy redirect (step 28) sends `https://axhub.amberxai.com/#/<route>` to the console's deep link.

## Inventory (the record behind the table)

Brett (Nov 17 2026): "I really need to get this axHub and AmberX over the console. I really need that done. With the phone
app." The Dev Console becomes the only hub UI. axHub stays the backend and MCP hub; its web pages (`apps/axhub-web`, served
on the hub's own address since axHub decision #96) are retired once every page, option and action has a console screen
with the same API reach (deep link, REST, MCP, CLI, voice).

## How the console reaches the hub

Two channels, never mixed:

| Channel | Who holds it | What it may do |
| --- | --- | --- |
| **Reads with the hub bearer** (the console server's `AXF_TOKEN` / hub MCP token) | the console server | `GET /auth/api/*` state the hub lets a bearer read (`policy`, the approvals feed `/auth/admin/approvals.json`, `list_services` / `describe_service` through MCP). Never a decision. |
| **Brett's own hub session** (the browser's `axhub_session` cookie, or the console's owner sign-in `AXF_HUB_RELAY_USER`) | the approvals-banner relay (`plugins/approvals-banner/server`) | every write: approve / deny / shelve / postpone, passes, users, account, auth admin. Only a wall admin's browser, same origin, JSON; the console token is refused (`relay_state`). |

Rule (kept from axHub decisions #96, #104, #105 and the relay): a decision is Brett's tap, never a session's. Decide
actions are registered `personOnly` in console-control@1, so `console_control_*`, the CLI and voice can **open** the
screen and **read** its state but cannot press Approve, Deny, Shelve, Grant pass, Delete user or Create token.

The server side (step 6) is one FastAPI router, `hub-admin`, that proxies the hub-console@1 reads with retries and
answers a clear `unavailable` state (`{ ok: false, code: "hub_unavailable" | "old_hub" | "signed_out" }`) instead of a
stack trace; writes go through the relay with the same wall checks as `POST decide` today, generalised to a route table.

## Inventory: axHub web today

Source: `apps/axhub-web/src/App.tsx` (views), `src/hub/api.ts` (`/auth/api/*`), `src/views/*.tsx`. Every page sits
behind `HubGate` (signed-in hub session; `admin` where marked). Routes are `#/<route>` on the hub's address; the hub
redirects its old HTML pages there.

| axHub web page | Route | Gate | Hub endpoint(s) | Reads | Actions (P = person-only) | Options shown |
| --- | --- | --- | --- | --- | --- | --- |
| Approvals (home) | `#/approvals[?status=]` | admin | `GET /auth/api/approvals?status=&page=`; `POST /auth/api/approvals/<id>` `{action, rev}`; `POST …/<id>/deny` `/approve-now` `/shelve` (held, veto@1); `POST /auth/api/approvals/auto {minutes}` `/auto/stop` | grid: filters, page, total, waiting, heldCount, postponed, items (title-first reason, code, source, countdown), auto window | approve P, decline P, approve-now P, deny P, shelve P, ignore P, revoke P, reopen P, postpone P, auto-approve window on/off P (tap twice) | status filter chips (all, pending, postponed, approved, declined, ignored, revoked, used, expired), source chips (dataset transform `axhub-web.source`), column hide/sort, open rows (lib-approvals `approvalsOpenStore` scope `axhub`), 3 s poll while a held call counts down |
| Request (one approval) | `#/approvals/<id>[?do=approve][&postpone=1]` | admin | `GET /auth/api/approvals/<id>`; `GET …/<id>/postpone` (options); `POST …/<id>` `{action: postpone, until|minutes|condition}` | item + auto state; postpone presets, conditions, deadline | same as the row plus postpone with reason/condition P | history collapsible, "What it does" open by default |
| Approvals log | `#/approvals/log[?pass=any|<id>]` | admin | `GET /auth/api/approvals/log?q=&status=&via=&tool=&sort=&page=&pass=`; `GET /auth/admin/approvals/log.json` (download) | entries (~60 fields + events), tools, statuses, counts, underPass, auto-approve windows | none (read-only); Download JSON | search, status, decided-via (pending/web/cli/auto/other), pass (any / one), tool, sort (newest/oldest/tool/status/wait), page |
| Passes | `#/passes` | admin | `GET /auth/api/passes`; `POST /auth/api/passes {service, scope[], tools[], minutes, reason}`; `POST …/<id>/revoke`; `POST …/<id>/extend {minutes}` | active (countdown, covers, grantedBy/Via, uses), recent (ended), minute limits + presets | grant P, revoke P (tap twice), extend P | grant form defaults (service `axf-console`, scope `tokens.theme`, reason) |
| Go pass | `#/go-pass` | admin | `GET /auth/api/go-pass`; `POST /auth/api/go-pass {hours, note}`; `POST /auth/api/go-pass/end` | live, hours presets, repos, branch, file, pass, writes | go for N h P, end P (tap twice) | note field |
| Veto countdown / No wait | (Dev Console: Claude settings → Approvals & veto; axHub: CLI only) | admin session for writes | `GET /auth/api/policy` (policy-table@1, bearer ok); `PUT /auth/api/policy {changes[], reason}` (session only, `AXHUB-POLICY-API.md`) | per-service / per-tool policy, vetoSeconds, veto defaults (min 10, max 1800) | policy set P, veto seconds P; No wait is owner-only (claude-settings) | shown read-only to sessions |
| Users | `#/users` | admin | `GET /auth/api/users`; `POST /auth/api/users {username,name,email,password,role}`; `POST /auth/api/users/<id>` `{action: profile|role|permissions|password|enable|disable|signout|delete}` | you, roles, passwordMin, tempPasswordMin, permission hints, users (role, disabled, mustChangePassword, weakPassword, permissions) | add P, profile P, role P (confirm), permissions P, temp password P, enable P, disable P (confirm), sign out everywhere P, delete P (confirm, `sure: true`) | per-user card collapsed by default |
| Your account | `#/account` | signed in | `GET /auth/api/account`; `POST /auth/api/account/profile {name,email}`; `POST …/password {current,password,confirm}`; `POST …/signout-others`; `POST /auth/api/logout` | user, passwordMin, browsers (label, lastSeenAt, current) | save profile P, change password P, sign out others P, sign out P | weak-password note |
| Apps | `#/apps` | signed in (`apps.download`) | `GET /apps` feed (lib-hub `useHubApps`), download links on the hub's own path | catalog: apps, latest + earlier builds, size, sha, builtAt | download (navigation, hub decides) | earlier builds fold |
| Handoff | `#/handoff` | admin | `GET /auth/api/handoff` | runs (id, at, project, repo, commit, published, failed, files) | none | — |
| Handoff run | `#/handoff/<id>[?file=]` | admin | `GET /auth/api/handoff/<id>`; `GET …/<id>/progress` (poll); `POST …/<id>/sent`; `GET …/<id>/file?path=`; raw download | run: prompt, instructions, files, log, steps (groups, gauges), published | pick a session type (copy/open), "I've sent it" P | kit files fold, installer log fold |
| Hub | `#/hub` | — | `GET /auth/api/session` (signedIn, admin, can{approvals, approvalLog, users, apps, handoff}, csrf) | session state, waiting count, last check, links | check, sign in, sign out P | where the look comes from |
| Planned areas | `#/services` `#/jobs` `#/audit` `#/vault` `#/projects` `#/devices` | — | none yet (hub admin API, "hub step 4"; devices wait on AXPP) | a note each | — | — |
| Assets | `#/assets` | — | — | AssetStudio (framework) | — | framework, not hub |
| Settings (lib-settings) | Settings dialog | — | Appearance (look from axHub, `APPEARANCE-SOURCE.md`), Account & security, Connections, Plugins (→ axHub sync: `axf.hubsync.connection`), About | — | — | per-app saved settings (see Settings to migrate) |

Counter and badge: `approvals.waiting` (toolbar + menu + banner counter widget) from the token feed
`/auth/admin/approvals.json` (lib-hub `HUB_PATHS.feed`), the same feed the console's approvals banner already polls.

### What the build's step list names that the hub does not expose yet

Honest gaps, so the parity check (step 27) can mark them `hubMissing` rather than silently pass:

| Step | Wanted | On the hub today | Plan |
| --- | --- | --- | --- |
| s17/s19 connectors | add / reconnect / remove a connector, token health per connector | `list_services` / `describe_service` (MCP, bearer), `GET/PUT /auth/api/policy` (policy per tool, enabled flag). No add/reconnect/remove route; services are configured in the hub's own CLI (`axhub services …`). | Console shows status, policies and health; add/reconnect/remove are registered actions that answer `hub_missing` with the exact hub CLI line and open a follow-up on the axHub repo (`/auth/api/services` + `/auth/api/services/<ns>/{reconnect,remove}`). |
| s18 services detail | one service's tools, schemas, recent calls | `describe_service` (tools + input schemas), policy table, approvals log filtered by `tool=` | Built from those three; "recent calls" = log entries whose `qualifiedTool` starts with `<ns>.`. |
| s20/s21 handoff | send, accept, clear between devices/sessions | runs + `/<id>/sent` only (Claude account handoff kits, decision "handoff-2") | Screen shows runs and the kit; send = the hub's session pick + `/sent`; accept/clear answer `hub_missing` until axHub grows device handoff. |
| s22/s23 auth admin | OAuth clients, API tokens (create once, revoke), sign-in methods | OAuth is on the hub (builds `axhub-oauth-thread`, `threads-oauth-soft`) but has no `/auth/api/*` admin routes in this repo's knowledge; users/passwords are the sign-in method | Screen reads what exists (users, sessions/browsers) and lists OAuth clients / tokens through proposed `GET /auth/api/auth/{clients,tokens}` with a clear "this hub hasn't got it yet" state (same pattern as `OLD_HUB`); create/revoke stay personOnly. Follow-up item on the axHub repo in step 28. |
| s15 account | linked phone, notification prefs | profile, password, browsers; the phone link is Phone Connect's (console), notification prefs are claude-settings' | Account screen embeds the Phone Connect pairing state and links to Claude settings → Notifications; nothing invented on the hub. |

### Settings to migrate (step 4)

Per-user UI state axHub web keeps today and the console key it lands on:

| axHub web | Where it lives | Console key (proposed) |
| --- | --- | --- |
| open approval rows | lib-approvals `approvalsOpenStore` scope `axhub` (settings) | the same store, scope `hub` |
| approvals grid hidden columns / sort | React state only (lost on reload) | `axf.hub.approvals.grid` `{hidden[], sort}` (DataGrid per-grid prefs) |
| source filter | dataset transform `axhub-web.source` (transient) | `axf.hub.approvals.source` |
| log filters | React state only | `axf.hub.log.filters` `{q,status,via,tool,sort}` |
| grant-pass form defaults | hard-coded (`axf-console`, `tokens.theme`, reason) | `axf.hub.passes.grant` `{service, scope, tools, reason}` |
| axHub sync connection | `axf.hubsync.connection` | unchanged (the console already has hub-sync) |
| chrome picks for axHub web (`axf.chrome.*`, nav/toolbar/banner assets) | app-look@1 `looks/axhub-web.json` on the hub | stay with the app-look document; the console's Hub screens draw under the console's look (skins rule) |
| approvals poll rate (10 s / 3 s with a held call) | constants | `axf.hub.poll` `{idleMs, heldMs}` |

**The migration** (hub-settings-migration@1, `framework/core/hub-settings-migration.mjs`, CLI
`framework/cli/hub-settings-migrate.mjs`): both apps keep their Settings values on the hub as hub-settings@1 documents
(`/projects/_shared/_data/settings/apps/axhub-web.json` → `axf-console.json`). The plan is a rule list over keys: named
rules move the hub page preferences onto the `axf.hub.*` settings the table registers (values coerced to the setting's
kind, options and range), the generic `axhub-web.<x>` → `axf.hub.<x>` rule marks a key `review`, app-level keys the
console already owns (`axf.display.*`, `axf.dev.*`, chrome, tokens, plugin settings) and device / session-only keys
(`axf.hubsync.connection`, `axf.approvals.open`) are `skip` with the reason, and a key the console already has a value for
is `keep` unless `--force`. `plan` (the default) is a dry run that writes nothing; `apply` writes the moved keys into the
console document (per-key merge, `updatedBy: hub-settings-migrate`) and a hub-settings-migration-report@1 next to the
plugin's data, after which a second `apply` is a no-op without `--again`. `--from` / `--to` run it against copies (step 24
does, before `install.mjs` wires it in). Look values never move: they ride the app-look document.

## Console screens (summary; the table is authoritative)

One view group **Hub** on the console nav, one TabGroup row `hub.tabs`:

| Console address | Screen | Replaces |
| --- | --- | --- |
| `view:hub/tab:hub.tabs=overview` | Hub (session, waiting count, relay state, sign in / out) | `#/hub` |
| `view:hub/tab:hub.tabs=approvals` | Approvals (live, countdown, decide) | `#/approvals`, `#/approvals/<id>` (row detail + `row:<id>`) |
| `view:hub/tab:hub.tabs=log` | Approval log (DataGrid, filters) | `#/approvals/log` |
| `view:hub/tab:hub.tabs=passes` | Passes and veto (passes, go pass, countdown, No wait read-only) | `#/passes`, `#/go-pass`, policy veto seconds |
| `view:hub/tab:hub.tabs=users` | Users | `#/users` |
| `view:hub/tab:hub.tabs=account` | Account (profile, browsers, linked phone, notification prefs) | `#/account` |
| `view:hub/tab:hub.tabs=connectors` | Apps / connectors (services, status, policies, health) | planned `#/services`, policy tab |
| `view:hub/tab:hub.tabs=connectors/row:<service>` | Service detail (tools, schemas, policy, recent calls) | — |
| `view:hub/tab:hub.tabs=handoff` | Handoff | `#/handoff`, `#/handoff/<id>` |
| `view:hub/tab:hub.tabs=auth` | Auth admin (OAuth clients, tokens, sign-in methods) | — |
| `view:hub/tab:hub.tabs=apps` | Apps (catalog downloads) | `#/apps` |
| `view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=hub` | Hub settings (every former axHub web setting) | lib-settings in axHub web |

Every screen gets the four reaches (REST `/api/plugins/hub-admin/<screen>`, MCP `hub_<screen>_*`, CLI `axf hub <screen>`, <!-- axf-plugin:hub-admin -->
voice `hub.<screen>`), listed per screen in the contract (step 2) and checked by the parity script (step 27).

## Deferred

Android twin of the route table and validator: deferred, recorded in `PORTING.md` at step 3. The AXHub Android app keeps
its own screens until Phone Connect replaces it (builds `phone-connect`, `remove-amberx-app-code-once-phone`).
