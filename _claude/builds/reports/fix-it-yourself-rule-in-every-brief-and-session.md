# Fix-it-yourself rule in every brief and session

Build `fix-it-yourself-rule-in-every-brief-and-session` · Phase 1 · Opus · Nov 10 2026

Brett said (Nov 10 2026 00:03): "From now on, you do whatever in your ability to fix any problem... just notify me of
doing it, not for permission or veto. Every single build, put that in the brief... anything that's doing anything will
be able to follow those rules."

## What shipped

The rule text lives in `_claude/shared/rules/fix-it-yourself.md` (copied from the hub's shared rules and updated with
the tool commands and where it is carried). Every surface that can act now carries it:

| Surface | Where | How it gets there |
|---|---|---|
| Every orchestrator brief (headless and pasted) | `FIX_RULE`, build-orchestrator `web/orchestrator-core.mjs` | New `Fix:` line after `API:` in `brief()` |
| Every brief-only headless session (pipeline, console launches, hired and swarm agents through `claude-headless.sh`) | Rules brief `fix-it-yourself` in `framework/schemas/rules-briefs.json` | Saved brief, `when: {}` (every launch), order 12 |
| Every swarm agent | agent-swarm `web/swarm-core.mjs` `sharedPrefix` WORK RULES | One line in the cached shared prefix |
| Console assistant and its agent profiles | ai-assistant `server/__init__.py` `FIX_RULE` | Added to the system prompt whenever the chat has tools |
| Full CLAUDE rules chain | `_claude/shared/rules/RULES.md` | The Oct 30 "Fix it yourself" bullet replaced by the Nov 9 version |

The rule: fix blockers within your permissions and keep going; never ask permission; one FYI line per attempt through
the fix-log tool (`fixlog.mjs found|trying|failed|fixed`, from PR #418); log each problem in AmberX Notes, list
"Automatic fixes" (one entry per problem, its checklist = every attempt); check that list first; only after everything
fails, report exactly what is missing (key, token, tool, MCP connection). Approval gates keep their own countdown.

## How it is reached (API)

No new UI. The rule text is readable and editable without a UI:
- Rules brief: Claude settings → Rules briefs (existing screen), `node framework/cli/rules-brief.mjs list|preview|compose`.
- Orchestrator line: `node apps/console-web/plugins/build-orchestrator/orchestrator.mjs brief <id>` (and the console
  / MCP brief routes that already return the phase brief).
- Fix logging: the fix-log plugin's REST / MCP `fix_log_log` / CLI (PR #418); Notes: `axf note add … --list "Automatic fixes"`, MCP `amberx_*`.

## Tests

- `framework/spec/check-headless-context.mjs`: 41 checks (new: the seed's rules brief carries the rule for headless,
  pipeline/Fable and swarm launches).
- `build-orchestrator/test.mjs` 33, `pipeline.test.mjs` 35: every brief has the `Fix:` line and the rule's key parts.
- `agent-swarm/test.mjs` 100: the shared prefix carries it.
- `ai-assistant/test.py` 205: assistant and agent profiles with tools get it, tool-less chats don't.
- Composed rules brief with every brief matching: 4.5K of the 9K cap.

## Notes

- Depends on PR #418 for `fixlog.mjs`; the commands use the `plugins/*/` glob so the framework never names the folder.
- The hub copy of `fix-it-yourself.md` and `RULES.md` update on the next `claude-sync sync` from main; not synced from
  this worktree.
- The core brief's older "Fix what is broken…" bullet was left as is to keep PR #418's edit of the same block
  conflict-free; the new brief supersedes it.
