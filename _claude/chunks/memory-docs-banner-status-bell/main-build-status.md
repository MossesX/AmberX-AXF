<!-- memory-chunk@1 source=_claude/memory/docs/banner-status-bell.md tokens=457 -->
## main-build-status

- A framework **`status`** widget on the banner's right, just after the clock (order 25; the bell is at 30/31).
- Text + dot: green `main ✓ 2m ago`, red `main ✗ 5m ago`, accent `main ⟳ 3m` while queued/running (elapsed), grey
  `main ?` when unknown (no `GITHUB_TOKEN`, no runs, cancelled, GitHub error). Phones (≤ 480 px) show the dot only,
  because the right side is crowded.
- The plugin re-registers its own asset `status/main-build` on every answer (same origin, so never an asset
  conflict) and sets counters `build.main.known | running | failing` (other widgets can bind to them).
- Tap → dialog **Main build**: repo, branch, result chip, run title, workflow + run number, short commit, event, time,
  the previous result while one runs, failed jobs (each a link), **Open on GitHub**, Check now, Settings.
- Default watch: `MossesX/AmberX-AXF` · `main` · `android.yml` (= "Android framework + console"). The watch list is
  open (up to 10; the banner shows the first); workflow may be the file name, its numeric id, or the name GitHub
  shows (then runs on the branch are filtered by name).
- Server (the plugin's `/api/plugins/<folder>` prefix): `GET /status[?refresh=true]` (30 s cache), `GET/PUT /config`
  (`{watch}` or `{reset: true}`), console token on every method, 404 when the plugin is off, never on MCP. GitHub via
  lib-github (`axf_server.github`): token to the API origin only, no redirects, size caps, scrubbed errors; only
  `https://github.com/…` links reach the browser. Data: `config.json` in its lifecycle data folder (0600).
- Polls every 30 s while the tab is visible and on focus; stops when the console detaches it (plugin switched off).
- Settings → Plugins → Main build status: show/hide (this browser), Now (state + Check now), What it watches,
  Install & uninstall.
