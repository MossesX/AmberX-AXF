# What's new (console plugin `whats-shipped`)

`ai.amberx.axf.console.whats-shipped` · built on Opus (Nov 3 2026, Urgent build `whats-new-banner`).

A **What's new** widget on the banner: the unread count and a ticker that steps through the newest feature titles
merged to main ("3 new · Theme Editor plugin…"), accent dot while anything is unread. Tap it for the panel.

It is the framework's **`status` widget** (no new asset type). The framework ships `status/shipped` and
`counter/shipped` (banner pack, so they show in the banner editor and gallery; counter `shipped.unread`); the plugin
registers its own `status/shipped`, repainted on every tick, with the tap action, and attaches it with
`rt.attachToBanner` (origin = the plugin id, so the console takes it off when the plugin is switched off).

## Panel

Group **By date** (Today / Yesterday / This week / Older), **By build** or **By app** (segmented switch, remembered per
device); search (every word must match title, summary, build, app or PR number); each item opens to what it does,
where to find it, merged / deployed times, build and branch, and PR / build report links. Opening an item marks it
read; Mark read / Mark unread / Mark all read. Items merged since the last visit are highlighted. Read marks and the
last visit are kept per device (`whats-shipped.read`, `whats-shipped.lastVisit`).

## Feed (whats-new@1)

`GET /api/plugins/whats-shipped/feed[?refresh=true]` (console token, 404 when off, never on MCP). One item per pull
request merged into main that changed an app, a console plugin or the framework (plans, notes, logs, `_claude/` and
baked `src/axf` copies don't count), plus builds the store marks merged with no PR found.

| field | from |
| --- | --- |
| title | the PR title with commit-speak prefixes dropped; else the build report's title; else the build title |
| summary, details | the build report's "What changed / What was built / …" bullets; else the Codebase changes entry for the branch; else the PR body |
| build, profile | the builds store: build `pr` / `branch`, or a step's (orch-live-sync's per-step fields), or `merged` / `mergedAt` |
| apps, where | changed paths: `apps/<x>` → the app, `apps/console-web/plugins/<x>` → the plugin, `framework/` → Framework |
| mergedAt, deployed | GitHub (`GITHUB_TOKEN`): merged PRs + successful runs of the deploy workflows on main after the merge; else git: merge commits on `origin/main` + the `site` branch's last commit. `deployed: null` = unknown |

Cached in memory and `.axf-console/plugins/whats-shipped/feed.json`; rebuilt when the store or a report changes, when
main moves (git) or every 5 minutes (GitHub), or on refresh. Merged PRs' file lists never change and are kept in
`pr-files.json`. No model tokens.

Seam for orch-live-sync: once its builds-live events land on main, `Feed.get` can rebuild on those events instead of
the store's mtime (`Sources.fingerprint`), and its per-step `merged` / `mergedAt` fields are read already.

## Settings

Settings → Plugins → What's new: show on the banner, step through the unread titles (device); what it shows (server,
`GET|PUT /config`): how far back (1–365 days, default 30), which apps (none picked = all), only deployed, deploy
workflows (default `deploy.yml`); install & uninstall.

Self-tests: `python3 apps/console-web/plugins/whats-shipped/test.py` (fake GitHub + git),
`node --experimental-strip-types apps/console-web/plugins/whats-shipped/test.mts` (grouping, search, read marks, ticker, widget).
