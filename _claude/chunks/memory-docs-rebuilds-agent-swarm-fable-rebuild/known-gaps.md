<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-swarm-fable-rebuild.md tokens=146 -->
## Known gaps
- No before/after screenshots: the Breakroom cannot render without axHub in this sandbox (see Screenshots); the screens
  are pixel identical by construction (same SVG paths, same classes, same tokens).
- The zero-score fallback still needs a roster `fallback` to be meaningful on this repo (none set): until then an
  unmatched step goes to the agent with the largest budget (Kotlin Kat), with the "name files in the step" warning.
- `stepFiles` still takes a bare file name in step text (e.g. `LOG.md`) as a repo-root lease.
- Kotlin twins deferred (Android on hold).
