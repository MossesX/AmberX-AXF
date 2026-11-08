<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-manager-plugin.md lines=6-19 tokens=331 -->
## Summary

The agent manager keeps every feature, route, id and guard of the Opus build, and its **definition format becomes a
framework contract, `agent-definition@1`**: one TypeScript reference in `framework/core/agents.ts`, a Python port in the
plugin's `server/contract.py` and a Kotlin mirror in the kernel (`ai.amberx.axf.kernel.agents`), all replaying one
fixture (`framework/spec/fixtures/agents.json`). Validation, normalisation, the system-prompt composer, memory config and
text engine (tokens, BM25, chunking, trimming), workflow/tool templates, router parsing, add-on checks, risk rules and
export are now the same code path on every port, so Build Pilot and Android apps can load the same agents and
produce the same prompts. On top of that the server gained a dry-run validator (`POST /validate/{coll}`, used live by
every form — Save is disabled while the contract reports errors), streamed workflow runs (SSE) with per-step timing, a
memory-store overview, a whole-library export, forward references inside add-on bundles, a one-time data migration, and
a Safety panel that shows which dangerous tools each agent wants/gets and whether Container access + Snapshot Manager are
on. Self-tests: 92 → 116 checks, plus the fixture replay in TS (gen) and Kotlin (conformance test, written without a compiler).
