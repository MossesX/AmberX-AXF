# Shipped features: Open button views each feature in the live app

Build `shipped-features-open-button-views-each` · Phase 1 · Opus.

Brett said (2026-11-15 14:55):
> I want the shipped features to have a button to open the feature, to view the feature in the live app.

## Plan (s1)

### Where a feature's console_show target comes from

A `feature@1` record (feature-ledger@1, `framework/core/feature-ledger.mjs`) has no screen field. Adding one is a schema
change (Fable), so the target is **derived** on the server from fields every record already has, and checked against the
console-control registry before it is offered:

| Order | Source on the record | Target |
|---|---|---|
| 1 | `plugin` (e.g. `ui-review`, 600+ live records have one) | the inventory plugin entry with that folder: its `view` address (`view:ui-review`), else its Settings sub-tab address |
| 2 | `files` under `apps/console-web/plugins/<folder>/` (the folder most files touch) | as 1 |
| 3 | `name` prefix before `:` ("Gate: …", "Plan Studio: …") | the inventory view or plugin whose label matches exactly |
| 4 | `app` equal to a view id | that view |

The registry is the console-control@1 static inventory (`apps/console-web/src/control/inventory.json`, read through the
console's `console_control.static_targets()` when the plugin runs in the console; the file directly otherwise). A
candidate address that is not in it is refused as `unknown-address`.

### Features with no screen

`openTarget(feature)` answers `{target, label, address}` or `{target: null, reason, code}`:

| code | when |
|---|---|
| `not-live` | status Planned, Queued, Building or In PR ("not landed yet") |
| `cancelled` / `removed` | status Cancelled / Removed |
| `not-console` | `app` is another app (amberx-droid, axhub-web, walkthrough-studio…) and nothing points into the console |
| `no-screen` | framework, infra, docs, tests…: nothing on the record names a screen |
| `unknown-address` | a candidate was found but the console-control registry doesn't know it (plugin removed or renamed) |

Merged counts as openable: the console runs main.

### Opening it

`POST …/features/{id}/open` runs console-control `focus` on the address (what `console_open` / `console_show` with an
address send), through the console's `console_control_api.run` (same guards and audit as REST); no console open answers
the same `unavailable` envelope with `openUrl`. No target: 409 with the reason.

### Surfaces

- REST: `GET features/{id}/open-target`, `POST features/{id}/open`, `GET features/find?q=` (fuzzy lookup by id, title, keywords).
- MCP / plugin-commands@1: `shipped-features_open`, `shipped-features_open_target` (declared in plugin.json, auto-registered).
- Console action `feature.open:<id or words>`; CLI `axf feature open|target <id|name>`; voice "open feature X" / "show me feature X".
- UI: `FeatureOpenButton` (framework Button) in an Open column on every grid row, plus a row context-menu item; deep link
  `view:shipped-features/grid:shipped-features/row:<id>/button:open` (console-control has no `action:` kind; `button:` is
  the address kind for a press) and `?shipped=<id>&open=1`.
- Gate: through a capability service `service:axf.shipped-features@1` (`openTarget(build)`), never the folder name.

### Gate "Pending features"

The Gate plugin has no Pending features tab on main yet (it is planned in build `build-rules-tab-gate-rules-vps-owns`,
not merged). This build adds the shared component and the capability service, and puts the button where Gate already
shows landed builds (History rows of lander merges), hidden-with-reason before landing. When the Pending features tab
lands it uses the same `GateFeatureOpen` component.

## What was built (s2–s14)

- **Resolver** `apps/console-web/plugins/shipped-features/server/open_target.py`: feature@1 → `{target, label, via}` or
  `{target: null, code, reason}`, checked against the console-control registry. On today's ledger (2,432 features):
  460 live / merged features open (251 by plugin, 200 by files, 9 by name), 329 have no screen, 25 point at a plugin the
  console no longer has (build-manager), the rest are not landed / cancelled / removed.
- **Fuzzy lookup** `find()`: id, exact title, title words, keywords (plugin, app, tags, builds, description); close
  matches come back as `alternatives` with `ambiguous: true`.
- **REST** (`/api/plugins/shipped-features/`): `GET features/{id}/open-target`, `POST features/{id}/open` (console-control
  `open` through the console's own runner: same guards and audit; 409 with `code`, `message` when it can't; `pending`
  when no console is open), `GET features/find?q=`, `GET features/open-target?feature=<id or words>`,
  `POST features/open {feature, to?}`, `GET features/open-targets` (every row), `GET builds/{build}/open-targets`.
- **MCP / plugin commands**: `shipped_features_open`, `shipped_features_open_target`, `shipped_features_find` (+ by-id and
  batch reads). Tool names can't hold a hyphen, so `shipped-features_open` from the brief is `shipped_features_open`.
- **Console action** `feature.open:<id or words>`.
- **CLI** `axf feature open|target|find <id or words>` (plugin `cli.mjs`, found by service `axf.shipped-features@1`;
  also `axf shipped-features open …`). Exit 3 = no screen (reason printed), 4 = no console open.
- **Voice** (wake-listener phrasebook): "open feature X", "show me feature X", "where is feature X". The reply is the
  route's `message`: "Opened Choices tab: UI Review." or "Status chips can't be opened: not landed yet."
- **UI** `web/FeatureOpenButton.tsx`: framework `Button` / `IconButton` in its own `role="toolbar"` with an aria-label,
  before the feature name in every grid row (so it's on screen on a phone), disabled with the reason as tooltip and
  `aria-description`; registers `button:open` under the row scope. Row context item **Open in app** (via
  `rt.contextExtras`, payload `feature:<id>`); the menu has no disabled entry, so with no target the item reads
  "Can't open in app: <reason>" and pressing it only says so.
- **Deep links**: `?shipped=<feature id>&open=1`; console-control
  `view:shipped-features/grid:shipped-features/row:<id>/button:open` (press / state). console-control has no `action:`
  kind (adding one is a contract change), so `button:open` is the address.
- **Gate**: waiting PRs and lander runs expand to their build's features (`web/BuildFeatures.tsx`) with the same Open
  button through the `feature.open` slot (never the folder name); before landing: disabled, "not landed yet". Reads
  `GET lander/waiting` / `GET lander/runs` (MCP `lander_waiting`, `lander_runs`) carry `features` with each target, via
  service `axf.shipped-features@1`.
- **Look**: setting `shipped-features.openButton` = `button` | `button-icon` (default) | `icon`; the three are UI Review
  choices, shipped as settings assets in `apps/console-web/plugins/shipped-features/assets/settings/`.

## Open / not done

- The Gate's **Pending features** tab doesn't exist yet (planned in `build-rules-tab-gate-rules-vps-owns`). This build
  adds what it needs: the `feature.open` slot component (`BuildFeatures`) and the `features` field on the reads.
- UI Review item `r-20261115-a909a832` (3 choices) is waiting for Brett.
- The DataGrid's row cells overflow the header on narrow widths (existing grid behaviour, not changed here).
- Kotlin / Android: no new Android work (UI only in the console web app).

## Tests

| Suite | Result |
|---|---|
| `python3 apps/console-web/plugins/shipped-features/test.py` (resolver, routes, find, service, CLI against a live server) | 67 pass |
| `node apps/console-web/plugins/shipped-features/test.mjs` | 10 pass |
| `python3 apps/console-web/plugins/gate/server/test_routes.py` · `node apps/console-web/plugins/gate/test.mjs` | 41 · 21 pass |
| `node apps/console-web/plugins/wake-listener/test.mjs` (voice intents) · `test.py` | 114 · 68 pass |
| check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control | pass |
| plugin-lifecycle check (shipped-features, gate, wake-listener), plugin-commands check, glossary `catalog.mjs --check` | pass |
| console `tsc --noEmit` + `vite build` | pass |

Screenshots: `rebuild-shots.mjs` with `AXF_APPEARANCE_HUB=off`, a copy of the live ledger and a scratch lander folder.
Phone captures hung on Playwright's font wait (offline), so a temp copy captured through CDP instead.
