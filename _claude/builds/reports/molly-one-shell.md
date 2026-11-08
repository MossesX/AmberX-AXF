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
