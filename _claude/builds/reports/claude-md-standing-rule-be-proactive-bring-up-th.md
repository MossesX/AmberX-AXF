# Build report: claude-md-standing-rule-be-proactive-bring-up-th

Branch `claude/claude-md-standing-rule-be-proactive-bring-up-th` · Phase 1, Opus · Nov 10 2026

## Brett said (verbatim)
> I can't believe I have to tell you half of the shit I do. I have to tell you what to do, and you're the one who has to tell me if I'm right or wrong. Put it in CLAUDE.md.

## What changed
Standing rule: without being asked, bring up the right/standard way, the known catches and the follow-ups, and do them as part of the work. Never wait for Brett to figure it out. Don't just agree with a plan: say plainly when it's wrong or missing something, with the fix.

| Where | Who reads it |
|---|---|
| `_claude/shared/rules/RULES.md` → How to work with him (full rule, Brett's quote) | every interactive session in every project (via CLAUDE.md and the hub's shared rules) |
| `CLAUDE.md` (short pointer next to "Fix it yourself") | every Claude Code session in AXF |
| `framework/schemas/rules-briefs.json` core brief (seed) | every headless build launch (orchestrator brief rules) |
| `apps/console-web/plugins/agent-swarm/web/swarm-core.mjs` `sharedPrefix` | every swarm / hired agent job (put it in report `notes`) |
| `_claude/memory/decisions.md` | decision record |

## Tests
- `node framework/spec/check-headless-context.mjs`: 39 checks, including a new check that the core brief carries the rule
- `node apps/console-web/plugins/agent-swarm/test.mjs`: 101 checks, including a new check that the shared prefix carries it

## Catches / follow-ups
- **Hub copy of the shared rules:** `_claude/shared/` reaches `/projects/_shared/_claude/` (claude.ai and other projects) on the next `claude-sync sync` from the main checkout after merge. I didn't sync from this feature worktree, because a three-way sync would publish unmerged branch state.
- **Live rules-briefs document:** no live `/projects/_shared/_data/claude/rules-briefs.json` exists on this VPS, so headless launches use the seed. If one is created later in Claude settings → Rules briefs, it replaces the seed, so the line must be in it too.
- **Agent-manager agents** (agent-definition@1, `contract.compose_system_prompt` plus the `framework/core/agents.ts` twin) don't get the rule yet. Adding a framework-wide line there is a cross-port contract change (Fable, fixtures), so it should be its own build.
- No UI and no API surface changed, so no UI Review or API reach applies.
