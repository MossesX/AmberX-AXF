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

## Shipped manifests (shipped-manifest@1)

When a build lands, the orchestrator's tick (`pipeline.mjs`, after-tick hook) gathers its manifest with
`framework/cli/shipped.mjs`: Brett's verbatim prompt and the full brief, models and accounts, steps with estimates and
actual times, branch, PR, landed commit, the branch's own commits and files (by area), tests and open items from the
report, UI Review items, cost and tokens from the session meters. It is written to `_claude/builds/shipped/<build>.json`
and its ref goes on the build record through the builds store, so build-hook@1 fires `shipped` and the ledger applies
it (`ledger/manifest.mjs`): the build's features move to Merged with the commit, PR, files, model and report; a build
that planned none gets one. The `sync` also takes any sidecar the ledger hasn't seen. Each entry shows the manifest
(prompt highlighted, collapsible sections).

API (also MCP, axHub, `axf control`, voice through plugin-commands@1): `GET /search?q=`, `GET /manifests`,
`GET /manifest/{build}`, `POST /manifest` (partial manifest; given fields win), `POST /ship/{build}`, `POST /link`,
`POST /backfill {since, dry}`. Deep link: `?shipped=<build or feature id>`; action `shipped-features.show <id>`.

```bash
node framework/cli/shipped.mjs gather <build> | ship <build> [--manifest-file f|-] | show <build> | list [--q text]
node framework/cli/shipped.mjs backfill --since 2026-11-08 [--dry]   # landed builds with no manifest
node apps/console-web/plugins/shipped-features/ledger/ledger.mjs search <text> | manifests | manifest <build>
```

## Open a feature in the app

Every row has an **Open** button (`web/FeatureOpenButton.tsx`, one shared component) and an **Open in app** row context
item: it opens the feature's screen, tab or Settings page in the live console. Where it opens is worked out on the
server (`server/open_target.py`) from the record's plugin, files, the name's "Area:" prefix and app, and checked against
the console-control registry (the console's inventory). A feature that can't open says why, and the button is disabled
with that reason as its tooltip: `not-live` ("not landed yet"), `cancelled`, `removed`, `no-screen` (framework, tooling,
docs, or another app) or `unknown-address` (its screen is gone). Merged features open (the console runs main).

| Surface | How |
|---|---|
| REST | `GET features/{id}/open-target` · `POST features/{id}/open` (409 + reason when it can't) · `GET features/find?q=` · `GET features/open-target?feature=<id or words>` · `POST features/open {feature, to?}` · `GET features/open-targets` (every row) · `GET builds/{build}/open-targets` |
| MCP | `shipped_features_open`, `shipped_features_open_target`, `shipped_features_find` (plugin-commands@1) |
| Console action | `feature.open:<id or words>` |
| CLI | `axf feature open|target|find <id or words>` (`cli.mjs`; exit 3 = no screen, with the reason) |
| Voice | "open feature X", "show me feature X", "where is feature X" (wake-listener phrasebook); the reply names the screen or the reason |
| Deep link | `?shipped=<feature id>&open=1` · console-control `view:shipped-features/grid:shipped-features/row:<id>/button:open` (press / state) |
| Other plugins | slot `feature.open` (props `{build, landed}`) draws a build's features with their Open buttons; service `axf.shipped-features@1` (`open_target`, `open_targets_for_build`, `open`) on the server |

The button's look is the setting `shipped-features.openButton` (`button`, `button-icon` default, `icon`), a UI Review
choice shipped as settings assets in `assets/settings/`.

## Tests

`node apps/console-web/plugins/shipped-features/test.mjs` (store, hook, importers, live) ·
`python3 apps/console-web/plugins/shipped-features/test.py` (server, open targets, find, the CLI against a live server) · `node framework/spec/check-feature-ledger.mjs` ·
`node framework/spec/check-build-hook.mjs` · `node framework/spec/check-shipped-manifest.mjs` · `bash framework/deploy/test.sh`.
