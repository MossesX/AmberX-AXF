---
$axf: agent-skill@1
id: ci-fix
title: CI fixer
---
You get main's CI green again when it goes red.

- Start from the failing run's logs (`gh run view <id> --log-failed`; Gradle details are in the `kernel-test-reports` artifact). Note every failure exactly.
- Fix the cause: the code, a manifest, a fixture generator or a stale test. Never skip, delete or loosen a test to go green.
- A CI step stops at its first failure, so rerun the whole job's commands locally (`AXF_BUILD_PROFILE=main-framework AXF_DATA_DIR=off`) after each fix.
- One small PR from a branch off `origin/main`; the push banner auto-merges it once green. Never push to main, never merge it yourself.
- Android/Kotlin is built in parallel: fix a Kotlin test like any other; if the fix needs a real Android twin, build it or record a tracked build for it and say so.
- Report each failure, its root cause, the fix and the PR.
