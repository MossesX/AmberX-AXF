# approval-expand — every approval row expandable (Nov 1 2026, Opus, headless VPS)

Branch `claude/approval-expand`, on `main` as `5e9b3475` (Brett's brief). The first push try failed while the VPS GitHub token was refused for writes. It works again; the banner item `blocked:push:approval-expand` was raised, then resolved.

## What Brett gets

Every approval row has a caret on the far right. Tapping the row or the caret opens it in place (no navigation) with:

- the full reason title and description (Claude's words, labelled as such)
- the exact command and arguments, in monospace and scrollable, with Copy buttons (the hub already hides secrets)
- who asked: source badge (Claude.ai / Claude Code / Headless / Console / Agent / System), session/build/agent name, client
- the tool, the policy (Veto, runs unless denied / Confirm, waits for approval), the state and risk tags (from the hub's effect plus what the command touches)
- a timeline: requested, live countdown or expiry, decided (when, by whom), ran at, finished, duration
- the result once it has run: exit code plus the last 12 lines of output (from the job stream), and a link to the full approval page
- Deny (red) and Approve (green) inside while it waits; they are gone once it's decided

The expanded state survives live refreshes. Open rows are kept outside React (`approvalsOpenStore`, per surface, mirrored in sessionStorage), so a new feed read updates the row in the same DOM element and never folds it. A row opened by a tap scrolls into view inside the banner or popover.

## Done once, used everywhere

- `framework/libs/approvals/details.ts` (pure): the `ApprovalDetails` model, `detailsOfItem` (lib-approvals feed item) and `detailsOfHubEntry` (the hub's approvals API entry), `sourceOf` (approval-source `source {kind, session, client, clientVersion, oauthClient}`; "Not recorded" on an older hub), `riskTags`, `timelineOf`, `exitLine`, `tailLines`, `ApprovalsOpenStore`.
- `framework/libs/approvals/row.tsx`: `ApprovalRow` (collapsed row plus caret) and `ApprovalDetailsPanel` (the open part on its own). It uses framework controls only (Button, Chip, Icon, fx-iconbtn) and its CSS (`.axf-apx*` in approvals.css) uses theme and scale tokens only.
- `react.tsx`: the title-bar popover rows use it; new `ApprovalsList` (a page of rows with the app host's deciding path).
- `core.ts`: each feed item keeps its raw entry (`entry`) so the details can read who asked, effect and timeline; `held[]` entries are read too.

Surfaces:
- **axHub web approvals list** (`apps/axhub-web/src/views/Approvals.tsx`): the shared row with the existing collapsed buttons (Deny / Approve now, held countdown + Shelve). Postpone / Ignore / Revoke and "Open the request" sit inside.
- **Console approvals banner** (`plugins/approvals-banner`): held and waiting rows are the shared row. It now reads the feed through lib-approvals `fetchApprovals` (same lib-hub read rules), so the details have the entry. "Full approval page" opens the veto screen or review dialog.
- **AmberX approvals view** (`apps/amberx-droid/src/views/Approvals.tsx`): `ApprovalsList` replaces the old Review-only cards; deciding goes through the phone's own path (`setApprovalsHost` decide).
- **Title-bar "waiting" popover** (lib-approvals badge): the shared row, compact and stacked.

## The app-menu "Waiting for approvals" dropdown (after menu-approve landed)

menu-approve put Deny / Approve on each live row (`LiveRow` in `framework/react/components/AppMenu.tsx`). On top of it:
- **Engine:** live-list rows may carry `expand: "<kind>:<key>"`. It's a runtime passthrough like `buttons` / `detail` / `deadline` (`core/types.ts`, `engines/appmenu.ts`; not an asset field, and the fixture is unchanged).
- **AppMenu:** `registerMenuRowDetails(kind, render)`. A row whose kind has a renderer gets a caret on the far right. A tap on the row or the caret opens the details in place without closing the menu or navigating; clicks and keys inside stay inside. Open rows live in a module set, so the menu reading its list again, or being closed and reopened, keeps them open. The AppMenu itself knows nothing about approvals.
- **lib-approvals:** rows carry `expand: approval:<id>`. `row.tsx` registers the `approval` renderer (`ApprovalDetailsPanel`, live, Deny / Approve inside). `registerApprovalsLookup` lets each list say where its items are and how they're decided: `installApprovalsMenu` for axhub-web and AmberX, and the console banner for its `approvals.list`.

## Tests

- New `framework/spec/check-approval-expand.mts` (jsdom; in CI next to check-approvals): **74/74**. The 12 menu checks: caret last on the row, a tap opens it in place without closing the menu, Deny / Approve inside decide, it stays open when the list is read again and when the menu is reopened, and the caret folds it. menu-approve's `check-approvals-menu.mts` still 53/53. Covers the model, collapsed by default with the caret last, opening by a tap on the row and on the caret, opening in place (same element), staying open on refresh with in-place updates, staying open across a remount, Deny/Approve inside working, buttons gone once decided, and output tail plus exit code from the job stream. jsdom was added as a framework devDependency.
- `check-approvals.mts` 66/66; `apps/axhub-web/test.mjs` 238/238 (one source-grep check updated to the shared row); approvals-banner test 10/10.
- The full local block from android.yml on the merged tree: 75/75 commands green. Also green: libs typecheck, builds of console-web / axhub-web / amberx-droid / walkthrough-studio, theme-swap, interface-scope, check-theme, check-controls and plugin lifecycle (all plugins).
- Fixed on main while testing:
  - Three "#108" doc mentions read as hex colours by check-theme; they now say "decision 108".
  - `output-recorder` lifecycle: added `_claude/memory/STATUS.md` to its `mentions`.

## UI Review

Waiting for Brett:
- `r-20261101-396ffb92` (banner), 6 shots: desktop and phone, collapsed, an approval open, a held call open.
- `r-20261101-657d9917` (menu), 4 shots: the app menu's "Approvals waiting" list, collapsed and open, desktop and phone.

## Also fixed on main

The console's approvals banner imports `@console/watchLive` (watch-live), and AmberX bundles that plugin, so AmberX's build failed on main: Rollup couldn't resolve the import. AmberX now has a `src/console/watchLive.tsx` bridge that draws nothing, since there's no previews API there, wired through the vite alias and tsconfig path.

## After approval-source landed (axHub decision 109)

- The axHub web list is now approval-source's DataGrid (Source / Who / What / Requested / Countdown / Decide). Its expand caret is already the row's last cell (far right). Added on top:
  - a single tap on the row opens it, while taps on its buttons and links don't;
  - open rows are kept in `approvalsOpenStore` (scope `axhub`), so they survive polls and coming back to the page;
  - the open row is `ApprovalDetailsPanel` with Deny / Approve inside, plus Postpone / Ignore / Revoke and Open the request.
- The source badge in my rows uses lib-hub's `HUB_SOURCE_LABELS / ICON / TONE`, so it reads the same as approval-source's badge everywhere. `who` counts as a name only when it's a real session/build/agent name.
- The banner keeps main's title and source on its pending items and in the fallback item.
- Final local run on the merged tree: the full android.yml web block passes 74/74 (plus my new check), libs typecheck passes, all four app builds pass, and theme-swap, interface-scope, check-theme and check-controls pass. Plugin lifecycle is clean except for gitignored hub sync copies, which aren't present in CI. axhub-web test 264/264, check-approval-expand 74/74, check-approvals-menu 53/53.
