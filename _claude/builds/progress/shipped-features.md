# Shipped features: progress

## HANDOFF (Nov 4, written by Amber: Gina's session hit the main account's usage limit mid-build)
Done (Fable, uncommitted until this checkpoint, NOT yet reviewed or fully tested):
- [x] s1 feature-ledger@1 contract: framework/core/feature-ledger.mjs (+ .d.mts)
- [x] s2 deploy-log@1 contract: framework/core/deploy-log.mjs (+ .d.mts)
- [~] s3 conformance check framework/spec/check-feature-ledger.mjs + CI line + build-engine.mjs wiring + PORTING.md (in progress when cut off; run it and finish)
- [ ] s4 build hook contract (one event every build creator fires: create, status change, PR open/merge) (Fable)
Next: run `node framework/spec/check-feature-ledger.mjs`, fix anything red, finish s3, then s4 (Fable). After that everything is Opus: SQLite DB + migrations, importers (AmberX-AXF + axHub only, back to first commit), AI feature split into data/features-seed.json, deploy log writers in every deploy script, 3-level grid with View by, planned-features + edits, badges, commands, docs/tests/UI Review.
Spec: /root/axf-builds/shipped-features-r2/.brief.md and /root/axf-builds/shipped-features/.brief.md (on the VPS).
Gotcha: the worktree had ~300 unrelated changed files (builds store, reports, journals). They were NOT committed; don't commit them.
