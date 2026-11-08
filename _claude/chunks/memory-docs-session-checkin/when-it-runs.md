<!-- memory-chunk@1 source=_claude/memory/docs/session-checkin.md lines=11-23 tokens=224 -->
## When it runs

| Client | Trigger |
| --- | --- |
| Claude Code (VPS over mosh, desktop, laptop) | `SessionStart` hook, `matcher: "startup"` (a new session only; not resume, clear or compact) |
| Claude Code on the web / phone (cloud container) | same hook (the repo's `.claude/settings.json` travels with the clone) |
| claude.ai chat / Project | a rule in `memory/RULES.md`: on the first message of a new conversation, run the check-in before answering |
| Unattended runs (`claude -p`, scheduled tasks, no one to ask) | ask nothing; use the detected values and the last archived answers for that location; log the run as `unattended` |

Words that skip or shorten the check-in:
- **"skip":** no questions. Log the session with `skipped: true` and whatever was detected.
- **"same as last":** reuse the last archived answers for this location. Show them in one line and still run the checks.
