# Builds journal fixture (builds-journal@1)

A three-line journal (`2026-11.jsonl`) for CI: the real journal lives on the hub data store
(`/projects/amberx-axf/_data/builds/journal`, `_claude/builds/journal.json` is the pointer), so checks read this
folder through `AXF_BUILDS_JOURNAL` instead of the 70 MB parts. Hand-written, not generated: build
`journal-fixture` is added (rev 1), its step s2 is ticked (rev 2), and another build is added (rev 3).
