# Land overlay-preview-ui-review: resolve clash in approvals-banner

Build `land-overlay-preview-ui-review-resolve` (Opus, phase 1). Brett, Nov 13 2026: "land the overlay preview in UI Review".

## s1: merge main into the overlay preview

Branch `claude/overlay-preview-ui-review` (PR #626) clashed with main in
`apps/console-web/plugins/approvals-banner/help.json` and `web/index.tsx`. Merged `origin/main` into it on
`claude/land-overlay-preview-ui-review-resolve` and kept both sides:

- `web/index.tsx`: main's overlay rework is kept as is (overlay verbs, native bridge, settings migration,
  `IDLE_OPACITY_MIN`, renamed fields; the retired `PAGES` / `parsePageCommand` / idle-visible setting stay gone).
  From the branch: the `OVERLAY_TAB` import, the `OverlayPreview` import, and the overlay settings section's
  `tab: OVERLAY_TAB`, so the preview and the settings share Settings → Plugins → Overlay.
- `help.json`: the branch's tab / preview / design option / state entries plus main's per-field entries. The tab
  entry's list of settings now names main's fields (the "where pages go" setting is gone on main).
- Choice-set assets (`assets/overlay-toolbar/overlay-toolbar-shape-{pill,rail,bubble}.json`) came over unchanged.

Main itself was not touched: PR #653 (supersedes #626) goes through the merge queue (rules: never push to main).

## s2: overlay preview in UI Review

Submitted to the live console's UI Review as a choice set (ui-choices@1), item `r-20261113-9079daf9`, group
"land-overlay-preview-ui-review-resolve - Nov 13 8:45 PM", kind settings, screen Settings → Plugins → Overlay,
14 screenshots (desktop and phone). Set `overlay-toolbar-shape`, asset type `overlay-toolbar`, owner
`approvals-banner`, options A · Pill, B · Rail, C · Bubble, each with collapsed / approval waiting / expanded shots.
The option Brett picks is the spec for the Android overlay. Waiting for Brett.

Shots: `rebuild-shots.mjs` against this branch (scratch console, `AXF_APPEARANCE_HUB=off`, so default skin).

## How it is reached (API)

- Deep link: `settings.open:approvals-overlay` (Plugins menu → "Overlay (phone) preview"; the settings tab
  `approvals-overlay` is in the console-control@1 inventory, so console_show / console_open reach it; search
  "Overlay preview").
- Settings: every overlay setting is a console field, `settings.set:approvals-banner.overlay.<key>:<value>`, the same
  through REST, MCP console actions, the CLI and voice (unchanged from main).
- The preview's option / state pickers are framework TabGroups (`approvals-overlay.preview.option`,
  `approvals-overlay.preview.state`), addressable through console-control@1. The preview sends nothing.
- The pick: `review.mjs decision r-20261113-9079daf9 --console` (UI Review REST `choices/decision`).

## Tests

- `approvals-banner/test.mts` (node 22): 29 checks passed. `test.py`: relay ok (58 checks).
- `tsc --noEmit` (console-web): clean.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass.
  `plugin-lifecycle check approvals-banner`: clean.

## Costs / snags

- Headless shots were slow and flaky: the first page load after Vite start loses a chunk (fixed by a reload step),
  global search is empty for the first seconds, and a second page per browser timed out. Ran one shot per run;
  about 25 minutes over the step budget.
