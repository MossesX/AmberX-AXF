<!-- memory-chunk@1 source=_claude/memory/docs/token-log.md tokens=153 -->
## API runs (api-run@1)
`framework/core/api-run.mjs`, CLI `framework/cli/api-run.mjs`, store `/projects/_shared/_data/claude/api-runs/`. A launch with
`AXF_CLAUDE_AUTH=api` or a key in its environment waits; a waiter starts it once Brett approves in the console. Only his
signed-in session is accepted, sessions are refused, and nothing has a timer that lets a run through.

Open: no axHub approval path yet. An axHub tool needs its policy set to `confirm` first, or the default could put it on the
veto countdown. Mid-run failover to an API key is a separate step (s42) and doesn't pass through this gate yet.
