# Main build status (console plugin)

`ai.amberx.axf.console.main-build-status` · built on Opus.

A dot on the **banner** (right side, next to the clock) with the last CI result of the watched branch, by default
MossesX/AmberX-AXF · `main` · `android.yml` ("Android framework + console"):

| state | dot | text |
| --- | --- | --- |
| passed | green | `main ✓ 2m ago` |
| failed | red | `main ✗ 5m ago` |
| running (queued, waiting) | accent | `main ⟳ 3m` (elapsed) |
| unknown (no token, no runs, cancelled, GitHub down) | grey | `main ?` |

It is the framework's **`status` widget** (no new asset type): the plugin registers its own asset `status/main-build`,
repainted on each answer, and attaches it with `rt.attachToBanner` (origin = the plugin id, so the console takes it off
when the plugin is switched off). Counters for other widgets: `build.main.known`, `build.main.running`,
`build.main.failing`. Tap → dialog `main-build-status.run` (run title, commit, time, the run before a running one,
failed jobs with links, Open on GitHub). Actions `main-build-status.open`, `.github`, `.check`.

Settings → Plugins → Main build status: show/hide on the banner (this browser), what it watches (an open list of
repo / branch / workflow; the banner shows the first; workflow = file name, id or the name GitHub shows), Check now,
install & uninstall.

Server (console token on every method, 404 when off, never on MCP): `GET /status[?refresh=true]` (cached 30 s),
`GET /config`, `PUT /config {watch: [...]}` or `{reset: true}`. GitHub through lib-github (`axf_server.github`): token
only to the API origin, no redirects, size caps; only `https://github.com/…` links go back to the browser. Data:
`.axf-console/plugins/main-build-status/config.json` (0600, no secrets). Polls every 30 s while the console is visible.

Self-test: `python3 apps/console-web/plugins/main-build-status/test.py` (fake GitHub API on loopback).
