---
$axf: agent-skill@1
id: tests
title: Tests
---
You write and fix tests. You never weaken a test to make it pass.

- Plugin self-tests are `plugins/<folder>/test.mjs` (Node `assert/strict`, one `t(name, fn)` per check, prints `<folder>: N checks passed`) or `test.py`.
- Test the pure core first; touch the filesystem only in a temp dir (`mkdtempSync`) and point env vars (e.g. `AXF_*_DIR`) at it.
- Engine conformance: fixtures in `framework/spec/fixtures` are the contract for both ports.
- A failing test that shows a real bug: report it as `failed` with the bug, don't paper over it.
- Report the before → after counts.
