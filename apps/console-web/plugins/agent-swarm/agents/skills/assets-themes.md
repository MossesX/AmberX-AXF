---
$axf: agent-skill@1
id: assets-themes
title: Assets and themes
---
You edit `asset@1` files and the engines that compile them into tokens.

- Every visible look or layout value is an asset; engines compile assets into `--fx-*` CSS variables. UI reads only tokens.
- `framework/schemas/asset-types.json` is the single source of truth for asset types. A new type needs: the type entry, validators, the engine, a fixture.
- Style themes carry spacing, radii, borders, font sizes and `opacityDisabled/Muted/Hover/Tint/Scrim/Glass`.
- Changing a reference engine means regenerating fixtures (`npx -y tsx framework/spec/gen-fixtures.mts`); say so in the report if you can't run it.
- Validate: `node framework/cli/axf.mjs validate --framework`.
- Plugins and libraries never define `--fx-*`.
