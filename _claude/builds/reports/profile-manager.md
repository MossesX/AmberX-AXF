# Build profiles manager (profile-manager) — Nov 28 2026

Brett's ask (voice, Nov 3 2026): "a plugin to manage build profiles: view, browse, create, edit, delete, everything."
Grow the existing Build profiles plugin into a full manager page; keep its id, its data and every existing feature;
commands declared once so REST, MCP and the CLI all get them (reads allow, changes veto, data delete confirm).

Pipeline 2.0, five steps, all on Fable, one PR (#942, opened as a draft by the orchestrator). The lander merges the
steps; this branch (`claude/profile-manager--s5`) already holds s1–s4 merged, with the three conflicts between the page
and the cleanup helper resolved, so merging it alone brings the whole build.

## What was built

| Step | Where | What it does |
|---|---|---|
| s1 engine | `framework/cli/profiles.mjs`, `framework/plan/builds-store-core.mjs`, `framework/cli/persist.mjs` | Numbers per profile from the builds store (builds by status, pending items, queue steps, steps done and left, cost spent and an estimate of the cost left, last activity). Colour and icon on a profile (asset names, never literals). Duplicate, merge, move builds, archive / unarchive. Remove keeps the profile restorable; restore brings it back. Purge deletes a profile's folders and the builds that live only in it: owner only, typed confirm, never the base or the active profile. Cleanup scan and fix. |
| s2 commands | `apps/console-web/plugins/build-profiles/plugin.json`, `server/__init__.py`, `apps/console-web/server/main.py` | One route per command under `/api/plugins/build-profiles/`: list, get, create, update, select, duplicate, merge, move-builds, archive, unlist (remove), relist (restore), purge, cleanup, cleanup fix. Declared once (plugin-commands@1), so they are on REST `/api/control`, MCP and the CLI. Reads are reads, changes are writes, purge is destructive with a confirm and owner only. |
| s3 page | `web/index.tsx`, `web/build-profiles.css`, `web/menu.ts`, `assets/toolbar/build-profiles.json`, `help.json` | Page **Builds → Build profiles**: a grid of every profile (on the list, archived, taken off it) with builds, cost spent and left, last activity; search, sort and filter on the page toolbar; a row opens to Builds, Pending, Queue, Plan and Files. Dialogs: profile view, one form for Create / Edit / Duplicate (colour and icon), Merge, Move builds, one confirm for Archive, Take off the list, Restore and Delete data (typed id). Banner chip takes the profile's colour and icon. Right-click: "Build profiles…" everywhere, a profile's own menu on its row, "Move to profile" on a build on any page. |
| s4 cleanup | `web/cleanup.tsx`, `web/cleanup-core.mjs`, `cleanup.test.mjs`, `cleanup-e2e.test.mjs` | Cleanup helper (Builds → Clean up builds…, and a notice in the quick picker): archived builds that really finished, and builds tagged with a profile that no longer exists, each with a one-tap fix and Fix all. Builds without proof on record are listed with the reason and no button. Nothing is deleted. The router was also taught the CLI's own field names, verified end to end. |
| s5 this step | `shots.mjs`, this report, UI Review, THREADS | Screenshots, the UI Review item, and the fixes below. |

Everything that existed before still works: the banner chip, the quick picker dialog (switch, new, rename, take off the
list), the app menu entries and Settings → Plugins → Build profiles.

## Fixed in this step

Found while putting the steps together and taking the pictures:

- **The steps did not merge cleanly.** The page (s3) and the cleanup helper (s4) both changed `index.tsx`, `menu.ts`
  and `help.json`. Both sides are kept (commit `d99572137`).
- **A row's build list would have been empty in the live console.** The plugin's `get` route answered from the
  profile list, which has no builds, so the page fell back to counts only and build ids typed by hand. `get` now
  uses the CLI's own `get` (profile + its builds); `active` and `effective` are flags. One more server check.
- **The page had no page head**, which `check-plugin-pages.mjs` fails in CI. Added: eyebrow "Builds", title, the
  one-sentence description.
- **PR numbers read "PR ##943"** in a build row, because the store writes `#943`. Fixed.
- `plugin.json` `provides` now lists `view:build-profiles`.

## Screenshots

Desktop (1440 × 1000) and phone (412 × 915) of eight scenes, in `_claude/builds/reports/profile-manager/`:
`profile-manager-<scene>-<desktop|phone>.png` for `grid`, `view`, `edit`, `merge`, `move`, `confirm`, `cleanup`,
`picker`.

Retake them with `node apps/console-web/plugins/build-profiles/shots.mjs <out-dir>` after `npm run build` in
`apps/console-web`.

**The pictures use fixture data, not the live store**: five made-up profiles (one archived) and one off the list, and
the same seven builds for whichever row is open. The live console has two profiles today (`all`, 1,047 builds, and
`test-sandbox`). The layout is real; the numbers are not.

## UI Review

Waiting on Brett: **`r-20261128-8e7c692d`** (kind Screens & pages, group "profile-manager - Nov 28 11:29 AM", 16
pictures, PR #942).

- `r-20261128-7761aebd` in the same group is the first send, taken before the page head was added. It is superseded
  and was left for Brett to clear: a build does not decide its own items.
- Sent as a single option, not the usual three: the steps built one layout to the spoken spec and no alternatives.
  If Brett wants options, that is a follow-up.

## Tests

| Check | Result |
|---|---|
| `node framework/spec/check-profile-manager.mjs` (new, in CI) | 18 checks, on a scratch store |
| `python3 apps/console-web/plugins/build-profiles/test.py` (new) | 81 checks: reads against the real CLI, changes against a stand-in |
| `node apps/console-web/plugins/build-profiles/cleanup.test.mjs` (new, in CI) | 9 checks |
| `node apps/console-web/plugins/build-profiles/cleanup-e2e.test.mjs` (new, in CI) | 9 checks: the plugin's routes → the real CLI → a scratch builds store |
| `npm run build` in `apps/console-web` (`tsc --noEmit` + `vite build`) | clean |
| `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `check-plugin-pages`, `check-plugin-settings` | green |
| `plugin-commands.mjs check` | 79/79 plugins |
| `plugin-lifecycle.mjs check build-profiles` | clean |
| `help-coverage.mjs` | console-web 1777/1777 |

Not run here: the full CI block (every other plugin's tests, menu reach, the Playwright theme swap). CI on the PR
runs it.

## Known gaps

Asked for in the brief and **not built**:

- **Drag build rows onto a profile.** Moving builds is multi-select plus the Move builds dialog, and "Move to
  profile" on right-click.
- **Agent avatars on a profile's builds** (the brief said "once crew-live lands").
- **A timeline** in the profile view. It has the details, totals and the five tabs.
- **Links to the Builds page filtered to a profile.**
- **The "All profiles" picker on every builds table** (`_claude/memory/follow-ups.md`): a separate follow-up, not
  in this build's steps.

Worth knowing:

- **Pending, Queue and Plan in an open row are the lists of the profile in force**, read from the console's own
  `/api/pending`, `/api/build-queue` and `/api/plan`. For any other profile the tab shows the count only.
- **Whether this page is still wanted is Brett's call.** On Nov 7 every profile was merged into one (`all`) and this
  build was marked superseded (`_claude/memory/decisions.md`); the pipeline relaunched it on Nov 27–28. With one
  working profile, merge and move builds have little to act on today. Cleanup, stats, archive and restore still apply.
- `get` for `all` returns all 1,047 builds in one answer (about 530 KB). The page pages them 40 at a time on
  screen, but the request is not paged.
- No feature entry was added to `framework/catalog/status.json`: that file is being removed by B-3386 / B-3388,
  which this build was flagged as clashing with.
- Android: nothing. Web, Node and Python only; no engine in `framework/core` and no cross-port contract changed.
