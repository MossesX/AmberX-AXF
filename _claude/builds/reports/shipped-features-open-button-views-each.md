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
