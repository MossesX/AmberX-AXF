# Reset all button for every asset override in Appearance

Build `reset-all-button-every-asset-override`. Brett (Nov 16 2026): "I want to reset all, all. Button."

## Plan (s1)

### What `chrome.reset:<type>:<instance>` clears today

`framework/react/components/ChromeContext.tsx`, `installChrome`:

| Key | Meaning | Cleared by chrome.reset |
| --- | --- | --- |
| `axf.chrome.<type>.<instance>` | field overrides over the active asset (CHROME_FIELDS) | yes |
| `axf.chrome.<type>.<instance>.asset` | the asset a tab group picked for itself | yes |
| `axf.chrome.<type>.<instance>.interface` | the settings interface that instance picked | yes |
| `axf.tokens.instances` entry `tabs.<instance>` | component-tokens@1 values of that tab row | **no** |

Undo: none. `chrome.reset` clears the keys one `settings.clear` at a time (three change events, three
`onAnyChange` calls) and keeps nothing to restore from. The per-row `Reset all` button in AssetsWithEdits is the
same action for one row.

Where the keys live: `axf.chrome.*` is not an appearance setting (`isAppearanceSetting` prefixes), so it is
device-local (localStorage via SettingsRegistry). `axf.tokens.instances` is an `axf.tokens.*` key, so it rides the
axHub look and reaches every app.

The "N assets are controlled by their own settings" count is `chromeOverrideList(saved)`: only instances with at
least one valid field override; picks (`.asset`, `.interface`) and tokens are not counted.

### What this build adds

1. **Engine** (`chrome-settings-rules.mjs`, pure):
   - `listOverriddenAssets(saved)` → `[{ type, instance, fields, asset?, interface?, tokens? }]`: every instance with
     a field override, an own asset pick, an own interface pick, or own tab-row tokens.
   - `resetAllPlan(saved)` → `{ ids, clear: [keys], set: { key: value }, snapshot: { key: value|null } }`: every key
     chrome.reset clears for every overridden asset, plus the `tabs.*` entries dropped from `axf.tokens.instances`;
     `snapshot` holds the before-value of every touched key so undo restores it exactly.
   - `undoResetAllPlan(snapshot)` → the same `{ clear, set }` shape back.
2. **Settings batch**: `SettingsRegistry.batch(writes)` — one storage write, one `changed()`; watchers fire per key
   (so the appearance push and editors still see each key) but listeners re-render once.
3. **Runtime action** `chrome.reset-all` (+ `chrome.reset-all-undo:<undoId>`, `chrome.overrides`), with `resetAll(rt)`
   / `undoResetAll(rt, id)` exported next to the per-asset reset. The last snapshots are kept under
   `axf.chrome.reset-all.undo` (device-local, max 5) keyed by `undoId`.
4. **UI**: AssetsWithEdits header becomes a `role="toolbar"` row with the count button and a destructive
   `Reset all` (confirm names N), `data-axf-target="setting:appearance/asset-overrides/reset-all"`; after a reset,
   one toast and an inline Undo.
5. **API**: console actions (inventory regenerated), theme-manager REST routes relayed to the open console through
   console-control, MCP through plugin-commands, CLI `chrome-settings.mjs overrides | reset-all --confirm | undo <id>`,
   voice phrase "reset all asset overrides".
