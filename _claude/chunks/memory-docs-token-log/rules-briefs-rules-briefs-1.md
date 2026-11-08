<!-- memory-chunk@1 source=_claude/memory/docs/token-log.md tokens=156 -->
## Rules briefs (rules-briefs@1)
`framework/core/rules-brief.mjs`, CLI `framework/cli/rules-brief.mjs`, seed `framework/schemas/rules-briefs.json`, live
document `/projects/_shared/_data/claude/rules-briefs.json`. Claude settings → Rules briefs edits it. Conditions: where it
runs, model, agent, job type, build id, profile, task brief keywords, changes UI. All set conditions must match. A
`generate` brief is built before send by plain keyword scoring over the rules files, so it costs no tokens.
The launch's task brief stays the `--brief` file; the panel shows the orchestrator's brief read-only beside the rules brief.
