<!-- memory-chunk@1 source=_claude/memory/docs/voice-command-center.md tokens=78 -->
## Runner (`runner.ts`)
Confirm setting first; asks out loud for wizard slots (cancel / back / repeat / skip); a step that uses a skipped slot is skipped; op/intent failures stop the chain and say why; `run` nests up to 4 deep. Developer commands need Molly reachable, AI commands need the AI on and answering.
