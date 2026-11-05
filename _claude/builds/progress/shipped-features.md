# Shipped features: progress

## HANDOFF (Nov 4, written by Amber: Gina's session hit the main account's usage limit mid-build)
Done (Fable, uncommitted until this checkpoint, NOT yet reviewed or fully tested):
- [x] s1 feature-ledger@1 contract: framework/core/feature-ledger.mjs (+ .d.mts)
- [x] s2 deploy-log@1 contract: framework/core/deploy-log.mjs (+ .d.mts)
- [x] s3 conformance check framework/spec/check-feature-ledger.mjs + CI line + build-engine.mjs wiring + PORTING.md (Opus, Fable redo): fixture generated, `mergeFeature` now folds a profile-less build ref into the same build with a profile; 58 checks green
- [x] s4 build hook contract (Opus, Fable redo): `framework/core/build-hook.mjs` (build-hook@1) derives events from every builds store change; `framework/cli/build-hooks.mjs` (outbox, plugin.json `buildHooks` listeners, detached delivery, journal replay) is fired from `saveStore`, so every creator is covered. Journal replay today: 2358 events. Check: `node framework/spec/check-build-hook.mjs`
Next: run `node framework/spec/check-feature-ledger.mjs`, fix anything red, finish s3, then s4 (Fable). After that everything is Opus: SQLite DB + migrations, importers (AmberX-AXF + axHub only, back to first commit), AI feature split into data/features-seed.json, deploy log writers in every deploy script, 3-level grid with View by, planned-features + edits, badges, commands, docs/tests/UI Review.

## REDO WITH FABLE (Brett, Nov 4 2026: "Finish it with opus redo fable later at note to redo with fable")
Every step from s3 on was built on Opus because this account had no Fable credits. Once Fable is available, run a
Fable review of s3 (fixture + build-ref merge fix), s4 (build hook contract) and the SQLite schema / migrations (s5,
s12), and rebuild only what it flags. Opus-built steps are marked (Opus, Fable redo) below.

## Nov 4 check-in (Opus session, stopped at the Fable gate)
- s3 is still red: `node framework/spec/check-feature-ledger.mjs` fails because `framework/spec/fixtures/feature-ledger.json` does not exist yet. The fixture is part of the feature-ledger@1 contract, so it stays with Fable.
- s3 and s4 need Fable; this account has no Fable credits right now. Nothing past s2 was changed.

## Steps after the foundation (Opus)
- [x] s5 SQLite DB + migrations (Opus, Fable redo): plugin `apps/console-web/plugins/shipped-features`, `ledger/db.mjs` (node:sqlite, WAL) + `ledger/migrations/001_init.sql`, `002_edits.sql`; features merge on write, feature_history keeps every earlier version, edits table drives editCount / beingEdited. Check: `node apps/console-web/plugins/shipped-features/test.mjs`
- [x] s6 importers (Opus): `ledger/importers.mjs` + CLI `ledger/ledger.mjs import|sync|list|show|export|stats|seed-draft`. Sources in order: builds journal (build-hook@1 replay), merged PRs (git merge / squash commits, GitHub API fallback), first-parent commits before the first PR, then `data/features-seed.json`. A PR with a build dates that build's features; one without becomes a feature or an edit of an existing one. axHub needs `AXF_AXHUB_REPO` (a checkout) or `GITHUB_TOKEN` on the VPS. The AI split is a seed file plus `seed-draft` (the input for a model pass); it is empty until a model fills it. Shallow test clone: 1854 features, 59 edits, 256 PRs.
- [x] s7 deploy-log writers (Opus): `axf_deploy_log` in `framework/deploy/axf-deploy.sh` (shell, no node), called by `deploy/install-console.sh` (target console) and `deploy/install.sh` (target site, sha from the site build commit); the update script exports `AXF_DEPLOY_WHO=update` and logs failed updates. Log: `/opt/axf/.axf-console/deploys/log.jsonl`. `ledger/live.mjs` turns it into live dates (git merge-base), with a guessed (~) backfill from what each target runs now. axHub's own installer lives in the axHub repo and still needs the same one-line call (follow-up there). Self-test: `bash framework/deploy/test.sh` (49).
- [x] s8 3-level grid with View by (Opus): `web/ui.tsx` on the framework DataGrid: groups (PR, plugin, app, type, build, day, repo, flat) → features → details (what Brett said, builds, PRs, live per target, model/agent, commit, files). Server `server/__init__.py` (GET ledger / feature/{id} / export, POST sync / import; reads SQLite read-only, writes through the Node CLI). Checked on desktop and phone with mocked data (`test.py` 9 checks; tsc clean; theme / controls / toolbars / plugin-pages checks clean).
- [x] s9 planned features on create (Opus): `ledger/hook.mjs` is the build-hook@1 listener; `ledger/apply.mjs` plans every step of a created build as a Planned feature (or a Planned edit of an existing one) with his verbatim prompt; `ledger/plan.mjs` splits steps (plain one-per-step fallback; `ctx.split` is the AI hook, not wired to a model yet) and skips housekeeping steps. Every creator is covered because they all write the builds store. Cancelled builds keep features as Cancelled. Journal backfill: 1634 features, 50 edits in ~5 s.
- [ ] s10 live status per feature: Planned, Queued, Building, In PR, Merged, Live (+ Cancelled, Removed), fed by the builds store, PRs and deploy log; cancelled builds keep features as Cancelled (hidden by default)
- [x] s11 status column + chips, sortable; quick filters Hide completed, Hide pending, Show cancelled, status multi-select chips, Has edits, Being edited now, edit status; remembered per device (localStorage `axp-shipped-features.view`); group counts follow the filter (Opus).
- [ ] s12 edits: edits table (feature_id, build, pr, commit, prompt, model, agent, session, status, timestamps); later work touching a feature adds an edit instead of a new feature (AI match, fallback = same files/plugin + build/PR naming it); backfill from history
- [x] s13 edits UI (Opus): Edited chip (count + last edit date) / Being edited chip, sort by Last edited; Level 3 Edits timeline newest first, each opens to its prompt, kind, build / PR / commit, model, agent, session, files; Earlier versions with the original kept.
- [ ] s14 badges, commands
- [ ] s15 docs, tests, UI Review

Spec: /root/axf-builds/shipped-features-r2/.brief.md and /root/axf-builds/shipped-features/.brief.md (on the VPS).
Gotcha: the worktree had ~300 unrelated changed files (builds store, reports, journals). They were NOT committed; don't commit them.
