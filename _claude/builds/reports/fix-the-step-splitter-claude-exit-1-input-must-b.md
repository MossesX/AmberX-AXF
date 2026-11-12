# Fix the step splitter: "claude exit 1: Input must be provided"

Build `fix-the-step-splitter-claude-exit-1-input-must-b`, branch `claude/fix-the-step-splitter-claude-exit-1-input-must-b`, Opus.

## What broke

Every build added since about Nov 10 was split by rules, not by Claude. The orchestrator's one-shot split call was

```
claude -p --model claude-opus-5-5 --output-format json --max-turns 1 --tools '' "<prompt>"
```

`--tools <tools...>` is variadic in the Claude CLI, so it read both `''` and the prompt as tool names. That left no
prompt and no stdin, and claude exited 1 with `Error: Input must be provided either through stdin or as a prompt
argument when using --print`. `splitBuild` then fell back to `rulesSplit`: one step per line of the request, with
Brett's raw words pasted in as a step and the note "Split by rules (Claude: claude exit 1: …)".

I reproduced it on the VPS with CLI 2.1.322: that exact command line exits 1 with that error.

## Fix

`apps/console-web/plugins/build-orchestrator/pipeline.mjs`

- New `splitterCall(prompt)` returns `{ args, input }`. The prompt goes on **stdin**, never as an argument, and the
  no-tools flag uses the equals form `--tools=`, so nothing after it can be taken as a tool name.
- `askSplitter` uses it (`spawnSync(..., { input })`). An empty prompt is refused before claude is called.
- I checked both `--tools=` and `--tools ''` with the prompt on stdin against the real CLI: both exit 0 and answer.

## Re-split of today's fallback builds

There were 17 builds with fallback steps (Nov 10–12). Only one was still waiting with no step done:

- `move-amberx-web-app-into-the-console-amberx-andr` (queued, 0/3): I re-split it with the fixed splitter and it now
  has 14 steps from Claude (2 Fable). It is still queued, and the change is on main (builds-live).

Left as they are:

- Built builds: their work is already done.
- `show-commits-behind-main-…` (2/3 done) and `unlink-plan-studio-…` (1/3 done): steps are already done there.
- The hidden `one-to-do-list-…`.
- This build itself.

Any of these can be re-split later with `pipeline.mjs split <id>` (or `--request` for the next tick). Steps that are
already done are kept.

## Tests

`apps/console-web/plugins/build-orchestrator/pipeline.test.mjs` (47 checks, all pass):

- A fake `claude` on `~/.local/bin` parses arguments the way the real CLI does (variadic `--tools`, prompt argument
  or stdin, the same error otherwise).
- A test proves the fake is faithful: the old command line fails with "Input must be provided".
- An end-to-end test of the real `claude -p` path (no `AXF_PIPELINE_SPLITTER`): adding a build gives Claude's 3
  steps, with no rules note, no fallback note and his words not pasted as a step. His words reach claude on stdin and
  are never an argument.
- Against the old `pipeline.mjs`, the new e2e test fails with the production error.

`test.mjs` passes (33 checks).

## Reach (API)

There is no UI change. The splitter is reached the same ways as before: `pipeline.mjs split <id> [--request]` (CLI),
the orchestrator's intake on every dispatcher tick, and the console's existing split action.

## Live

The live dispatcher runs from `/opt/axf` and still has the old call until this PR lands. Until then, new builds there
are still split by rules.
