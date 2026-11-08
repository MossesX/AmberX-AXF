<!-- memory-chunk@1 source=_claude/memory/docs/axhub-web.md lines=64-85 tokens=553 -->
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

- **Console look + lib-hub harvest (Oct 23 2026, Opus, PR #30):** banner = the console's (search, day/night,
  clock) + an approvals counter; layout `axhub-console` (menu bar, toolbar and nav kept by Brett's pick, no inspector or
  status bar); toolbar `axhub-web` with live search; app menu shaped like the console's with live **Waiting for
  approval ▸** and **Download the latest ▸** lists. The catalog rules, hub hooks, approvals list and hub menu now live in
  lib-hub (`framework/libs/hub/apps.ts`, `react.tsx`, `menu.ts`; fixture `apps` section). Report + shots:
  `rebuilds/axhub-web-console-look.md`.
