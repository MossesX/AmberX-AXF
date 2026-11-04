# molly-multi-instance-tabs — Molly: new tab (+), multiple instances, tab menu, Reset layout findable, any surface draggable

Build `molly-multi-instance-tabs` (Current profile, Fable, agent Earl, Nov 4 2026). Branch `claude/molly-multi-instance-tabs`.

## What Brett said (verbatim, Nov 4 2026, voice)

> In Molly's xLayout IDE mode: "How do I make a new tab in Molly?" ... (there's no + button) ... "Need to be able to add a tab so I can have multiple instances."
> Also: "How do I reset the layout? Because I run it IDE style and I made a bunch of tabs."
>
> ADDENDUM 1: "Any screen or any UI whatsoever can be dragged."

## What changed

### Contracts (s1, Fable)

- **windows@1** (`framework/core/engines/windows.ts`): `TabSpec.instance` = which copy of one kind + payload a tab is (absent = the first). Pure helpers `instanceOf` / `instanceTabId` (`molly-app:console.2`) / `baseTabId` / `instanceTitle` (`Console 2`) / `baseTitle` / `instancesOf` / `nextInstance` (lowest free number, a freed number is reused) / `instanceTab`. `WindowManager`: `tabOf`, `allTabs`, `duplicateTab(id, title?, max)`, `closeOthers`, `floatTab` (the same code main-area-tabs adds, so the two branches merge clean), `dragGhost` / `dragCancel`, `moveTabTo(id, side)`, `tabMenu(tabId?)` (New tab… / Duplicate / Rename… / Close / Close others / Move to pane ▸ the other panes by their tab + the four sides / Pop out to window), `newTab` host hook + `openNewTab` (the "+" is drawn only when a host sets it), undo history per window (`checkpoint` / `canUndo` / `undoLayout`; every drop, pop-out, close-others, move, split, undock, redock, preset and reset is checkpointed; `restoreLayout` pulls the snapshot's tabs out of other windows first so nothing is on screen twice), `resetDock` (closes every pane and tab, undoable). `dragEnd`: a tab let go outside every dock pops out to a floating window under the pointer (`dockRules.floatOut`). `dragTo` / `settle`: a floating window held over another window's dock for the split dwell previews a dock@1 zone and docks its tabs there on release (`dockRules.windowDocks`). Group menu gains *Undo layout change*.
- **dock@1** (`dock.ts`): rules `floatOut` + `windowDocks` (default on); snapshots keep `instance` (`parseTab` reads 2..999); `DOCK_HISTORY_MAX` (20) + pure `pushHistory` (equal snapshots not repeated, oldest dropped).
- **xlayout@1** (`xlayout.ts`): `ide.maxInstances` (1..12, default 4, validated; Molly's starter takes the default); `instanceLabel`, `instanceKey` (`console#2`), `parseInstanceKey`, `canAddInstance`, `newTabChoices` (apps with open counts + cap, the host's other views, Duplicate this tab); `guestUrl(…, instance)`.
- **embed@1** (`embed.ts`): `Embed.instance` + query `axf-embed-instance=<label>` (`EMBED_INSTANCE_QUERY`, `embedInstance`, `embedUrlFull({ instance })`, read by `embedFromQueryFull` / `detectEmbedFull`). The Dev Console's console-commands client announces `instance` ("Console 2"); the server keeps it; `consoleClientSummary` shows it and `consolePickClients` finds a copy by that name (`--to "Console 2"`), so Amber can target it.
- Runtime actions `windows.newTab` / `duplicateTab` / `closeTab` / `closeOthers` / `moveTab` / `moveTabTo` / `floatTab` / `undoLayout` / `resetDock`; context target `tab` (payload = tab id) → `tabMenu`.
- Fixtures regenerated: `dock.json` (`instances`, `history`, more `parseTab`), `windows.json` (`instances`), `xlayout.json` (`instances`, three `normalize` cases, two `errors` cases), `embed-takes.json` (`instances`). Checks grown: `check-dock.mts` (1747), `check-windows.mts` (424), `check-xlayout.mts` (250), `check-embed.mts` (450), `check-console-commands.mts` (72); the console-commands plugin test (7) and its server test (74, run in the `axf-console` image) pass. `PORTING.md` entry; `asset-types.json` description; JSON schemas regenerated.

### Framework React (s2)

- `TabGroupView`: the **+** at the end of every tab bar (`fx-tab__add`, when the host set `wm.newTab`). `TabChip`: right-click = the tab's menu (`tab` target), double-click = rename (`rename-tab` dialog in `windowDialogs`), touch = hold (`TAB_HOLD_MS`, a short buzz, `is-armed`) then drag, a hold released in place opens the menu, a move before the hold scrolls the bar; a drop that changed the layout shows a toast pointing at Undo.
- `DialogHost` (`Overlays.tsx`): drag the title (mouse: past the behaviour theme's `dragThreshold`; touch: `longPressMs` then a move) or press the new *Pop out* button or right-click the title → the dialog becomes a placed-dialog tab in a floating window under the pointer (the `PLACED_DIALOG_TAB` renderer every AppShell already has); swipe-down close is unchanged.
- `axf.css`: tokens-only rules for the +, the armed tab and the draggable dialog head.

### Molly (s3)

- `FrameDeck.tsx`: frames and slots keyed by instance key (`console`, `console#2`); each copy is its own iframe + session, titled "Console 2"; `frameUrl(app, start, instance)`; `openInstanceKeys`.
- xLayout plugin: `host.ts` keys frames by instance (chrome bundles stay per app; a pick goes to the copy on screen); `workspace.tsx` `openInstance` (up to `maxInstances`, toast at the cap), `openViewTab` (any Molly screen as a placed-view tab), `NewTabPicker` (Apps with open counts / Molly screens / Duplicate this tab), `ResetLayoutDialog` (confirm first), `resetLayout` (every pane and tab closes, the saved arrangement goes, the app on screen comes back alone; undoable), `undoLayout`; `keepIde` saves names and copies with the arrangement so renames and copies survive a reload. `index.tsx`: `wm.newTab` → the picker; actions `xlayout.newtab`, `xlayout.instance`, `xlayout.reset` (dialog; `:now` skips it, for the console action after its confirm), `xlayout.undo`; View menu: New tab…, Another copy of this app, Undo layout change, Reset layout…; right-click any tab, tab bar or the dock background: Undo + Reset layout; nav item: Open another copy; xLayout settings: *Copies of one app* + Reset layout… + Undo. `model.ts`: setting `xlayout.ide.maxInstances`. help.json entries; README.
- `xlayout.css`: frames let the pointer through while a window is dragged over the dock (`.fx-dock-drop`, `.fx-snap-preview`), picker rows.

### Rule (s4)

`_claude/rules/RULES.md` → **No UI surface is fixed in place**; `framework/spec/PORTING.md` carries the deferred Android twin.

## Where Reset layout is now

1. Molly menu bar → **View → Reset layout…** (and *Undo layout change* right above it).
2. Right-click (or long-press) any **tab**, any **tab bar**, or the dock background in IDE mode → *Reset layout…*.
3. Settings → Plugins → **xLayout** → *Reset layout…* (and *Copies of one app*).
4. Console action `xlayout.reset` (confirm dialog) / `xlayout.reset:now` (after a confirm token: the action id contains "reset", so control@1 asks for one), `xlayout.undo`.

## Screenshots (UI Review, non-blocking)

Group "molly-multi-instance-tabs - Nov 4 4:35 PM", kind *screen*, app molly; files in `_claude/builds/reports/molly-multi-instance-tabs/shots/` (desktop 1280×800 + phone 412×915; the framed apps are stubbed): 1 tab bar with +, 2 new-tab picker, 3 Console + Console 2, 4 tab menu, 5 Reset layout confirm, 6 after reset + undo.

## Surfaces and how they move (addendum)

| Surface | Drag by | Into another tab group | New pane (edge zones) | Out to a window | Back | Phone |
| --- | --- | --- | --- | --- | --- | --- |
| App instance tab (Molly IDE) | its tab | yes (dock@1 header / centre) | yes (pane edges, host edges) | yes (let go outside every dock, or Pop out) | yes (window title held over the dock, Redock, Redock into…) | long-press, then drag |
| Molly screen / plugin view as a tab (placed-view tab) | its tab | yes | yes | yes | yes | long-press, then drag |
| Floating window (any app) | its title | its tabs join a pane (held over the pane centre / header) | yes (held over a pane edge or the dock edge) | — | yes | hold, then drag (window grip) |
| Dialog (any app) | its title (or the Pop out button / right-click) | once a window: as above | once a window: as above | yes | Redock from the window | long-press, then drag |
| Console main-area screens | — | being built by `main-area-tabs` (main-tabs@1; paused) | | | | |

Not draggable (and why): the banner, menu bar, navigation rail and toolbars are chrome assets placed by their own engines (toolbars move by location in the Toolbar designer; the banner's widgets by Arrange widgets), not surfaces; the Settings interface's panels are sections of one dialog (the dialog itself moves); an app's frame in Molly with IDE mode **off** fills the page by design (one app at a time) — switch IDE mode on to drag it; the console's main-area screens wait for `main-area-tabs`.

## Coordination

- `tab-group-assets` (running, Fable s3 puts the framework TabGroup on the tab-group asset): keep `TabGroupView`'s +, the tab menu and hold-then-drag when migrating; nothing in this build touches its files.
- `main-area-tabs` (paused): `floatTab` / `dragGhost` / `dragCancel` are the same lines in the same place, so the merge is clean.
- Android on hold: everything is web only, deferred in PORTING.md.

## Checks run

`check-dock`, `check-windows`, `check-xlayout`, `check-embed`, `check-console-commands`, `check-chrome` (tsx); `console-commands/test.mjs`; `test_console_commands.py` in the `axf-console` image; `check-theme.mjs` (axf.css, the changed TSX/CSS), `check-controls.mjs`, `check-toolbars.mjs`; `tsc --noEmit` for `apps/molly` (clean) and `apps/console-web` (only the pre-existing `src/axf/plan` errors of a CI-style re-bake); `vite build` for Molly; the Playwright run behind the screenshots exercised + → picker → Console 2 → menu → reset → undo on desktop and phone.

## Deploy

Molly's VPS install pulls `main` every 5 minutes and rebuilds when it changed, so the merge redeploys it; the console image is rebuilt by Coolify from the repo root. The live guests (console.amberxai.com) need the console redeploy for "Console 2" to announce its name.
