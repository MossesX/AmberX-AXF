# Acceptance: Brett's words, clause by clause

> "I don't want drop-down bars anymore. They are gonna be animated. It's gonna be a row with a name and a little arrow;
> when you press that arrow it expands a subgrid; you got to press it again to apply it and close it."

| Clause | Delivered | Proof |
|---|---|---|
| "I don't want drop-down bars anymore" | `SelectField` draws the expander picker; every pick-one setting in Settings, "Acting as" and the window settings dialog migrated; `check-dropdowns.mjs` fails CI on any new raw `<select>` (230 older ones held at a baseline that only goes down) | `node framework/cli/check-dropdowns.mjs` |
| "They are gonna be animated" | The grid unfolds 0fr → 1fr over `--fx-pick-dur` (the motion token): measured in Chromium 0 → 6 → 67 → 106 px over 256 ms; reduced motion: instant | `acceptance-motion.json`, `shots/anim-unfold-mid-desktop.png` |
| "a row with a name and a little arrow" | Collapsed: one row, setting name left, current value right, arrow last; read as "name, value" | DOM check s3 block; `shots/opt-*--collapsed-*.png` |
| "press that arrow it expands a subgrid" | The row or the arrow opens a grid of option tiles in place; content below moves down by the grid height (107 px measured), nothing is positioned | DOM check s4 block; `acceptance-motion.json` (`belowMovedBy`, `position: static`) |
| "press it again to apply it and close it" | One press highlights (+ preview); the same option again, or the arrow again, applies and closes; Escape closes without applying | DOM check s5 / s6 blocks; console-control `set` / `press` do the same without the UI |
