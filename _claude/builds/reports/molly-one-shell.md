# molly-one-shell: Molly is the one native shell (phase 1 report)

Build `molly-one-shell` (orchestrator, profile `all`), branch `claude/molly-one-shell-r3`. Runs r1 and r2 died before
doing anything (expired login); this is r3, on Opus, by Reel Rhonda (headless).

## Brett said (verbatim)

> Brett wants everything in ONE app. Molly becomes the single shell for every app and plugin: Dev Console, axHub web,
> AmberX, and all future apps. Patches is scrapped. … Do NOT embed other apps as pages/iframes (no second file
> menu/banner/chrome). ONE native app … (full text on the build's origin and in `/root/axf-builds/molly-one-shell-r2/.brief.md`)

## Plan (14 steps, three phases)

| Phase | Model | Steps | State |
|---|---|---|---|
| 1 audit + cleanup | Opus | s1 audit unlanded Molly branches, s2 Patches leftovers, s3 gap list | **done (this run)** |
| 2 contracts | Fable | s4 shell-surface@1 (every app's screens/plugins/actions/settings/menus as data + native mount seam), s5 layout modes on the existing dock@1 + xlayout@1 (single/tabs/split/IDE, dock/split/float/resize, tab-group containers, named layouts; xlayout@1's guest/embed fields go), s6 menu index engine (grouped, search, favorites, recents) | next: needs a Fable session |
| 3 UI | Opus | s7 console native in Molly, s8 axHub web + AmberX native, s9 menus UI, s10 layout picker + IDE layout, s11 remove FrameDeck/embed paths, s12 voice/API/MCP/CLI, s13 settings sections, s14 UI Review (3 options) + tests + report | after phase 2 |

This run stops at the Fable switch: an Opus session can't run a Fable step (the step pin holds), and the contracts are
exactly the work Fable is for. Fable upgrades need no approval right now (`builds.fableUpgradeApproval` off), so the
next run just launches phase 2 on Fable: `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief molly-one-shell`.

## s1: unlanded Molly branches and related open PRs

| PR / build | What it has | Verdict |
|---|---|---|
| #328 `molly-multi-instance-tabs` (built) | Molly app instances as frames, embed instance, console client instance; framework tab group + button, tab menu, rename, hold-then-drag, windows@1/dock@1 undo history, float-out, dock back | **Frame parts superseded** (no embedding). **Framework parts reused** for IDE tab-group containers (s10). |
| #341 `molly-banner-match` (pending) | Molly's top banner = the console's banner asset; console in Molly drops its own; one Follow Amber approval pop-up inside Molly | **"Embedded apps hide their own" superseded.** Banner-asset part and the one pop-up go to s7. Don't land #341 alone. |
| #344 `drag-to-tab` (built) | drag nav items and tabs into tab strips, pane edges, out to a window | **Reuse** in s10 (drag from a menu onto a container). |
| #322 `apps-control-surface` (built) | every app on the API, MCP and CLI | **Reuse** in s4/s6/s12: shell-surface@1 reads it, doesn't duplicate it. |
| #369 `ui-registry-shortcuts` (built) | every screen, dialog, settings interface, menu entry, button and link registered (ui-registry@1) | **Reuse** in s4/s6: the all-apps menu index is built from it. |
| #323 `app-voice-commands` (built) | voice-command@1 for every app | **Reuse** in s12. |
| #372 `settings-sections-everywhere` (built) | categorized collapsible settings sections | **Reuse** in s13. |

Notes saying this are on each of those builds. Phase 3 should start after they land (or rebase on them).

**Superseded outright:** every Molly frame/embed path: `src/molly/FrameDeck.tsx`, xLayout's take-over of an embedded
app's chrome (`plugins/xlayout/web/host.ts`), the embed instance from #328. They stay working until s11 removes them,
so the live Molly keeps working meanwhile.

## s2: Patches leftovers

The Patches wrapper app was already removed on Nov 3 (`kill-patches-pilot`): no app folder, CI job, schema entry,
main-app list entry or nav entry is left (checked `.github`, `deploy`, `framework/schemas`, `framework/catalog`,
`apps/*`). What was left and is fixed here:

- shared `RULES.md`: the asset-system rule said "(Android on hold, Patches paused)" → "(Android on hold)"; the push rule
  now says the old Patches wrapper app is retired.
- `_claude/memory/docs/patches-banners.md`: marked retired (history only).
- `decisions.md`: the Nov 8 Molly decision (supersedes Molly's frame + embed design).

Left on purpose: build history (store, journal, changes, sessions, build-breaker asks) and every mention of
**Patches the crew member** (the build orchestrator, named after Brett's cat, `naming.md`). Nothing useful needed
migrating; Patches' ideas (one banner, one menu, plugin tabs) are what Molly now does natively.

## s3: gaps (parked as builds)

| Build | Gap |
|---|---|
| `molly-native-expenses` | Expenses is Next.js 16 + React 19; Molly is AXF React 18 + Vite, so its screens can't mount natively as they are. |
| `molly-sign-in-once` | Native screens call each backend from molly.amberxai.com: console bearer token, hub session, Expenses session. Molly needs one sign-in that hands each plugin its credentials (console CORS is already open). |
| (deferred, no build) | Android Molly: framework Android work is on hold; the Kotlin twins of shell-surface@1 / layout-mode go in `framework/spec/PORTING.md` when phase 2 writes them. |

Console, axHub web and AmberX native mounting are steps s7/s8 of this build, not separate gaps.
Until each lands, the standalone apps and Molly's current frames keep working unchanged.

## Tests

No code changed in this phase (rules, docs and builds data only). Checks run: `builds-store.mjs verify`.

## Cost

Phase 1 on Opus, about 30 minutes.

---

# Phase 2 + 3a (r4, Nov 8 2026)

Run r4, headless, agent Janitor Joey, branch `claude/molly-one-shell-r4` (r3's phase 1 merged in). Steps s4–s6 are
pinned to Fable; this run built them on **Opus as a recorded downgrade** (a downgrade passes by itself; r3 had stopped
at the switch and the build sat idle). Opus-built foundation work gets a Fable review before anything leans on it, so
**s15 (Fable) reviews the three contracts** and rebuilds only what it flags. The note is on the build.

## s4 shell-surface@1 (`framework/core/engines/shell-surface.ts`)

Every app as data: `app` (id, label, icon, description, standalone url), a **native mount seam** (`module`, `export`
default `mountSurface`, `api`, `auth` none | console-token | hub-session | app-session) and `items` (screen, plugin,
action, settings, setting, dialog, menu; an open list). A `frame` / `iframe` / `embed` / `webview` / `url` mount is
refused **by name** (no embedding). Qualified refs `<app>:<kind>:<id>` (`qualify`, `parseRef`, `resolveRef`),
`mergeSurfaces` (one per app), and two adapters so nothing is written by hand per app: `surfaceFromSearch` (an AXF
app's own search index: views, actions, settings tabs, settings, dialogs, menu items, plugins' too) and
`surfaceFromCatalog` (console-catalog@1, what an open console already reports). This is where #322 / #369's registries
plug in when they land (s7/s8).

## s5 layout modes on xlayout@1 (`framework/core/engines/xlayout.ts`)

Extended, no new asset type: `mode` single | tabs | split | ide (absent = ide when `ide.on`, so every existing asset
reads the same), `ide.containers` (a pane is a tab group or not), named `layouts` + `active`, and pure operations:
`effectiveLayout`, `containerIsTabs`, `setContainerTabs`, `openInContainer` (a tab group gains a tab after the front
one; any other container shows only the new thing; 40-tab cap), `closeTab`, `moveTab` (between containers or reorder),
`saveLayout` / `switchLayout` / `removeLayout` (20 at most), `setLayoutMode`, `snapshotLayout`. The pane mechanics
(dock / split / float / resize) stay dock@1's. The guest / embed fields (merge `guest`, `guestUrl`, `guestUserAgent`)
are **not dropped yet**: Molly's frames still use them; they go with the frames in s11. Asset type + JSON schemas updated.

## s6 menu-index@1 (`framework/core/engines/menu-index.ts`)

One menu over every surface: Favorites, Recent, then app → category (nested as items say; a setting sits under its
settings tab, which leads its group) → items. **Slim**: no level holds more than `maxPerLevel` (default 12); longer
levels fold into letter-range sub menus (`A–F`, `S 1` / `S 2` when one letter overflows, nested again past 144).
UAC filter, kind filter (a nav can show screens + plugins only), app order and hidden apps. `searchMenu` scores with
the search engine's `scoreEntry`, favorites then recents break ties; `menuPath` / `menuNode` for jumping into sliding
menus; `toggleFavorite` / `pushRecent` / `pruneRefs`; `fitBar` for the three-dot overflow.

Fixtures `framework/spec/fixtures/shell-surface.json`, `menu-index.json`, `xlayout-modes.json` (and `xlayout.json`'s
normalized outputs gained the new fields); `framework/spec/check-shell-surface.mts` (271 checks: replay plus
properties: every allowed item reachable exactly once, no level over the max, unique group ids, denied items gone, a
newly registered screen appears with no menu edit, saved layouts round-trip). In CI next to `check-xlayout.mts`.
PORTING.md: Kotlin twins deferred (Android on hold).

## s9 (+ parts of s10, s12, s13): Molly's One shell plugin (`apps/molly/plugins/shell`) <!-- axf-plugin:shell -->

- **Go** in the application menu: the index as nested sub menus (live provider, built on open) + *Go to anything…*.
- **Go to anything** (`Ctrl+K`, the Go menu, right-click anywhere): search every app, slide into groups (Back),
  star favorites, open in the main area, a pane or a floating window; items are draggable (`text/x-axf-ref`).
- **Layout modes** (View menu, settings, voice): one at a time, tabs, side by side, IDE; tabs / split / IDE lay out on
  the dock with their preset through a new seam on Molly's layout plugin (`mode` / `setMode` / `snapshot` / `restore`
  on its capability). **Named layouts**: save what's on screen (mode, preset, dock arrangement), switch, remove.
- Capability **`axf.shell@1`**: `register(surface, opener)` for native mounts (s7/s8), `surfaces`, `index`, `open`.
- Actions `shell.go | find | open | favorite | recents.clear | list | surfaces | mode | layout.save | layout.switch |
  layout.remove | settings` and matching plugin commands.
- Settings → Plugins → One shell: Layout, Named layouts, Menus (level length, apps shown), Favorites and recent, Apps in
  Molly (native vs still through the frames), Install & uninstall.
- **Where the items come from today:** Molly's own surface is its live search index (117 places in the shots). The
  four apps are always listed with their home screen; their pages, menus and toolbar join from the chrome Molly's
  layout plugin already receives, and open through it. That is the **stopgap**: it still rides the frames, and goes in
  s11 once s7/s8 register native surfaces.

Shots (not for approval) in UI Review → Screenshots, group "molly-one-shell - Nov 8 5:50 PM" (desktop + phone: Go
to anything, the Molly group, search "layout", One shell settings).

## Not done yet (honest list)

| Step | What's left |
|---|---|
| s7 / s8 | No app mounts natively yet: console, axHub web and AmberX still show in frames. They need a `mountSurface` entry each, registered through `axf.shell@1` (start after #322 / #369 land). Expenses stays a gap (`molly-native-expenses`). |
| s10 | Drag from a menu onto a container (items are draggable; no drop target takes them yet) and the per-container tab-group switch in the IDE UI (the engine has it). |
| s11 | FrameDeck, embed paths, the stopgap and the layout asset's guest fields still there (on purpose until s7/s8). |
| s12 | Actions and plugin commands exist; Molly's plugins aren't in the console's plugin-commands domain (MCP / CLI) yet. |
| s13 | One shell's settings are sections; the level toolbar on them isn't wired. |
| s14 | Formal UI Review with 3 options as assets not submitted; the PR is held until it is. |
| s15 | Fable review of the three contracts. |
| — | On a phone the pane / floating-window buttons hide through `pointer: coarse`; the headless phone shot still shows them (the dialog sits outside the narrow-layout wrapper). |

## Tests (r4)

- `npx -y tsx framework/spec/check-shell-surface.mts`: 271 checks pass (new).
- `npx -y tsx framework/spec/check-xlayout.mts`: 199 checks pass (fixture regenerated, unchanged behaviour).
- `apps/molly`: `tsc --noEmit` clean, `vite build` ok.
- `check-theme`, `check-controls`, `check-chrome-assets`, `check-toolbars`, `help-coverage --check`,
  `check-plugin-commands`, glossary `catalog.mjs --check`, `tracker.mjs --check`, `axf validate apps/molly` and
  `--framework`, plugin-lifecycle for shell + xlayout: all pass.
