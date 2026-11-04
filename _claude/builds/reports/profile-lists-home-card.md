# profile-lists-home-card — report

Build `profile-lists-home-card` (profile **current**), Opus, branch `claude/profile-lists-home-card`. Assigned: Ping Paulie (no Polo card on the roster). It continues `profile-switcher-widget` (PR #300, never merged); this PR replaces #300.

## What Brett said (verbatim, Nov 4 2026, voice)

> "I want a card on the home screen for build profiles." ... "And I don't want them to be all one list and filters anymore. I want it back to separate lists."

Addendum 1: "Actually, no, never mind. Leave it as filters."

So profiles stay a **view filter** (profile-filter@1, as in profile-switcher-widget's addenda): every builds view loads every build, and the switcher only hides what is not picked. Bulk actions act on what is visible.

## What was done

**1. Brought onto current main.** The old branch was 499 commits behind and its last (WIP) commit had swept in other builds' reports and store data. The new branch starts from main and carries only the switcher's code (plugin, engine, shared filter, Builds page changes, check, report). One conflict was in the Builds page (`builds-page/web/ui.tsx`): main's read/write tickets were kept, and `all=true` plus the Profile column were added on top.

**2. Counts per profile: running / queued / pending / built.** `buildCounts()` in profile-filter@1:
- running: status `running`
- queued: in the build queue (an epic or a build with a queue record), not running or finished
- pending: every other open build (pending, waiting, blocked, failed)
- built: all steps done, PR not merged
- `open` = running + queued + pending; archived and deleted builds count nowhere

The switcher's `profiles-list` read (REST / MCP / CLI) now returns these for every profile and in total. The CLI prints them too.

**3. The Build profiles card on Home.**
- It is a card@1 starter (`build-profiles`) that the Profile switcher plugin registers. It reads the plugin's `profiles-list`, so it is **on Home by default**. When hidden, Home → Show all (or the suggestion) brings it back. It goes away when the plugin is removed.
- It is drawn by the plugin's own panel:
  - Every listed profile appears in the switcher's order, with its counts as theme-toned chips (zeros left out, "nothing open" when empty).
  - The active profile is marked (primary button, "· active").
- **Tap a profile:** the filter shows only that profile and the Builds page opens.
- **★ on a row:** makes that profile the active one (where new builds go).
- **New profile:** opens the Build profiles dialog straight on the New profile form (new action `build-profiles.new`).
- **Manage:** opens the Build profiles dialog. **Show all** appears while a filter is on.
- **Suggested cards** offers "Build profiles" whenever the Profile switcher is on (`card-rules` CARD_SUGGESTIONS). If the card is on Home but hidden, picking the suggestion shows it again instead of adding a copy.

**4. Plugin card panels (generic).** `apps/console-web/src/cardPanels.tsx` lets any plugin draw its own read as a Home card (`registerCardPanel(folder, read, render)`). Until now only the console's own reads could be panels. If the plugin is off, Home draws the read's data with the engine's normal views, so nothing breaks. Home also picks up starter cards a plugin registers after Home has mounted.

## Not done (left open as a follow-up)

Step s6 of profile-switcher-widget is still open: adopting the filter in the remaining tables. These are the Orchestrator view (it needs an all-profiles projection), Pending, Queue, Plan, Tracker, the Git status board and Crew, plus `resolveFilter` + `profiles` on the land-all / merge-batch CLI and MCP commands. The Builds page and the new Home card use the filter today.

## Contracts / compatibility

- profile-filter@1 gains `buildCounts()`. It is an addition only, and the Kotlin twin is deferred as before (`framework/spec/PORTING.md`).
- The `profiles-list` counts gain `queued`, `pending`, `built` and `complete`. `open` and `running` are kept. For `open` the meaning is unchanged: it never counted built, complete or archived builds.
- card-rules gains the `build-profiles` suggestion. It was rebaked into console-web, axhub-web, amberx-droid and molly, and their `axf.lock.json` hashes were updated, so `rebake.mjs status` shows no "edited" app.
- New console module `cardPanels.tsx` and new action `build-profiles.new`.

## Tests

| check | result |
|---|---|
| `node framework/spec/check-profile-filter.mjs` | all pass (new: counts case) |
| `node framework/spec/check-card.mjs` | 9 checks pass (new: Build profiles suggestion) |
| `node apps/console-web/plugins/profile-switcher/test.mjs` | 11/11 (counts check widened) |
| `python3 apps/console-web/plugins/builds-page/test.py` | 14/14 |
| console `tsc --noEmit` | clean |
| `check-theme.mjs` / `check-controls.mjs` | pass |
| `plugin-lifecycle.mjs check profile-switcher` | clean |
| `axf.mjs validate --framework` / `shared-assets.mjs check` / `project.mjs validate --all` | pass |
| `tracker.mjs --check` | fails on main too: 390 items without a status in the hub's status.json (not touched here) |

## Screenshots

`profile-lists-home-card/shots/after/`: `home-build-profiles-card` (phone + desktop) and `card-tap-opens-builds` (phone). Plan: `profile-lists-home-card/shots.json`. Filed to UI Review (non-blocking).
