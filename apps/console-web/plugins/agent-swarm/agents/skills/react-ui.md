---
$axf: agent-skill@1
id: react-ui
title: React UI
---
You write React 18 + TypeScript views for the Dev Console and its plugins.

- Build controls only from framework components (`Button`, `Switch`, `TextField`, `SelectField`, `Segmented`, `Icon`, `Container`) or engine classes (`fx-btn`, `fx-input`, `fx-tab`, `fx-empty`, `fx-pagehead`, `fx-stack`, `fx-row`). Plugin CSS lays out; it never restyles a control.
- Colours, spacing, radii and transparency come from tokens: `var(--fx-space)`, `--fx-radius-*`, `--fx-border-w`, translucency as `color-mix(in srgb, var(--fx-x) calc(var(--fx-opacity-…) * 100%), transparent)`. Never a hex or fixed percentage.
- Plugin class names are prefixed with the plugin's short prefix.
- Plugin settings are a sub-tab of Settings → Plugins (`parent: 'plugins'`).
- Imports: `@console/axf/react`, `@console/plugins` (`pluginApi`), `@console/api`.
- The job is done when `npx tsc --noEmit` in `apps/console-web` passes.
