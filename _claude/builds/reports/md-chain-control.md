# Report: md-chain-control (headless-session-efficiency-shared-chain-control)

Built on `claude/md-chain-control`, on top of `claude/token-optimize` (PR #360) and the unpushed `claude/headless-progress-lean-chain` commits (progress file). Design and commands: `_claude/memory/docs/chain-control.md`.

## Savings test
Same three small steps, real Claude, Opus, scratch folders, token log (`chain-control.mjs compare`). Each step takes 3 to 5 turns.

| Run | Sessions | Turns | Context at session start | Cost (Claude's own total) | Cost (token log) |
|---|---|---|---|---|---|
| Full chain, one session | 1 | 3 | 68,512 | $0.52 | $0.33 |
| Lean chain, one session | 1 | 4 | 33,307 | $0.24 | $0.15 |
| Lean chain, fresh session per step | 3 | 10 | 33,586 | $0.64 | $0.39 |

- The lean chain halves the start of every session (-51%) and costs 54% less on this build.
- A fresh session per step cost **more** here: +23% on Claude's totals against the full chain, and more than double the lean single session. Each one writes about 20,000 tokens of tools and system prompt to a cold cache, roughly $0.10.
- Why that can still pay: carried history costs $0.20 per million tokens per turn on Opus, so $0.10 buys back 500,000 token-turns (for example 10,000 tokens of history over 50 turns). Real steps often pass that; these toy ones can't. This test doesn't measure that case.
- About 33,000 tokens remain at start with no chain: tools and Claude Code's own system prompt.

The two cost columns differ because Claude's total includes work the turn log doesn't see. Compare within a column.

## Open
- **Decided (Brett, Nov 6 2026):** `per-build` is the default, so a build runs in one session. `per-step` stays as an option.
- Model rules only say Opus or Fable: the item's Haiku/Sonnet wording is overridden by the model policy.
- File scoping is an instruction in the prompt, not enforced.
- The live launcher in /opt/axf picks this up only after merge.
