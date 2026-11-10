# Prompt caching and Batch API support in the build orchestrator

Build `prompt-caching-and-batch-api-support-in-the-buil` · branch `claude/prompt-caching-and-batch-api-support-in-the-buil` · Opus

Brett said (2026-11-09 16:02): "Build up prompt caching and batch API plugin... Actually, it's for the orchestrator, not an agent."

## What it does
- The orchestrator's own Claude call (the split) on an API-key account no longer goes through the `claude` CLI. It goes straight to the Messages API (`apiDirect`).
- Prompt caching (`apiCache`): `cache_control` (ephemeral) on the system prompt, on the last tool, and on the stable rules block. The split prompt is now in three parts (`splitParts`): system, stable rules (the same for every build, so it is cached) and the build itself (not cached). It uses 3 of the 4 breakpoints the API allows.
- Message Batches (`apiBatch`): a non-urgent build's split goes to `/v1/messages/batches` at half price. Urgent builds (priority in `apiUrgent`, P0/P1 by default) use the normal path. Each tick collects ended batches first and writes their steps. A failed or expired batch item (26 h cap) sends that build down the direct path on the next intake. If a batch can't be created, the call falls back to direct at once.
- Cost tracking: each answer appends an `api-usage@1` line to `api-usage.jsonl` in the pipeline dir. It records tokens, the billed USD, the USD with no cache and no batch, cache savings, batch savings and whether the cache was hit. Prices come from model-pricing@1.
- Headless build sessions run Claude Code, which already caches its own prompts. The Batches API can't serve an interactive agent loop, so this work covers the calls the orchestrator makes itself.

## How it's reached
- CLI: `pipeline.mjs api-usage [--json]`, `pipeline.mjs api-poll`, `pipeline.mjs set apiDirect=… apiCache=… apiBatch=… apiUrgent=P0,P1`
- REST: `GET /pipeline/api-usage`, `POST /pipeline/api-poll`, `POST /pipeline/settings` (new keys)
- MCP / voice: plugin actions `pipeline-api-usage` and `pipeline-api-poll`, plus the new keys on `pipeline-settings-set`
- No UI was added, so there is no deep link or UI Review.

## Files
- `apps/console-web/plugins/build-orchestrator/api-jobs-core.mjs`: pure code for request shaping, routing, cost and the ledger
- `apps/console-web/plugins/build-orchestrator/api-jobs.mjs`: HTTP client (key only from the env), run as a child of the sync dispatcher
- `pipeline-core.mjs` (settings, `splitParts`), `pipeline.mjs` (`apiSplit`, `pollBatches`, ledger, CLI), `server/__init__.py`, `plugin.json`
- `api-jobs.test.mjs` (9 checks, including a local API stub), added to CI

## Tests
`api-jobs.test.mjs` 9 ✓ · `pipeline.test.mjs` 35 ✓ · `test.mjs` 33 ✓ · `test.py` 31 ✓.
`plugin-lifecycle check build-orchestrator` fails only on stale references in `framework/cli/dispatch-gate.mjs`. Those were there before this build and it didn't touch them.

## Not tested
- Not tried against the live API: no API account key was used in this session. The stub test covers the wire format.
- The batch round trip inside `pollBatches` (login snapshot → poll → apply) has no end-to-end test. It needs a fake API-account login.
