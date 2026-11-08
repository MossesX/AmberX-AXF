<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=226-226 tokens=90 -->
## xLayout host in Molly (Nov 3 2026, xlayout s4–s12, Opus; branch `claude/xlayout-opus`)

- **Toolbars** (`web/toolbars.tsx`): the three xlayout slots on any edge (show / hide, items with open targets; slot 1 also carries the app on screen's toolbars) and `declareToolbars` for other Molly plugins (three per plugin and screen). <!-- axf-plugin:xlayout -->
