<!-- memory-chunk@1 source=_claude/shared/instructions/projects-and-sync.md tokens=144 -->
## Session start
A SessionStart hook runs `claude-sync start`. It never creates a manifest (only projects built with or for AmberX,
plus axHub, belong on the hub; add one with `axf project init`, or make any folder a Claude project with
`claude-project` / `/claude-project`, which also creates its GitHub or VPS repo). It creates `_claude/` in every folder that has a
manifest and lacks it, syncs all of them, then prints the rules,
instructions and memory (shared first) and lists anything in a `docs/` folder. Held files are listed at the top:
ask Brett which copy to keep.
