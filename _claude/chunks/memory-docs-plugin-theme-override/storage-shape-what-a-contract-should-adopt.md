<!-- memory-chunk@1 source=_claude/memory/docs/plugin-theme-override.md tokens=285 -->
## Storage shape (what a contract should adopt)

One setting per plugin, only what the person changed:

```json
axf.plugin.<pluginId>.look = {
  "on": true,
  "tokens": { "--fx-space": "10px", "--fx-accent": "var(--fx-info)", "--fx-motion": "240ms" }
}
```

- `pluginId` = plugin.json `id` (`/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/`). No setting = off, nothing changed (a reset to
  nothing removes the setting).
- `tokens` keys are theme variables from the open registry `PLUGIN_THEME_TOKENS` (layout: space, card / tab padding,
  row height; colour: every colour-theme colour; style: fonts, text size, heading weight / tracking, radii, border width,
  shadows, blur, the six opacities; animation: motion duration, easing). Values are CSS text, checked per kind:
  lengths / numbers / times clamped and snapped (`12px`, `0.6`, `240ms`; `calc(…)` and `var(--fx-…)` allowed), colours
  as hex / rgb / hsl / color-mix / `var(--fx-<colour>)` (a reference follows a colour-theme swap), choices as safe text.
  Anything with `; { } < > \ @ url(` is dropped.
- Last save wins (one key per plugin); every editor re-reads on focus (`useEditorSync`).
