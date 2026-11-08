<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md lines=157-174 tokens=569 -->
## How it's built

Plugin folder `apps/console-web/plugins/session-checkin/` (id `ai.amberx.axf.console.session-checkin`):

| File | Job |
| --- | --- |
| `lib.mjs` | Shared logic: config (`session-checkin-config@1`), install targets and hook entries, detection, memory listing, baseline estimates, archive read/write with secret scrubbing |
| `checkin.mjs` | The hook and CLI: `detect` (SessionStart), `log`, `end` (SessionEnd), `open <n>` (memory, read-only), `list`, `get`, `baseline`, `calibrate` |
| `install.mjs` | Installer: interactive in a terminal, `--json` for the console wizard (`status`, `preview`, `install`, `uninstall`) |
| `server/__init__.py` | Console routes `/api/plugins/session-checkin/{status,preview,install,uninstall,sessions,sessions/{id},baseline,pricing,detect}` (console token on every method) |
| `web/index.tsx` | **Sessions** view (nav → Plugins) and the Settings tab **Session check-in**: Status, Install or change (5-step wizard), Baseline build costs (prices form) |
| `baseline/` | `BASELINE-v1.md` (the fixed task), `calibration.json` (placeholder seed + measured runs), `pricing.json` |
| `test.mjs` | Self-test, run in CI |

Install targets: **this clone** (`.claude/settings.local.json`, git-ignored; on the VPS that's the console's clone `/opt/axf`), **every clone** (`.claude/settings.json`; from the console it is committed in a temporary worktree of origin and pushed with the console's `GITHUB_TOKEN`, Contents: write, through GIT_ASKPASS, so the VPS clone's 5-minute reset to origin keeps it), or **user** (`~/.claude/settings.json`, only from a terminal on that device). The installer only adds or removes its own hook entries (marked by `session-checkin/checkin.mjs` in the command) and keeps a `.bak` of the file. SessionStart runs on `startup` (optionally `resume`); stdout becomes the check-in instructions for Claude, ending with the record skeleton to fill in and pipe to `checkin.mjs log`.

Archive: `sessions/<YYYY>/<MM>/<id>.json`; written to the hub's `/projects/amberx-axf/_data/sessions/` where it's mounted, else the repo's `sessions/` (in the root manifest's `data.shared`, so `claude-sync` carries it to the hub). Unattended runs (`CLAUDE_CODE_SESSION_ATTENDED=0`, SDK entrypoints) are logged without questions.
