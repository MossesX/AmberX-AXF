# UI Review (console plugin, Angel build `ui-review`, Oct 30 2026)

Brett, Oct 30 2026 (voice, driving): rename the Design packs plugin and make it one all-in-one UI approval plugin.
Every UI a build makes goes there for his approval, separated by type, with design packs as one section.

## What it is

- **Folder** `ui-review` (id `ai.amberx.axf.console.ui-review`, replaces `ai.amberx.axf.console.design-packs`).
  View → **UI Review**; View → **Design packs** opens the same page on its Design packs section.
- **Sections** = kinds, an open registry: the plugin's `kinds.json` (Design packs, Whole apps / programs, Screens &
  pages, Settings interfaces, Dialogs & popups, Menus & toolbars, Banners & cards, Other), plus `kinds.json` in its
  data folder, plus any kind an item names (shown with a label made from its id). No code change for a new kind.
- **Item** (`review-item@1`): title, kind, app, build, branch, PR, screenshots (`device` phone / desktop, from the
  file name), notes, status (waiting / changes asked / rejected / approved), his comment, history (who, when,
  what, comment). Unknown fields are kept.
- **Views** (remembered in settings): Grid (collapsible rows, a row opens to the screenshot browser + details +
  decisions), Tree (kind › app › item, tri-state checkboxes), Sub-grids (group by kind, app, status or build),
  Gallery (large shots, a card opens full width), Compare (selected items side by side, one screen index for all).
  Every view has checkboxes; the bulk bar (Approve / Ask changes / Reject + comment) sticks to the bottom.
  Search, status, app, phone/desktop shots, order (waiting first by default), counts per section (waiting/total).
- **Design packs**: the 18 packs (3 rounds, 12 shots each) in the plugin's `packs/`; Pick (max 3) stays; picks
  moved from the old data folder (`.axf-console/plugins/design-packs/picks.json`) into the new one on first start
  (server import and `install.mjs` both migrate, then delete the old folder and its console-state entry). A pack can
  also be approved / rejected like any item (decisions are saved as an overlay `pack:<id>`).

## How builds submit

```bash
node apps/console-web/plugins/ui-review/review.mjs submit --kind settings --title "Level bar" \
  --shots a-phone.png,a-desktop.png --app Console --branch claude/x --pr 180 --console
node framework/cli/rebuild-shots.mjs --repo . --out shots --shots shots.json --submit screen --title "…" --pr 180 --console
curl -H "Authorization: Bearer $AXF_TOKEN" -d '{"kind":"screen","title":"…","files":[{"name":"x-phone.png","data":"<base64>"}]}' \
  https://console.amberxai.com/api/plugins/ui-review/submit
```

`--console` posts to the running console (`AXF_CONSOLE_URL` + `AXF_TOKEN`), so Brett sees it at once; without it the
CLI writes this checkout's data folder (`AXF_UI_REVIEW_DIR` overrides). `rebuild-shots --submit` finds the submitter
by capability (`service:ui-review@1` + `review.mjs`), never by folder name.

## State for other plugins (`ui-review@1`)

`plugin_services.get("ui-review@1")` → `state(branch, pr)`, `holds(branch, pr)`, `items(branch, pr)`, `submit(fields,
shots)`. HTTP: `GET /api/plugins/ui-review/state?branch=&pr=`. CLI: `review.mjs state --pr N --exit-code` (exit 3 =
held). The state is the strictest of the branch's / PR's items: rejected > changes > waiting > approved; `none`
when nothing was submitted. `holds` is true for waiting, changes and rejected.

**Follow-up (not built here):** the push banner's batch merge should hold PRs whose `ui-review@1` state holds. The
push-banner plugin is being changed by another build, so it was not touched; orchestrator `ui-review` step s9.

## Checks

`python apps/console-web/plugins/ui-review/test.py` (34 checks: migration, kinds, submit, shots, decide, bulk, packs,
remove, picks, state, capability) · `node --experimental-strip-types apps/console-web/plugins/ui-review/test.mts`
(11 groups: core, packs, CLI end to end, rebuild-shots option) · console `tsc` + `vite build` · `check-theme`,
`check-controls`, `check-plugin-pages`, `plugin-lifecycle check ui-review`, `menu-reach`: all pass.

## Screenshots (demo data: 9 submitted items + the 18 packs)

| View | Phone | Desktop |
|---|---|---|
| Grid, a row open | ![](../../../../_claude/memory/docs/ui-review/shots/after/grid-phone.png) | ![](../../../../_claude/memory/docs/ui-review/shots/after/grid-desktop.png) |
| Tree, two ticked (bulk bar) | ![](../../../../_claude/memory/docs/ui-review/shots/after/tree-phone.png) | ![](../../../../_claude/memory/docs/ui-review/shots/after/tree-desktop.png) |
| Sub-grids by kind | ![](../../../../_claude/memory/docs/ui-review/shots/after/subgrids-phone.png) | ![](../../../../_claude/memory/docs/ui-review/shots/after/subgrids-desktop.png) |
| Gallery | ![](../../../../_claude/memory/docs/ui-review/shots/after/gallery-phone.png) | ![](../../../../_claude/memory/docs/ui-review/shots/after/gallery-desktop.png) |
| Compare | ![](../../../../_claude/memory/docs/ui-review/shots/after/compare-phone.png) | ![](../../../../_claude/memory/docs/ui-review/shots/after/compare-desktop.png) |
| View → Design packs | ![](../../../../_claude/memory/docs/ui-review/shots/after/design-packs-phone.png) | ![](../../../../_claude/memory/docs/ui-review/shots/after/design-packs-desktop.png) |

Captured with `AXF_APPEARANCE_HUB=off AXF_UI_REVIEW_DIR=<demo> node framework/cli/rebuild-shots.mjs --shots
_claude/memory/docs/ui-review/shots/shots.json …` (views switched with `AXF.navigate` + the View dropdown).
