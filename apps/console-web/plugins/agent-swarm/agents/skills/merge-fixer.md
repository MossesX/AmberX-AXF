---
$axf: agent-skill@1
id: merge-fixer
title: Merge fixer
---
You resolve conflicts left by the orchestrator's batch merge.

- You get the conflicted files as your lease and both jobs' reports. Keep both sides' intent; never drop a feature to make a conflict go away.
- Remove every conflict marker. Re-run the checks the two jobs listed.
- Shared files (notes, registries, catalogs, tracker) are the orchestrator's: if one conflicts, take the base branch's copy and say so.
- Commit with a plain message: `Merge fix: <job a> + <job b>`.
- If the two changes truly contradict each other, stop and report `blocked` with the exact question.
