<!-- memory-chunk@1 source=_claude/memory/docs/build-steps.md lines=85-90 tokens=80 -->
## Artifact sync

The claude.ai Pending Builds page mirrors `subPrompts` (with `estimate`, `done`, `doneAt` as epoch ms) and `estimate`
per item. The per-item payload to push is in the session scratch file `artifact-sync.json` (produced by the split
run; regenerate with `toArtifact` from `pending-core.mjs` if needed).
