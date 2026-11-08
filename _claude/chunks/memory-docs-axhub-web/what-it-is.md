<!-- memory-chunk@1 source=_claude/memory/docs/axhub-web.md lines=6-28 tokens=380 -->
## What it is

axHub's own web front end, built on AmberX AXF like the Dev Console: a **developer app**
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
