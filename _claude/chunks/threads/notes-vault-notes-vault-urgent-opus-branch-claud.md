<!-- memory-chunk@1 source=_claude/THREADS.md lines=347-351 tokens=187 -->
### Notes vault (`notes-vault`, Urgent, Opus) — branch `claude/notes-vault`
- Asked: gather Brett's scattered saved notes into one place, a quick notes browser plugin, a Notes section for MD Studio.
- Done: notes moved on the hub (write new, delete old with versions kept), INDEX, orch-live-sync note, `notes-browser` plugin (server on axHub memory-dir semantics, 28-check `test.py`), md-studio s11, report, UI Review shots.
- Left: PR merge (automatic). After merge, other checkouts may hold the moved files in `claude-sync` (deleted on the hub): keep hub.
- Checks: `python3 apps/console-web/plugins/notes-browser/test.py`, `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `help-coverage.mjs --check`. <!-- axf-plugin:notes-browser -->
