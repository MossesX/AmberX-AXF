# HUB-CONSOLE — hub-console@1, every axHub web page as a console screen

Status: draft (step 1 of build `move-everything-axhub-web-console`, Nov 17 2026, Fable). The contract itself (addresses,
state shapes, action lists, personOnly flags) is step 2; the validator and route table (`framework/core/hub-console.mjs`)
step 3. This file starts as the inventory and parity map and becomes the contract as the steps land.

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

The migration script (`framework/cli/hub-settings-migrate.mjs`, step 4) reads a user's axHub web settings export (the
hub's `settings/<app>.json` for `axhub-web`) and writes the console keys above, `--dry-run` by default.

## Console screens (addresses, step 2 fixes the shapes)

One view group **Hub** on the console nav, one TabGroup row `hub.tabs`:

| Console address | Screen | Replaces |
| --- | --- | --- |
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

Every screen gets the four reaches (REST `/api/plugins/hub-admin/<screen>`, MCP `hub_<screen>_*`, CLI `axf hub <screen>`,
voice `hub.<screen>`), listed per screen in the contract (step 2) and checked by the parity script (step 27).

## Deferred

Android twin of the route table and validator: deferred, recorded in `PORTING.md` at step 3. The AXHub Android app keeps
its own screens until Phone Connect replaces it (builds `phone-connect`, `remove-amberx-app-code-once-phone`).
