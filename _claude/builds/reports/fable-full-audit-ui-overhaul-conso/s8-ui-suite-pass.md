# s8 — Full UI suite pass: spacing, alignment and sizing on every screen

Build `fable-full-audit-ui-overhaul-conso`, step s8 (Fable, Nov 20 2026). Brief: touch up and patch every screen,
tighten spacing, alignment and sizing everywhere.

## How the pass was done

1. Static audit of every stylesheet the console renders (82 CSS files: console, plugins, framework libraries) plus the
   view roots in TSX: off-scale spacing math, hard-coded element sizes, utility classes that markup uses but no
   stylesheet defines, how each view wraps its page head.
2. A throwaway Playwright harness (not committed) served this worktree's `dist/` with `vite preview`, proxied GET
   `/api/*` read-only to the live console container (live data, nothing written: every non-GET answered offline, the
   hub appearance switched off so the page does not wait on axHub) and opened every console-control `view:` address
   at 1440×1000 and 412×915, every tab of the first tab group on desktop. Shots before and after, reviewed one by one.
3. Every fix checked with `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets` and `tsc --noEmit`;
   all green after every commit.

## What was found and fixed (11 commits, each separately landable)

| # | Commit | Screens | Found | Fixed |
|---|--------|---------|-------|-------|
| 1 | spacing onto the density scale | UI Review, Shipped features, Context menu designer, Feature matrix, Molly guide, Audio out, Activity banner, datagrid, hubstatus | 84 gap / padding / margin values written as `calc(space / 2,3,4)`, off the density scale; small UI element sizes in `console.css` (checkbox, swatches, dots, port badges, meters, progress bars, template icon), the assistant avatar and the context-menu colour input in raw px; focus rings and side markers in px | Density tokens (md / sm / xs); sizes in space or text units so they follow the density and typography assets; hairline token for rings and markers; the plan board column head sticks at the column's own padding instead of −6px |
| 2 | one title-to-content rhythm | 34 plugin views | The gap between a page head and its content differed per screen: 25 views used the large stack, 14 the plain stack, 12 dense roots set their own tighter gap (md to xl) | Every view that opens with a page head sits in the large stack; the 12 dense roots give the page head a margin that tops its distance up to the same console-wide value, their content keeps its own rhythm |
| 3 | framework stylesheet utilities | AI keys, GitHub app, chrome settings context, Crew, UI Review, Help, Plan Studio, Agent voice | `fx-stack--sm` (15 uses), `fx-stack--xs`, `fx-row--between`, `fx-link`, `fx-error`, `fx-input--sm` were written in markup and defined nowhere, so small stacks fell back to the default gap and rows never spread; `h4` kept the browser's default margins | All six defined next to their siblings in `framework/ui/axf.css`; `h4` gets the same zero-margin reset as h1–h3 (`.fx-md` keeps document margins); the console's tracked copy mirrored |
| 4 | views open at their top; gaps | every view; Standards; Build queue; Boilerplates | The main area is one scroll container and nothing reset it on navigation: after scrolling Tracker or Catalog, the next view opened mid-page with its page head off screen (half the "before" shots show it). Standards: project name and slug touching. Build queue: "Show built steps" and "Model" filters flush against each other. Boilerplates: screen chips read "Chat chat" | `AppShell` scrolls the main area to the top when the view changes; Standards title row gets a real gap and baseline alignment; one `bm-filters` row with a proper gap (inline gap styles moved to CSS); wider gap inside the screen chips |
| 5 | plugin screens start where core screens do; toolbar counters; assistant list; agent strip | every plugin view; Agent swarm, Codebase changes, Notifications toolbars; AI assistant; Agent manager | The plugin settings gear had a row of its own above every plugin screen (plugin titles one row lower than core titles). Toolbar counter badges drew over labels ("Job typ9", "Bu$467", "Mark re30", "Filter l31"). Assistant conversation titles centred and cut off at both ends. Agent manager status chips 2px apart with the contract caption glued on | Gear bar takes no height and sits on the eyebrow line; a labelled toolbar button keeps its counter in the flow (icon-only buttons keep the corner badge); conversation rows stretch and truncate with an ellipsis; chip strip at the regular gap with the caption spaced |
| 6 | data grid column heads | Gate, Merge queue, Builds, Crew, every DataGrid | Column heads are framework buttons and centred their label over wide columns ("Rule" floating mid-column over left-aligned cells) | Head cells start at the cell's edge; end-aligned columns keep right alignment; console copy mirrored |
| 7 | shipped features bar; merge queue timer | Shipped features; Builds / Merge queue | View segment half a row above the search input; timer cell "5h 09m/ 2d 12h" (flex swallowed the space) | Bar aligns to the bottom; regular gap in the timer |
| 8 | text columns in text units | Agent swarm (Cost tab), Chats, Shipped features | Grid columns sized in `--fx-space` multiples; spacing presets run 2.9–8px, so under a compact preset the number columns shrank to ~20px and overprinted (headers and values) | The width helpers count in text size (same result at the default scale) |
| 9 | builds table phone meta line | Builds, Merge queue (phone) | The status table's one-line phone meta used the class `st-meta`, which the Standards page defines too; the later stylesheet won and rows read "7/75h 25m/ 2d 12h#853" | Own class `st-rowmeta` with regular gaps; Standards keeps its rule |

