<!-- memory-chunk@1 source=_claude/THREADS.md lines=77-77 tokens=270 -->
## Active

| Thread | State | Branch | PR | Queued / next | Updated |
|---|
| What Brett said on every build (Current `build-prompt-origin`, Opus, agent Janitor Joey; Brett Nov 3 voice: "I need it to show the prompt, what I said, the verbatim prompt that kicked it off"): build-origin@1 (`origin` on every build: verbatim `said`, at, source, session/link, by, brief, addenda) in the builds store + `_claude/builds/origins.json` sidecar, never lost on merge; launcher parses the brief's `## Brett said (verbatim)` block; orchestrator add / `pending_change` / Plan Studio take `said`; "What Brett said" block + subtitle in Build manager, Builds page, Pending, Orchestrator, UI Review; 136 builds backfilled (marked may be paraphrased) | review (all 5 steps done; PR open, waits for UI Review r-20261103-786e50e7) | `claude/build-prompt-origin` | [#282](https://github.com/MossesX/AmberX-AXF/pull/282) | Report `_claude/builds/reports/build-prompt-origin.md`. Not wired yet: Build queue, Build Breaker, What's New, Crew, Session browser, PR rows (`OriginFor` ready) | 2026-11-03 |
