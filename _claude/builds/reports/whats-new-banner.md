# What's new banner (whats-new-banner) — Nov 3 2026, Opus, VPS worktree

Urgent profile, 5 steps, branch `claude/whats-new-banner`. Requested by Brett, Nov 3 2026 (voice).

## What changed

- A **What's new** widget on the console banner: the unread count plus a ticker that steps through the newest feature titles merged to main ("57 new · Agent swarm Fable rebuild: …"), accent dot while anything is unread. Tap opens the panel.
- The **panel** lists every shipped feature grouped **By date** (Today / Yesterday / This week / Older), **By build** or **By app** (segmented switch, remembered per device), with search, per-item details (what it does, where to find it, merged / deployed times, build, branch, PR and build report links), mark read / unread / all read, and items merged since the last visit highlighted.
- **Settings → Plugins → What's new**: show on the banner, step through unread titles, how far back (1–365 days, default 30), which apps (framework / apps / console plugins, none = all), only deployed.
- The **whats-new@1 feed** is built from what actually shipped, no model tokens: merged PRs (GitHub with the console token, else the repo's own merge commits), the builds store (build and per-step `pr` / `branch`, `merged` / `mergedAt`), build reports' "What changed" bullets, Codebase changes entries' result summaries. Deployed = a successful `deploy.yml` run on main after the merge (GitHub) or the `site` branch moving after it (git); unknown stays unknown.
- Framework banner-pack assets `status/shipped` and `counter/shipped` (counter `shipped.unread`), baked into every shared-asset app, so the widget is in the banner editor and gallery.

## How it works

- Plugin folder `apps/console-web/plugins/whats-shipped` (display name "What's new"). The folder is not `whats-new` because the systems check already has a "What's new" banner strip with that id (raw commits since an admin cleared it, AI summary); the lifecycle check rejects two plugins sharing the string. The two are different things; renaming the systems-check strip (e.g. "Recent commits") is Brett's call.
- Server `GET /feed[?refresh=true]`, `GET|PUT /config`. Feed cached in memory and `.axf-console/plugins/whats-shipped/feed.json`; rebuilt when the store or a report changes (mtime), when main moves (git) or every 5 min (GitHub), or on Check now. Merged PRs' file lists are cached for good.
- Apps come from changed paths: `apps/<x>` → the app (manifest `displayName`, friendly names for console / axHub / Patches), `apps/console-web/plugins/<x>` → that plugin, `framework/` → Framework. Notes, logs, `_claude/`, plans and baked `src/axf` copies don't count, so plan-only PRs never show as features.
- First visit on a device: anything older than 7 days counts as read, so the count starts small.
- orch-live-sync seam: its per-step `branch` / `pr` / `merged` fields are read already; once its builds-live events are on main, `Sources.fingerprint` can switch to them.

## Tests

| check | before | after |
| --- | --- | --- |
| `python3 apps/console-web/plugins/whats-shipped/test.py` (fake GitHub + git) | — | 47 pass |
| `test.mts` (grouping, search, read marks, first run, ticker, widget, paint) | — | 12 pass |
| `check-theme.mjs` / `check-controls.mjs` | green | green |
| `plugin-lifecycle.mjs check whats-shipped` | — | clean |
| `help-coverage.mjs --check` | 100% | 100% (17 written entries) |
| `shared-assets.mjs check`, `axf.mjs validate --framework` | green | green (481 assets) |
| console `tsc --noEmit` | 0 errors | 0 errors |
| Real repo smoke test (git, no token) | — | 133–140 items, 0.6 s cold, 9 ms cached |

## Fixed on the way

- `opens: false` is refused for new plugins by build-defaults: the server didn't load (404 in the panel). Now `opens: "dialog"`; found by the screenshot run.
- A CSS import still pointing at the old file name after the folder rename broke the Vite build; found by the screenshot run.

## Screenshots

Phone + desktop in `_claude/builds/reports/whats-new-banner/shots/after/` (banner, panel by date, panel by app with an item open, settings). Taken offline (`AXF_APPEARANCE_HUB=off`, git source, no token).

## Known gaps

- Android: deferred gap in `framework/spec/PORTING.md` (Android on hold); the widget already works through the Kotlin `status` widget.
- On a phone the banner's right side is crowded; the widget is there but the banner scrolls sideways to it (same as the build-status dot).
- Without `GITHUB_TOKEN` the PR body isn't available, so summaries come from reports and Codebase changes only.
- Read marks are per-device console settings (they follow the console's own settings sync, not a server list).
