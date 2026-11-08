<!-- memory-chunk@1 source=_claude/memory/docs/harvest/deploy-misc.md lines=79-91 tokens=274 -->
## Contracts, fixtures, assets

- New starter `uac-policy/hub-accounts` (roles admin `*`, themes `assets.swap`+`assets.import`, user none; defaultRole
  user, gating disable, `roll: false`). Permission names are the framework's standard six (no console-only names);
  the hub permission that maps to `themes` is per app (`<app>.themes`, e.g. `console.themes`) and lives in the server,
  not the asset. `framework/defaults.json` unchanged (`standard`), so every existing app looks and behaves the same.
- `spec/fixtures/uac.json` gained the `hub-accounts` case only (generated; existing cases byte-identical). Kotlin
  `ConformanceTest` replays it from `framework/assets` (no Kotlin change; CI runs it).
- The console keeps `console-access` (identical roles + permission set, console wording): no behaviour change.
  Note in `apps/console-web/src/account.tsx` points at the starter.
- Engine: `copyTemplate` now substitutes `{{TOKENS}}` in `.sh`, `.py`, `.yml/.yaml` and `Dockerfile` and maps
  `_dockerignore` → `.dockerignore`. No existing template has such files, so their output is unchanged.
