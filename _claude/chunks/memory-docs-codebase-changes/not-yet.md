<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md lines=147-152 tokens=91 -->
## Not yet

- No Android twin (all Android work is on hold).
- The model comes from the transcript (first assistant message) or `AXF_MODEL` / `ANTHROPIC_MODEL`; sessions can set it with `update --model`.
- axHub's `/data-events` watches single documents, not a folder: the console watches the shared folder it mounts instead (follow-up for axHub: a prefix watch).
