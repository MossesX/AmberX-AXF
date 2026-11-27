# plan-studio-collapse-all-expand-all

Brett (Nov 16 2026): "In the first Plan Studio, I need to collapse all."

## Outcome

The first Plan Studio (`plan-studio`, 1.0) was removed from main on Nov 21 2026 (build
`rip-out-plan-studio-1-keep-only-plan`; code archived at tag `archive/plan-studio-1`). Plan Studio 2.0 is the one Plan
Studio, and it already carries everything this build asked for:

| Ask | Where in Plan Studio 2.0 |
| --- | --- |
| Collapse all / Expand all on the toolbar | `assets/toolbar/plan-studio-2.json` buttons `collapse`, `expand` |
| Same by voice / MCP / CLI | actions `plan-studio-2.collapse-all`, `plan-studio-2.expand-all`; REST `POST /collapse`; voice "collapse all" |
| Remembered | the `collapsed` flag lives on each tree item on the hub |
| Layout switcher (nav, tabs, IDE) | `web/layout-core.mjs`, `web/layout.tsx`, action `plan-studio-2.layout` |
| IDE drag between panes, edge split, reorder, close / reopen | `layout-core.mjs` `moveTab`, `splitWith`, `reorder`, close / `reopen`; action `plan-studio-2.dock` |

The build branch's 1.0 changes were dropped when origin/main was merged (they edited files main had deleted). This PR
only updates the Plan Studio doc and adds this report.

## Checks

- `node apps/console-web/plugins/plan-studio-2/test.mjs`: 19 checks passed
- `node apps/console-web/plugins/plan-studio-2/toolbar.test.mjs`: 11 buttons wired (deep link, REST, MCP, CLI, voice)

## Note

Folded state is stored on the plan tree, not per signed-in user. With one owner that's the same thing; a per-user fold
overlay is open for later and can be added without changing the tree format.