Verified on the "after" shots: plugin titles start on the same line as core titles, toolbar counters sit after their
labels (Agent swarm, Codebase changes, Notifications), the assistant list is left-aligned and truncates, the Standards
slug has its gap, the build filters are apart, the swarm Cost grid is legible, grid heads start at their cells. Nineteen
plugin views (Agent voice, AmberX listeners, Build Breaker, Builds, Changes & features, Claude handoff, Claude session,
Crew, Fable rebuilds, Feature matrix, MD Studio, Notes, Audio out, Plugin Update, New project, Sessions, Theme editor,
Theme manager, Voice notes) could not be opened by address in a fresh browser (see below), so they were reviewed in
CSS only; the page-rhythm and framework fixes apply to them all the same.

Also touched up on the way: the AI assistant `__conv-main` rows, Agent manager strip, and the Standards title are the
only plugin-internal CSS changes outside layout; every change is layout, never a control's look (controls stay the
framework's).

## Checks

`node framework/cli/check-theme.mjs` · `check-controls.mjs` · `check-toolbars.mjs` · `check-chrome-assets.mjs`:
all pass after every commit. `tsc --noEmit` on the console: clean. Theme baseline unchanged (286 frozen findings).

## Found, not fixed here (for the audit's other steps)

- **Pending builds and Chats stall capture** (s6/s7): on both views a Playwright screenshot waits 20 s+ and the
  page's console-control calls stop answering afterwards; the main thread is busy. Reproducible with the harness
  (`view:pending`, `view:chat-viewer`); `Pending.tsx` shows no obvious loop, so it needs a profile.
- **console-control `open view:<id>` fails for a plugin whose chunk has not loaded** (s2/s6): `not_found` until the
  lazy loader has loaded that plugin (a fresh browser has no cached library shape), so 20 plugin views could not be
  opened by address on first visit. The harness waits for the loader and retries; the console itself should load the
  plugin on demand for an `open`.
- **Home cards show raw JSON** for reads with no renderer (Claude accounts, Terminal): a rendering gap, not spacing.
- **Agent slots panel renders above the Build queue page head** on a phone (a full screen before the title).
- **Tabs above the page head** on Libraries (framework tab group placement) and the stacked toolbar + tab row on
  Gate / Agent swarm: s9 / s11 territory.
- Grid column widths still in space units in Gate, Builds, Merge queue and Crew (all ≥ 9 space, fine at the default
  scale; the same compact-preset risk as #8 for the 9–11 space ones in Builds).

## UI Review

Six items wait in UI Review, group **"fable-full-audit-ui-overhaul-conso - Nov 20 11:07 AM"** (kind Screens & pages, app
console-web), each with before / after desktop shots and after phone shots: Agent manager (gear bar, chip strip),
Agent swarm (toolbar counters, Cost grid), AI assistant (conversation list), Standards + Build queue + Boilerplates,
Merge queue + Gate + Codebase changes + Notifications + Shipped features (grid heads, timer, counters, bar), Home
(every view opens at its top). Items r-20261120-026358d6, -51d1371f, -dac3b146, -3adb4571, -79852698, -e652e9b7.
