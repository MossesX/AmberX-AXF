# s16 — Fold the axHub web UI into the console

Build `fable-full-audit-ui-overhaul-conso`, step s16 (Opus, Nov 20 2026). Brett, Nov 19: every axHub web feature
becomes a console plugin, grouped in modules, plugins stay uninstallable; the axHub server stays; archive, then retire
axhub-web.

## What landed (3 commits, each separately landable in this order)

1. **Hub-pages relay + kit** (`655146c30`)
   - `apps/console-web/server/hub_pages.py`: `GET|POST /api/hub-pages/<path>` → the wall's hub, only for
     `auth/api/…` and `apps.json`. Only a wall **admin browser**: the console token alone (every Claude session, MCP,
     the CLI) gets 403, so nothing an AI client holds can approve its own call here. The browser's own `axhub_session`
     goes first; when the hub doesn't take it (or the cookie never reaches the console) it falls back to the console's
     owner sign-in (`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`, optional `AXF_HUB_RELAY_OWNERS`), the same one
     the approvals banner's relay uses. Writes: same-origin JSON only, the CSRF value is read server-side from the same
     session and never returned to the page, redirects refused, replies capped at 2 MB, every write logged to
     `.axf-console/hub-pages.jsonl` (who, path, status, via; never the cookie). `GET /api/hub-pages-state` says
     whether this browser can use the pages and why not.
   - `apps/console-web/src/hubPages/`: the client (`api.ts`, same exports the pages used), the sign-in gate and JSON
     loader (`page.tsx`; a poll never stacks on a read still in flight), page routes (`route.ts`: page `x` = console
     view `axhub-x`; a page whose plugin isn't installed says so in a toast), the catalog hook through the relay
     (`hub.ts`), the pure rules (`core.ts`, `types.ts`, moved as they were).
   - The shell keeps a page's parameters in step with the open view and opens an old axHub web address
     (`#/approvals/<id>`, `#/handoff/<run>` …) on the same console page once plugins load (`App.tsx`).
   - `console.open` (`axhub`, `axhub-approvals`, `axhub-apps`, `axhub-users`, `axhub-account`) opens the page in the
     console when its plugin is installed, else the hub in a new tab as before (`menuLibrary.tsx`).
2. **Module axHub: six plugins** (`60f543a81`) — nav section **axHub** + app menu **Apps → axHub**, each plugin with
   plugin.json, install.mjs, uninstall.mjs, help.json (entries moved from the app's help), the generic Settings →
   Plugins sub-tab, a README line with its removal marker. `plugin-lifecycle check`: clean for all six.

   | Plugin | Pages (console views) |
   | --- | --- |
   | `axhub-approvals` | Approvals (`axhub-approvals`), Request (`axhub-approval`), Approvals log (`axhub-approvals-log`); held calls with countdown / Deny / Approve now / Shelve; auto-approve window; `hub.review:<id>` opens a request here |
   | `axhub-passes` | Go pass (`axhub-go-pass`), Passes (`axhub-passes`) |
   | `axhub-apps` | Apps catalog (`axhub-apps`) |
   | `axhub-users` | Users (`axhub-users`) |
   | `axhub-handoff` | Handoff runs (`axhub-handoff`), one run with live progress (`axhub-handoff-run`) |
   | `axhub-account` | axHub session (`axhub-hub`), Hub account (`axhub-account`) |

   UI clean-up on the way in: the status and source filter rows are framework `TabGroup`s (were hand-made chip
   buttons), Shelve is a framework `IconButton` (was a raw `fx-iconbtn` button), the CSS lost its `2rem` / `2.75rem`
   literals (token maths only), downloads and the hub's sign-in open in a new tab instead of navigating the console
   away. Checks: check-theme, check-controls, check-toolbars, check-chrome-assets all pass.
3. **Archive and retire apps/axhub-web** (`9e617d788`)
   - Archived: `apps/axhub-web/ARCHIVED.md` (the page → plugin map, the last live commit and the restore command),
     README banner, `project.manifest.json` status `archived`.
   - Retired: CI no longer builds or tests it (android.yml build step, its two test lines, the `axhubweb` CI scope);
     the plugin catalog's `axhub` kind no longer installs into an app (`into` dropped; packages are still listed and
     served) and the console's `/api/app-plugins/axhub` answers 404 like the retired amberx kind; plugin-commands
     reads the console's plugins only.
   - VPS: new host check **axHub web app retired (VPS clean-up)** (`host-axhub-web-retired`, console-doctor.sh) is
     amber while the `axhub-web` container, its update script or cron are still on the VPS; `--fix` removes them
     after asking. This is the systems check banner item for Brett (steps below).

## Not carried over, with the reason

- The "Coming" pages (Services, Jobs, Audit, Vault, Projects, Devices): placeholder notes with no feature behind them
  (they waited on a hub admin API that doesn't exist yet).
- The app's demo dialogs (New file, Delete item, Developer console): template demo code.
- `apps/axhub-web/scripts/refresh-check.mts`: a Node render test of that app's own shell; the console's browser
  tests (s7) cover the screens. The rule test moved (`src/hubPages/test.mjs`, 234 checks, now in CI).
- Non-admin hub users: the console's wall only lets admins reach these routes, so the pages are admin-only in the
  console (the old app also showed Account to plain users). Opening them to users is a `wallUsers` decision for Brett.

## Deferred

- **Deleting `apps/axhub-web` from the repo.** About 60 framework files still list it: the app lists in
  `framework/schemas/shared-assets.json`, `deploy-log.json`, `feature-ledger.json`, `token-registry.json`, spec
  fixtures (`appearance.json`, `shipped-manifest.json` …), spec checks (check-help, check-hub-look,
  check-design-package, check-plugin-catalog, check-page-toolbars …), the Kotlin `AppearanceConformanceTest`, and
  CLI tables (watch-live, help-coverage, skins/animations aliases). Those are contract and fixture changes (Fable per
  the model rules), so the folder stays frozen and archived until a step of its own removes it with them.
- **axHub server:** its old page redirects (decision #96) still point at the hub's `/#/<route>`. Once the container
  is gone they should point at the console (`https://<console>/#/approvals/<id>` …), which the console already
  opens on the same page. That change is in the axHub repo, not here.

## Brett's steps (also in the systems check: axHub web app retired)

1. Open the console → axHub → Approvals, Passes, Apps, Users, Handoff, axHub once and check they show your data.
   If a page says there is no hub session, set `AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD` (Systems check →
   Approvals relay says how).
2. On the VPS: `bash /opt/axf/deploy/console-doctor.sh --fix host-axhub-web-retired` (asks, then removes the
   `axhub-web` container, `/usr/local/bin/axhub-web-update` and `/etc/cron.d/axhub-web`).
3. On axHub: point the old page redirects at the console.
Rollback: `bash /opt/axf/apps/axhub-web/deploy/install.sh` brings the old app back.

## Tests run

- `python3 apps/console-web/server/test_hub_pages.py` — 22 passed (new, in CI)
- `npx tsx apps/console-web/src/hubPages/test.mjs` — 234 passed (moved, in CI)
- `python3 apps/console-web/server/test_plugin_catalog.py` — 34 passed
- `node apps/console-web/plugins/plugin-commands/test.mjs` — 40 passed; `server/test_plugin_commands.py` — 51 passed
- `python3 apps/console-web/plugins/systems-check/test.py` — 231 passed
- `node framework/spec/check-ci-scope.mjs` — 10 passed
- `tsc --noEmit` + `vite build` of the console — clean
- `test_wall_users.py` fails at "the page itself" in this worktree only because `dist/` isn't served there (it needs a
  built console, as in CI); unrelated to this step.

## Later in the step

- **App menu:** the module's pages sit in the console's own **Apps → axHub** submenu (each plugin's entries,
  `nav:<view>`, gone with its plugin); the four old `console.open` links there were replaced, "Open axHub in a new
  tab" stays. `scripts/menu-reach.mts`: ok (425 checks). Not mine, noticed: `output-recorder` contributes to a
  top-level menu id `axhub` with no label, which shows as a stray **Axhub** menu holding only "Audio out".
- **Grid fix (inherited bug):** every DataGrid row is its own CSS grid at least as wide as its content, so the
  content-sized columns and long Who / What text made rows drift and pushed Deny / Approve now past the card. Fixed
  in the plugin: text-sized fixed widths, Who / What size-contained.
- **UI Review:** five screens (Approvals, Passes, Users, Apps, axHub), desktop + phone, group
  "fable-full-audit-ui-overhaul-conso - Nov 20 11:15 AM" (r-20261120-a7ca99f8, -dd1ece85, -3b2eac2b, -2291077f,
  -2c6163c9) — waiting for Brett there. Shots from `scripts/axhub-pages-shots.mjs` against a fake hub.
- Shots script first hit another worktree's preview server on a shared port (7099) and showed its console; it now
  uses its own port and fails when the port is taken.
