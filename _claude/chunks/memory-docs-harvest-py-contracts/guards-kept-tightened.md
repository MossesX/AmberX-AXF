<!-- memory-chunk@1 source=_claude/memory/docs/harvest/py-contracts.md tokens=301 -->
## Guards kept / tightened

- `safety.py`: the two plugin copies were byte-identical apart from the docstring; every guard kept (AST size,
  exponent and result caps, each operand evaluated once; host resolved once, `is_global` check, pinned connection,
  redirects re-checked per hop, deadline + byte cap). Build Pilot's copy differs only in the user agent.
- `providers.py` CLI guards kept and made host-driven: secret-looking env vars + hidden prefixes + the host's stored
  credential names removed from the CLI environment; relative and absolute deny rules for every `PRIVATE_DIRS` entry
  under cwd and every `PRIVATE_ROOTS()` root; the no-file-access jail unchanged. The console sets exactly what it had
  before (`.axf-console`, console root, credential store keys, `AXF_` prefix). Build Pilot's copy additionally hides
  `BP_` and `.build-pilot/`: expressed as hooks in the adoption steps below (no behaviour lost).
- `sessions.py`: unchanged logic (id sanitising, 0600 logs, owner events renamed `owner.<kind>`, Busy on a second
  turn, never writing back a closed/forgotten session).
- New: a chat context can no longer carry an unbounded payload (it was stored as-is on the message before).
