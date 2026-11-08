<!-- memory-chunk@1 source=_claude/memory/docs/chain-control.md tokens=257 -->
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
