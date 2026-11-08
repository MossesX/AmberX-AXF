<!-- memory-chunk@1 source=_claude/memory/docs/build-reporting.md lines=1-11 tokens=200 -->
# Reporting builds to the Build manager (every session, every machine)

Rule (Oct 21 2026, Brett; `_claude/shared/rules/RULES.md` → "Report every build to axHub"): before any session builds,
edits, removes or fixes something, it records it on axHub, keeps it live while it works, and finishes it. The console's
**Build manager** (Live + Built) and **Codebase changes** log read the same files. <!-- axf-plugin:codebase-changes -->

**Where:** one JSON file per build, `changes/<YYYY>/<MM>/<id>.json` in AmberX-AXF's shared data on axHub
(`/projects/amberx-axf/_data/changes/…`). Through the hub tools that is `axhub.memory_write` with
`project: "amberx-axf"`, `area: "data"`, `path: "changes/2026/10/chg-20261021-1a2b3c4d5e.json"`. Same file for every
project (the build's own repo goes in `repos`).
