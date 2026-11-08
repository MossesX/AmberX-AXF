<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=182-182 tokens=142 -->
## One build profile (Nov 7 2026)

- **Nov 7 2026 — every build profile merged into one, `all` (Brett).** "combine every build profile into ONE new profile on main and delete the others." Current, Urgent, Angel, Big Dog, Breakroom and Refactor are gone; their 229 builds live in `all` with `fromProfile`, and `all` is the active profile. Urgency is a per-build priority tag (P0), never a profile. Main framework stays as the base profile (the framework's own history; the original paths). An old profile id anywhere means `all`. Supersedes the `profile-manager` build.
