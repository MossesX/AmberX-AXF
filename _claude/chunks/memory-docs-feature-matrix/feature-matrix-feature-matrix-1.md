<!-- memory-chunk@1 source=_claude/memory/docs/feature-matrix.md tokens=236 -->
# Feature matrix (feature-matrix@1)

Brett, Oct 28 2026: every build gets a keep/skip **feature matrix** like the windows-terminal scope list. Items are
grouped, each with its time cost, its model and why it is there; tick = keep, untick = skip; items can be added at any
time and are **never deleted** ("remove" = skip; a skipped item stays in the matrix and is skipped when the build runs).
All matrices are **one dataset**, shown as a grid of expandable rows (row = build; columns include date added and the
time cost of the kept items). Editing a matrix lights an **Apply** button; Apply pushes the result to every table the
build lives in. Every builds grid gets a hook to its entry's matrix. Orchestrator build `feature-matrix` (Refactor profile).
<!-- axf-plugin:feature-matrix -->

Fable phase (s1–s2, branch `fable/feature-matrix`) built the contract and the Apply engine. Opus phase (s3–s8) builds
the console plugin on top of them.
