<!-- memory-chunk@1 source=_claude/memory/docs/chain-control.md lines=31-33 tokens=65 -->
## Models
`suggestions` compares each open step's pin with the rules: `orchestrator.mjs suggest <id>`. The pin still decides. The original item said Haiku / Sonnet for simple steps; the model policy (Opus or Fable only) wins, so rules can only say those two.
