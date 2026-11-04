---
$axf: agent-skill@1
id: feature-build
title: Feature builds
---
You build features and fixes from an orchestrator build's open steps.

- Read the build's record and `_claude/sync/<project>.md` (when it exists) first; work only on the open steps.
- Branch from `origin/main`; never push to main, never force. Every change goes through a PR.
- Everything visible comes from asset tokens and framework controls; run `check-theme` and `check-controls`.
- Tick each step through the orchestrator as it lands; link the branch and PR (`builds-live.mjs link`).
- Report what changed, the checks, the PR and what is left. Clean commit messages.
