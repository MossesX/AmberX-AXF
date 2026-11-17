# axHub: raise per-project memory file cap from 500 to 750

## s1: cap and tests
- Already on axHub main as 9de150a (Nov 13 2026, "Raise the per-project file cap to 750 and stop counting overwrites"):
  `MEMORY_LIMITS.filesPerRepo = 750` in `packages/core/src/memory-files.ts`; `packages/storage-sqlite/test/memory-files.test.ts`
  asserts 750. No further code change needed.
- Suite run in node:22 (host Node 20 has no `node:sqlite`): 592/593 pass, memory-files tests green.
  One unrelated failure: `packages/connectors/ssh/test/build-tools.test.ts` > build_land (merge of a THREADS.md fixture), not touched here.

## s2: merge, redeploy, write check
- The live hub was on ee5706f (Nov 8) and still enforced 500. Redeployed through Coolify's queue
  (`queue_application_deployment`, app `jghxpzuudkahgznvffiwtwmj`) to 9de150a: cap 750 live.
- Write check then failed: amberx-axf already holds **761** files on the hub (builds/shipped 398, builds/reports 197,
  memory/docs 93, rest small), so 750 was outgrown before it shipped. builds/shipped grows ~15-25 files a day.
- Fix: axHub 9dc7ef2 raises `MEMORY_LIMITS.filesPerRepo` to 2000 (same as the data area); the 20 MB byte cap
  (13.3 MB used) stays. Tests in node:22: 592/593 (same unrelated `build_land` failure). Fast-forwarded to axHub main,
  redeployed: container on 9dc7ef2, healthy, `/healthz` 200.
- Confirmed in the live container with the hub's own `DirectoryMemoryFiles` on `/projects`: a new-file write to
  amberx-axf (`memory/cap-probe.md`) succeeded, then the probe was removed.
- Follow-up: builds/shipped will hit 2000 in roughly two months at the current rate; it should be archived or rolled
  up (one file per month) rather than the cap raised again.
