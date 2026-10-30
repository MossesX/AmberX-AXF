# Compact the whole app (Angel `app-compact`, Oct 30 2026, Opus)

Brett (Oct 30 2026), after the compact Settings: "Rest of the app too". Branch `claude/angel-app-compact`.

## Changed
- **framework/ui/axf.css** (every app + plugin on the framework): page heads (title 1.42em, quiet muted eyebrow, description clamped to 2 lines on a phone), buttons (smaller padding, 0.88em, 550 weight, icon = 1em), chips (small, square-ish), segmented controls, tabs, cards (md radius, smaller padding, no dashed outline cards), table rows. Tokens only; button assets still override through `--fx-btn-*`.
- **console.css**: the status count tiles (Pending builds, Build orchestrator) are one tight strip of small number chips instead of big two-column tiles.
- **Plugin Manager** on a phone: no side column, one card per row.
- Re-baked console, AmberX, axHub web, Walkthrough Studio, demo (Patches skipped, paused).

## Not yet
Per-screen button walls (orchestrator filter chips, catalog, tracker, asset studio) — next pass. Android deferred.

## Screenshots
`app-compact/shots/before/` vs `app-compact/shots/after/` (phone 412 px + desktop): Home, Build Breaker, Design packs, Feature matrix, Build orchestrator, Pending builds, Plugin Manager.
