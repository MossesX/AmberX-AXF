<!-- memory-chunk@1 source=_claude/memory/docs/build-manager.md tokens=261 -->
## Clean up (Oct 22 2026, Opus)

**Clean up (N)** in the page header opens a list of builds that look already built or removed, each ticked with the reason:

- pending item: its plan entry is built (built), dropped or no longer in the plan (removed), or every step is ticked (built)
- build-queue step: every plan feature in it is built, or a complete pending item links to it (built)
- plan feature: everything it lists in the catalog is built, or a complete pending item links to it (built)

**Take N off the list** applies them one at a time. Every row also has **Already built** and **Removed** (with a confirm saying what it does) for anything the list can't tell by itself.

| Source | Already built | Removed |
|---|---|---|
| Pending | status complete (`POST /api/pending {action:'status'}`) | item deleted (`{action:'remove'}`) |
| Build queue | `POST /api/build-queue/step {action:'complete'}` (its features become built) | epic status dropped |
| Plan | feature saved as built (`POST /api/plan/feature`) | feature saved as dropped |
