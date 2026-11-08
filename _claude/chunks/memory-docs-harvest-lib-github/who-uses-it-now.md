<!-- memory-chunk@1 source=_claude/memory/docs/harvest/lib-github.md tokens=149 -->
## Who uses it now

- Console core: `app_ci.py`, `app_catalog.py`, `main.py` (`/api/releases`, `/api/releases/download/…`), `alerts.py` (CI/deploy source).
- Plugins: activity (GitHub Actions source + run details), systems-check (GitHub key check), project-wizard (`wizard.mjs`), session-checkin (`install.mjs` push auth). All still pass `plugin-lifecycle.mjs check`.
- Framework CLI: `claude-project.mjs`, `plugin-lifecycle.mjs` (`publishToSource`, used by uninstall `--publish` and catalog installs).
- Image: `apps/console-web/server/Dockerfile` import check now includes `axf_server.github`.
