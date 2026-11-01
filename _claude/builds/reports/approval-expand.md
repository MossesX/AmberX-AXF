# approval-expand — every approval row expandable (Nov 1 2026, Opus, headless VPS)

Branch `claude/approval-expand`, pushed to `main` (Brett's brief).

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

## Not done: the app-menu "Waiting for approvals" dropdown

That dropdown is being rebuilt by **menu-approve** (Approve / Deny on each menu row, `LiveRow` in `framework/react/components/AppMenu.tsx`). That build hadn't landed on main after more than 60 minutes of waiting, and **approval-source** hadn't either. Touching `AppMenu.tsx` now would clash head-on with it. The hook is ready: `ApprovalDetailsPanel` renders the open part for a row the menu draws itself. **Follow-up:** once menu-approve is on main, add a caret to `LiveRow` (far right) and a details slot the approvals menu provider fills with `ApprovalDetailsPanel`. It's about 30 min of work and goes into the orchestrator as the next step of this build.

Who-asked badges show as soon as the hub sends `source` (approval-source, axHub decision 108). Until that's deployed they read "Not recorded".

## Tests

- New `framework/spec/check-approval-expand.mts` (jsdom; in CI next to check-approvals): **62/62**. Covers the model, collapsed by default with the caret last, opening by a tap on the row and on the caret, opening in place (same element), staying open on refresh with in-place updates, staying open across a remount, Deny/Approve inside working, buttons gone once decided, and output tail plus exit code from the job stream. jsdom was added as a framework devDependency.
- `check-approvals.mts` 66/66; `apps/axhub-web/test.mjs` 238/238 (one source-grep check updated to the shared row); approvals-banner test 10/10.
- The full local block from android.yml on the merged tree: 75/75 commands green. Also green: libs typecheck, builds of console-web / axhub-web / amberx-droid / walkthrough-studio, theme-swap, interface-scope, check-theme, check-controls and plugin lifecycle (all plugins).
- Fixed on main while testing:
  - Three "#108" doc mentions read as hex colours by check-theme; they now say "decision 108".
  - `output-recorder` lifecycle: added `_claude/memory/STATUS.md` to its `mentions`.

## UI Review

Item `r-20261101-396ffb92` (banner), 6 shots (desktop + phone: collapsed, an approval open, a held call open), waiting for Brett.
