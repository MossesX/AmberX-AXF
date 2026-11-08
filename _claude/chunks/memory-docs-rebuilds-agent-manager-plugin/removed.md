<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-manager-plugin.md tokens=134 -->
## Removed
- The Opus plugin folder (every file), through its own uninstall (`uninstall.mjs --all`, no `--publish`), then rebuilt in the same folder.
- Duplicated validation logic in `server/__init__.py` (`_validate`), `toolkit.validate`, `training.validate`, the ad-hoc `_fill`/regex helpers in `engine.py`/`toolkit.py`, and the risk-stripping copies in `addons.py`/`library.py` — all replaced by the contract.
- Nothing user-visible was removed. Every route, action, dialog, settings key and data file of the Opus build still exists.
