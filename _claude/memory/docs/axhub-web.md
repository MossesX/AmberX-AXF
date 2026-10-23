# AXHub web app (`apps/axhub-web`)

Built Oct 21 2026 on **Opus**, at Brett's request ("the axhub web app… build now with opus but fable later").
The Fable follow-up is parked as pending item **`axhub-web-hub-rules`** (harvest the hub rules into lib-hub).

## What it is

axHub's own web front end, built on AmberX AXF like the Dev Console and Build Pilot: a **developer app**
(`developer: { hub }`), so its look and spacing come from the hub's shared appearance document and it waits for the
hub rather than running without it. It is a guest, not a replacement: the hub keeps serving its own pages, and every
decision still happens there.

- **Approvals** (home): what axHub is waiting on, polled every 5 s while the page is visible, with time left per
  request and **Review on the hub** — the hub's own approval page, under its Origin + CSRF rules.
- **Hub**: the address, whether this browser is signed in (admin / user / signed out / unreachable), the number
  waiting, last check, and one-tap links to the hub's approvals, apps, users and account pages. Says where the look
  comes from.
- **Apps**: the hub's app catalog with a Download button per app and its earlier builds (version, build, size, date,
  short hash).
- **Manage** (Services, Jobs, Audit log, Vault, Users, Projects, Devices): real routes with a plain note each, saying
  what the screen will do and what it waits on (the hub's admin API, step 4; Devices waits on AXPP, step 6). Users
  links to the hub's page, which does the job today.
- **Assets**, **Account**, **Settings**: the framework's own (hot-swap studio, account view, lib-settings with
  Appearance → Look from axHub).

Nav asset `nav-menu/axhub-web` and menu asset `app-menu/axhub-web` mirror the Android AXHub app's shape, so the two
apps feel the same.

## Security

The app holds **no hub token**. Both feeds are read with the browser's own hub session
(`credentials: 'include'`), the way the console's approvals banner does (hub decision #85):

- Redirects are refused (`redirect: 'error'`), so a session never follows the hub elsewhere; replies are read through
  a byte cap (256 KB approvals, 512 KB catalog).
- A download link is **rebuilt** from the hub address, the project and the file name and then checked with
  `isHub(...)`; a link in a reply is never used. File names must match the hub's own `app-catalog@1` shape, so
  `../../etc/passwd` or `evil.sh` never becomes a button.
- Nothing in the app can approve, reject or change anything on the hub.
- Hub pages are opened with `noopener,noreferrer`.
- Inside a host app (Patches) the framework's embed@1 layer hides the chrome the host shows; nothing else changes.

## The hub side (axHub decision #90)

`/apps.json` had no CORS, so a browser on another origin could not read the catalog. The hub now answers it like the
approvals feed: cross-site reads from **https origins under its cookie domain** (or any origin named in
`AXHUB_APPS_ORIGINS`), with credentials, and **JSON** for signed-out (401) and not-allowed (403) instead of an HTML
redirect, so an app can say "sign in" rather than showing a dead list. `crossSiteOk()` is now shared by both feeds.

**Operational note:** the web app's origin must sit under the hub's cookie domain (`AXHUB_COOKIE_DOMAIN=amberxai.com`
→ `axhub-web.amberxai.com` passes). A host outside it needs naming in `AXHUB_APPS_ORIGINS`. Downloads are plain
navigations to the hub and work either way.

## Tests

- `npx -y tsx apps/axhub-web/test.mjs` — 52 checks over the pure rules: what each status means, malformed projects,
  files, sizes and hashes dropped, links rebuilt, caps (100 apps, 5 builds), duplicates, sorting, sizes, relative
  times, approval expiry wording.
- `apps/axhub-web`: `tsc --noEmit` + `vite build` (CI re-bakes the framework into it first, as it does for the
  console).
- axHub: `packages/server/test/apps.test.ts` grew 5 cases (JSON 401, a named site reading it with credentials, another
  site refused, the permission still required, and the cookie-domain rules of `crossSiteOk`). 330 tests pass.

## What it doesn't do yet

- The Manage areas are notes, not screens: they wait on the hub's admin API (step 4) reaching the browser with
  per-area permissions. Nothing here guesses at an API that isn't there.
- The app catalog rules live in the app, not in lib-hub — that harvest is the parked Fable item.
- **Deployed on the hub's own host (Oct 23 2026, Opus):** `https://axhub.amberxai.com/` is this app. Its container
  (`axhub-web`, nginx, no token) takes only `/`, `/index.html` and `/assets/…` on that host through Traefik routers at
  priority 1000 (`AXF_ROUTER_PATHS` / `AXF_ROUTER_PRIORITY` in `framework/deploy/axf-deploy.sh`); every other path
  (`/mcp`, `/healthz`, `/auth/*`, `/data*`, `/data-events`, `/apps*`, `/handoff*`) still reaches the hub's own container,
  untouched (axHub keeps no AXF code). Behind the wall with `user_paths=/`: signed-in hub users get the page, as the hub's
  `/` (a redirect to `/auth/account`) did. Banner, toolbar and nav are shown (`hidden: []`). The app ships only its own nav/app menus and the layouts that show them (`classic-ide`, `studio-dock`): the shared hub look names `focus-top` (no toolbar) and `icon-rail`/`developer` (another app's items), and an id the app doesn't ship keeps the app's default (appearance@1).
  Install / update: `sudo bash apps/axhub-web/deploy/install.sh`; **rollback:** `sudo bash
  /opt/axhub-web/apps/axhub-web/deploy/install.sh --remove` (container, update script and cron gone; Traefik drops the
  routes and the hub answers `/` again). The Mosses agent tab was asked for and then scratched by Brett (Oct 23 2026).

## Related, deliberately not touched

- **`patches-web-settings-notify`** (in flight on `feat/patches-web`, another session): the Patches **web** app must
  follow the hub appearance the same way this app does. Noted on that pending item instead of edited here.
- **`axhub-theme-freeze`** (Fable): appearance@1 carrying theme bodies. This app reads whatever the document names
  today and will follow bodies when that lands, with no change here.
