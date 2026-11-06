# Chain control (chain-control@1)

One registry for how a headless session is set up. Build `headless-session-efficiency-shared-chain-control`, Nov 6 2026.

| Part | Where |
|---|---|
| Rules, pure | `framework/core/chain-control.mjs` |
| Chain discovery | `framework/core/memory-chain.mjs` (moved from `deploy/claude-meter.mjs`) |
| Seed + presets | `framework/schemas/chain-control.json` |
| Store + CLI | `framework/cli/chain-control.mjs` |
| API | `apps/console-web/server/chain_control.py`, `/api/chain-control` |
| MCP | `chain_control_get`, `_suggestions_list`, `_savings_get`, `_set`, `_file`, `_preset` |
| Shared panel | `apps/console-web/src/chainControl.tsx`, mounted by Claude settings and MD Studio |
| Launcher | `deploy/claude-headless.sh` (`chain_plan`), `deploy/claude-stream.mjs` (budget) |
| Checks | `framework/spec/check-chain-control.mjs`, `apps/console-web/server/test_chain_control.py` |

The API and panel belong to the console, not to a plugin, so the registry keeps working when either plugin is off.

## Levels
Global config < build override < step override. A preset replaces the global config and leaves overrides alone. Live store: `/projects/_shared/_data/claude/chain-control.json`, history next to it (`-history.jsonl`, the change events; `-files/` keeps replaced chain file text).

## What a launch does
Before each session the launcher runs `chain-control.mjs plan`:
- **Chain:** `always` files go in the system prompt, `demand` files are named, `never` files are left out. Every file `always` in load order means Claude Code loads its own chain. If no rules at all would reach the run, it loads its own chain too: never rules-free.
- **Sessions:** `per-build` (the default, Brett, Nov 6 2026) runs one session for the whole build, `per-phase` one per model, `per-step` a fresh session per open step. In the last two, each fresh session opens with a handoff note from the progress file (build-progress@1), the step, its checks and its files.
- **Loop stops** when every step is done, a step is left open, a budget stop fired, or the next step is pinned above the run's model.
- **Output caps:** `BASH_MAX_OUTPUT_LENGTH`, `MAX_MCP_OUTPUT_TOKENS`, `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`. 0 leaves Claude Code's limit.
- **Budget:** counts input + output + cache writes per session; cache reads are left out. Warn prints one line, stop ends the session.
- `AXF_CHAIN_CONTROL=off` skips all of it and runs the rules brief alone.

## Models
`suggestions` compares each open step's pin with the rules: `orchestrator.mjs suggest <id>`. The pin still decides. The original item said Haiku / Sonnet for simple steps; the model policy (Opus or Fable only) wins, so rules can only say those two.

## Known gaps
- File scoping is an instruction in the prompt, not enforced by the tools.
- The cost preview prices the chain payload only, not the conversation a fresh session also saves.
