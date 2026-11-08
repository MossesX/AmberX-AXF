<!-- memory-chunk@1 source=_claude/memory/docs/codebase-changes.md tokens=132 -->
## What it does

Every time Claude is asked to build, edit, remove or fix something, an **entry** is opened with what was asked. Claude breaks
the work into **steps** and records them as it goes, then records the **result** (branch, commits, files changed, tests
before → after, links to the report / PR / run). Entries show in the **Codebase changes banner** on every console load
until each is **closed**; closing is stored in the entry, so it's gone on every device. The permanent log is under
**Builds → Codebase changes**.
