<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal-fable.md tokens=111 -->
## Migrations

- **Pro → Administrator, Advanced → Developer:** `settingsLevelOf` migrates in assets (`settings` asset levels and group
  levels), in saved picks (`axf.settings.level`) and in visible sets. Nothing to run; old values map on read.
- Saved window layouts without `frame` / `maximized` load as standard, not maximized.
- lib-workspace floats without `maximized` / `restore` load as before; `FLOAT_MIN` applies on the next resize.
