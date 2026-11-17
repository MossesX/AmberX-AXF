# axHub: raise per-project memory file cap from 500 to 750

## s1: cap and tests
- Already on axHub main as 9de150a (Nov 13 2026, "Raise the per-project file cap to 750 and stop counting overwrites"):
  `MEMORY_LIMITS.filesPerRepo = 750` in `packages/core/src/memory-files.ts`; `packages/storage-sqlite/test/memory-files.test.ts`
  asserts 750. No further code change needed.
- Suite run in node:22 (host Node 20 has no `node:sqlite`): 592/593 pass, memory-files tests green.
  One unrelated failure: `packages/connectors/ssh/test/build-tools.test.ts` > build_land (merge of a THREADS.md fixture), not touched here.
