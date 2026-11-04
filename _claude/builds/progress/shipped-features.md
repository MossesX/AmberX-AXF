# Shipped features: progress

## HANDOFF (Nov 4, written by Amber: Gina's session hit the main account's usage limit mid-build)
Done (Fable, uncommitted until this checkpoint, NOT yet reviewed or fully tested):
- [x] s1 feature-ledger@1 contract: framework/core/feature-ledger.mjs (+ .d.mts)
- [x] s2 deploy-log@1 contract: framework/core/deploy-log.mjs (+ .d.mts)
- [~] s3 conformance check framework/spec/check-feature-ledger.mjs + CI line + build-engine.mjs wiring + PORTING.md (in progress when cut off; run it and finish)
- [ ] s4 build hook contract (one event every build creator fires: create, status change, PR open/merge) (Fable)
Next: run `node framework/spec/check-feature-ledger.mjs`, fix anything red, finish s3, then s4 (Fable). After that everything is Opus: SQLite DB + migrations, importers (AmberX-AXF + axHub only, back to first commit), AI feature split into data/features-seed.json, deploy log writers in every deploy script, 3-level grid with View by, planned-features + edits, badges, commands, docs/tests/UI Review.

## Nov 4 check-in (Opus session, stopped at the Fable gate)
- s3 is still red: `node framework/spec/check-feature-ledger.mjs` fails because `framework/spec/fixtures/feature-ledger.json` does not exist yet. The fixture is part of the feature-ledger@1 contract, so it stays with Fable.
- s3 and s4 need Fable; this account has no Fable credits right now. Nothing past s2 was changed.

## Steps after the foundation (Opus)
- [ ] s5 SQLite DB + migrations (features, edits tables)
- [ ] s6 importers (AmberX-AXF + axHub, back to first commit) + AI feature split into data/features-seed.json
- [ ] s7 deploy-log writers in every deploy script
- [ ] s8 3-level grid with View by
- [ ] s9 planned features on create: every build creator (vps.build_start, orchestrator add, pending_change add, Plan Studio "Turn into a build", helper taking a job) writes its planned features with Brett's verbatim prompt; steps become features (AI split, one-per-step fallback)
- [ ] s10 live status per feature: Planned, Queued, Building, In PR, Merged, Live (+ Cancelled, Removed), fed by the builds store, PRs and deploy log; cancelled builds keep features as Cancelled (hidden by default)
- [ ] s11 status column + chips at every level, sortable; quick filters Hide completed, Hide pending, status multi-select; remembered per device; group counts follow the filter
- [ ] s12 edits: edits table (feature_id, build, pr, commit, prompt, model, agent, session, status, timestamps); later work touching a feature adds an edit instead of a new feature (AI match, fallback = same files/plugin + build/PR naming it); backfill from history
- [ ] s13 edits UI: Edited chip with count + last edit date, Being edited, sort by last edited; Level 3 Edits timeline newest first (prompt, diff summary, links); original version kept in history; filters Has edits, Being edited now, edit status; hide completed/pending applies to edits
- [ ] s14 badges, commands
- [ ] s15 docs, tests, UI Review

Spec: /root/axf-builds/shipped-features-r2/.brief.md and /root/axf-builds/shipped-features/.brief.md (on the VPS).
Gotcha: the worktree had ~300 unrelated changed files (builds store, reports, journals). They were NOT committed; don't commit them.
