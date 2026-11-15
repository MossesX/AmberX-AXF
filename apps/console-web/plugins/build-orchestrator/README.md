# Build orchestrator

The console's one place for builds: Pending → Queue → Active → Complete, the Claude accounts they run on, approvals,
the token rules every session follows, the server gate around launches, and the auto-lander that lands what they ship.
Settings → Plugins → Build orchestrator. Code only in this folder; data in its lifecycle `dataDir`.

## Auto-lander (Nov 15 2026)

Brett: "we need a control for the auto lander, put it in the plugin we built today where we put the rules for the gate".

The lander itself belongs to the push banner (cron `/etc/cron.d/axf-auto-land` → `land/land.mjs run`, every 3 minutes).
This plugin shows and drives it through the capability **`auto-lander@1`** only (`server/lander.py`), never by folder.

- **Tab**: Build orchestrator → **Auto-lander** (next to Rules), and Settings → Plugins → Build orchestrator → Auto-lander.
  - **Auto-lander** switch: the one On/Off the cron reads at the start of every run. Off = the run ends at once
    (reason `switched-off`); the merge queue stops too.
  - **Landing mode**: *Serial* (default) lands one PR at a time, tested on the real main it will sit on; a red PR only
    kicks itself. *Merge queue* uses the configured queue (batch or stack).
  - **Status**: last run (when, result), the PR landing now, and why nothing is landing: `switched-off`, `queue-empty`,
    `ci-waiting`, `conflict`, `token-missing`, `locked`, `error`.
  - **Landing line**: every PR in order, one at a time (position, PR, build, CI, state) with **Move up**, **Skip**
    (asks first; remembered until **Put back**) and **Land now** (asks first; to the head and a run starts; Brett's own
    click).
  - **Recent runs**: one row per cron run.
- **REST** (`/api/plugins/build-orchestrator/…`): `GET auto-lander/status | line | runs?limit= | cron`,
  `POST auto-lander/enabled {enabled}`, `POST auto-lander/mode {mode}`, `POST auto-lander/line/move {pr, direction}`,
  `POST auto-lander/line/skip {pr, why, confirm}`, `POST auto-lander/line/unskip {pr}`,
  `POST auto-lander/line/land-now {pr, confirm}`.
- **MCP** (plugin-commands@1): `lander-status`, `lander-line`, `lander-runs`, `lander-cron`, `lander-enabled`,
  `lander-mode`, `lander-move`, `lander-skip`, `lander-unskip`, `lander-land-now`.
- **CLI**: `axf lander status | line | runs | on | off | mode <serial|queue> | move <pr> up|down | skip <pr> --why "…" --confirm | land-now <pr> --confirm`
  (also `axf build-orchestrator lander-…` through the plugin commands).
- **Voice**: "turn on / turn off the auto lander", "what's landing", "why isn't it landing", "land 633 now",
  "set auto lander mode to serial".
- **Deep links** (console_show / console_open): action `build-orchestrator.auto-lander[:on|off|mode:<m>|land-now:<pr>|skip:<pr>|move-up:<pr>]`,
  `build-orchestrator.tab:auto-lander`, `setting:autoLander.enabled`, `setting:autoLander.mode`,
  `row:<pr>/action:move-up | skip | land-now`.
- **Systems check**: *Auto-lander cron* watches the real run log (last run age and result). Its Auto fix asks the host
  doctor to reinstall the cron line.

Tests: `python apps/console-web/plugins/build-orchestrator/server/test_lander.py` (routes, run from `test.py`).
