<!-- memory-chunk@1 source=_claude/memory/docs/chain-control.md lines=19-21 tokens=72 -->
## Levels
Global config < build override < step override. A preset replaces the global config and leaves overrides alone. Live store: `/projects/_shared/_data/claude/chain-control.json`, history next to it (`-history.jsonl`, the change events; `-files/` keeps replaced chain file text).
