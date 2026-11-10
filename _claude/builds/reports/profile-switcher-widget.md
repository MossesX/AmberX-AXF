# profile-switcher-widget — report

Build `profile-switcher-widget` (profile **current**), Opus, branch `claude/profile-switcher-widget`. Assigned: Ping Paulie (no Polo card on the roster).

## What Brett said (verbatim, Nov 3 2026, voice)

> "I need a plugin that makes a widget that can be attached to a toolbar or a banner or whatever, that lets you select their build package. Also, select something that combines all build profiles."

Addendum 1: "So basically it's like a filter. They're all shown everywhere, but only one of them is rendered. Basically make it a filter. Always just show everything in every build profile, but it just effectively filters to hide them."

Addendum 2: "That said, it's gonna act upon what's visible."

## What was built

**profile-filter@1** (`framework/core/engines/profile-filter.mjs` + `.d.mts`, baked into `apps/console-web/src/axf/core/engines/`). Build profiles are a view filter, separate from the data:
- `{ all: true }` = every profile (no filter); `{ all: false, ids: [...] }` = only builds in at least one picked profile. Multi-select toggle (taking off the last one, or ticking every one = all).
- A build that names no profile is always shown, so nothing silently disappears.
- `bulkLabel` → `Merge 5 (filtered: Current)`; `bulkSummary` → which builds a bulk action includes (visible only) and `N hidden by the profile filter (Current) stay untouched`.
- `resolveFilter(arg, saved)`: CLI / MCP bulk commands take the saved filter by default, and an explicit `profiles` argument overrides it.
- Chip tones come only from the theme's Chip tones (accent, success, warning, danger, neutral).
- Kotlin twin deferred (Android on hold, `framework/spec/PORTING.md`).

**Console shared filter** (`apps/console-web/src/profileFilter.tsx`). One setting, `builds.profileFilter`, so a change anywhere redraws every table at once. It provides `useProfileFilter()` (apply / bulk / summary / only / toggle / showAll), `ProfileFilterNote` (`Filtered: Current · 12 hidden` + **Show all**) and `ProfileChips` (the Profile column).

**Plugin `profile-switcher`** (`ai.amberx.axf.console.profile-switcher`):
- **Widget:** a framework `status` asset (dot + `Current · 10`, or `All profiles · 77`). It is attached to the console's top toolbar by default and to the banner when picked. Every look value comes from the widget engines, and the tone comes from the profile's chip tone.
- **Tap:** opens the framework context menu (target `profile-switcher`). **All profiles** is at the top. Below it, every listed profile shows its open / running counts with a check mark when shown.
  - Tapping a profile makes it the active profile (new builds go there) and shows only it.
  - **Show together ▸** ticks several profiles.
  - **Place ▸** puts it on the toolbar or the banner.
  - **Manage profiles…** opens the Build profiles dialog, or the switcher settings when that plugin is off.
- **Attach anywhere:** right-clicking any toolbar or the banner shows `Profile switcher on this toolbar / banner` (a `*:` context extra). #272's drag-drop hook@1/drop-target@1 isn't on main, so this is the minimal registration the brief allows. Once it's placed, the framework's own *Arrange widgets* drag-and-snap moves it along the host.
- **Settings** (Settings → Plugins → Profile switcher): counts on/off, Full/Compact, per-profile colour (theme tones), listed/hidden, order (up/down) and placements. Install & uninstall panel.
- **CLI** `switcher.mjs list | current | select <id|all> | filter [all|a,b] [--toggle id] | visible [--profiles …] | settings`.
- **REST + MCP + `axf profile-switcher <cmd>`** come from plugin-commands@1: profiles-list, profile-current, profile-select, profile-filter, profile-filter-set, profile-visible, switcher-settings(-save).
- **Data:** `filter.json` and `settings.json` live in its data folder only. Uninstalling = no filter (every profile shown). The profiles and the active pick stay framework data.

**Builds page (builds-page plugin):**
- It always loads every profile's builds (`builds.mjs state all`, `GET /state?all=true`).
- The table draws through the shared filter, with the filtered note and a **Profile** column (chips) in both the Builds and Steps views.
- The old per-page profile select became a *Profiles* select that sets the shared filter.
- The header, progress, status-filter counts, Scope list, **Select all (N, filtered: …)** and the **Restore default** confirm cover visible builds only. The confirm says how many hidden builds stay untouched.
- Order is kept per profile, so drag-to-reorder needs exactly one profile in view (otherwise it shows a hint). Ops and drafts go to that profile, or to the active one.

## Not done in this PR (step s6, left open on the build)

The filter is not yet adopted by these tables: the Orchestrator view (it needs an all-profiles projection, since its writes are profile-scoped), Pending, Queue, Plan, Tracker, the Git status board, Crew and the Home cards. The existing bulk CLI/MCP commands (land-all, merge batch) don't take `resolveFilter` + `profiles` yet. Each one is a small adoption of `useProfileFilter()` / `resolveFilter()`.

## Contracts / compatibility

- New: profile-filter@1 (engine + check), setting `builds.profileFilter`, event `axf:profile-filter-changed`, plugin commands listed above.
- The builds-page `state` gains an optional `all` (CLI `state all` or `{all:true}`; route `?all=true`). Without it, the output is unchanged.
- Nothing was changed in `framework/cli/profiles.mjs`, the build-profiles plugin or the profile-manager branch files.

## Tests

| check | before | after |
|---|---|---|
| `node framework/spec/check-profile-filter.mjs` | — | 23/23 |
| `node apps/console-web/plugins/profile-switcher/test.mjs` | — | 11/11 |
| `node framework/cli/check-theme.mjs` | pass | pass (942 files) |
| `node framework/cli/check-controls.mjs` | pass | pass |
| `node framework/cli/plugin-lifecycle.mjs check profile-switcher` | — | clean |
| `commands.mjs check profile-switcher` | — | 7 reads · 3 commands |
| console `tsc --noEmit` | see below | see below |

## Screenshots

`profile-switcher-widget/shots/after/` (phone + desktop): builds-all-profiles, switcher-menu, builds-filtered-current, switcher-settings. Shots plan: `profile-switcher-widget/shots.json`.
