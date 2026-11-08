<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/windows-terminal-fable.md lines=1-15 tokens=292 -->
# windows-terminal — Fable phase (window engine + settings levels)

Orchestrator build `windows-terminal` (Refactor profile), steps s6–s12 = refactor-all s17–s23, Fable, branch
`refactor-all/wt-s23b` (base commit `34238fed`, which already holds the Opus phase: Terminal plugin v0.3.0, see
[windows-terminal.md](windows-terminal.md)). Asked by Brett (Oct 28 2026): windows that resize from every edge, maximize,
snap like Windows, a frameless Terminal whose tab strip is its title bar; and every settings interface with a hideable
Simple / Basic / Developer / Administrator toolbar plus a level editor (rule "Every settings interface has a level
toolbar"). **apply-all-levels-fable s3 (settings-ui@1 levels review) is folded in** here: the levels engine was reviewed
and rebuilt by s20–s22, so that step is done by this build; its s1, s2 and s4 (look@1 fixture, banner Apply to all) are
not touched.

Commits: `a2c5f30e` s17 resize / maximize / frameless · `8926cb8b` s18 snapping · `0a6c193f` s19 lib-workspace on the
engine · `e8d1b0d3` s20 levels + visible sets · `3265d06c` s21 level toolbar · `ccc5cd76` s22 level editor · s23 (this
report) re-bake, shots, report.
