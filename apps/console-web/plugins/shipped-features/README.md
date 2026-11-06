# Shipped features

Every individual feature of AmberX-AXF and axHub in one sortable list, from the moment a build plans it to when it
went live, with every later change kept as an edit of that feature.

> Brett, Nov 4 2026: "Where's the list of features that can be sorted, and when they went live?" and (addendum)
> "As soon as a prompt goes through that plans on building the features, they go into that list, and have it sortable
> so you can hide completed ones and pending ones." "Anytime a feature in that list is getting changed or altered, it
> will appear as an edit."

Built on Opus because Fable had no credits; the contracts (build-hook@1, feature-ledger@1, deploy-log@1), this
plugin's listener and the SQLite schema were Fable-reviewed on Nov 6 2026 (`_claude/builds/reports/shipped-features.md`
→ Fable review: what was wrong and what changed).

## How data gets in

| Source | When | What it does |
| --- | --- | --- |
| build-hook@1 (`framework/core/build-hook.mjs`, `framework/cli/build-hooks.mjs`) | every builds store write, from any creator (vps.build_start, orchestrator add, pending_change add, Plan Studio "Turn into a build", hired agents, the reconciler) | `ledger/hook.mjs` → `ledger/apply.mjs`: a created build's steps become **Planned** features with his verbatim prompt, or Planned **edits** of features that already exist; status follows the build (Queued, Building, In PR, Merged, Cancelled) |
| merged PRs | `ledger.mjs sync` (last 300 first-parent commits) and `import` (all) | a PR with a build dates that build's features and edits (merged, merge commit); a PR without one becomes a feature or an edit |
| early commits | `import` | first-parent commits before the first PR, feature-like subjects only, confidence guessed |
| deploy log (deploy-log@1) | `sync` | `/opt/axf/.axf-console/deploys/log.jsonl`, written by `axf_deploy_log` in every deploy script; a feature is **Live** on a target from the first successful deploy that contains its merge commit. History before the log: guessed (~) from what each target runs now |
| `data/features-seed.json` | `import` (last) | the AI split of history into features; empty until a model pass fills it (`ledger.mjs seed-draft` writes its input) |

Matching an edit to a feature: `ledger/plan.mjs` `matchFeature`. Plain fallback (no model): same plugin / app scope
and repo, and the same name, or the build / PR text naming the feature, or a strong file overlap. A feature with no
scope only matches itself. `ctx.split` / `ctx.match` are where a model plugs in.

## Data

One SQLite file, `<data dir>/ledger.sqlite` (`AXF_SHIPPED_FEATURES_DIR`, default `.axf-console/plugins/shipped-features`),
`ledger/db.mjs` on `node:sqlite`. Migrations `ledger/migrations/NNN_*.sql`, version in `meta.schema_version`.
Tables: `features` (+ `feature_history`, every earlier version; the original is rev 1), `feature_builds` (feature ↔
build step), `edits` (feature_id, build, pr, commit, prompt, model, agent, session, status, timestamps), `prs`,
`builds`, `prompts`, `deploys`, `events_seen` (hook idempotency). Every record is the feature-ledger@1 shape.

## Page

Builds → Shipped features (`view:shipped-features`). Three levels: groups (View by PR, plugin, app, type, build, day,
repo, flat) → features (status chip, edited chip, dates) → details (what Brett said, builds, PRs, live per target,
model / agent, commit, files, the Edits timeline newest first, earlier versions). Quick filters: Hide completed, Hide
pending, Show cancelled, status chips (multi-select), Has edits, Being edited now, edit status; remembered per device.
CSV / Markdown export of what is shown. Menu badge: features building or in a PR plus features being edited.

## CLI

```bash
node apps/console-web/plugins/shipped-features/ledger/ledger.mjs import [--repo amberx-axf|axhub|all]
node apps/console-web/plugins/shipped-features/ledger/ledger.mjs sync | stats | list [--status s,s] | show <id> | export csv|md|json
node framework/cli/build-hooks.mjs listeners | tail | replay --to shipped-features
```

axHub history needs `AXF_AXHUB_REPO=<axHub checkout>` or `GITHUB_TOKEN`. axHub's own installer still has to call
`axf_deploy_log` for target `axhub` (that change belongs in the axHub repo).

## Tests

`node apps/console-web/plugins/shipped-features/test.mjs` (store, hook, importers, live) ·
`python3 apps/console-web/plugins/shipped-features/test.py` (server) · `node framework/spec/check-feature-ledger.mjs` ·
`node framework/spec/check-build-hook.mjs` · `bash framework/deploy/test.sh`.
