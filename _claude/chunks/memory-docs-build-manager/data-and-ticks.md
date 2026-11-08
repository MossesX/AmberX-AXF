<!-- memory-chunk@1 source=_claude/memory/docs/build-manager.md lines=80-86 tokens=297 -->
## Data and ticks

- Logic: `web/merge.mjs` (pure; `buildRows`, `timing`, `totalsByModel`, `filterRows`, `sortRows`, `linkRow`, `liveEntries`), estimates parsed by pending-core's `estimateMinutes` / `formatMinutes`.
- Server part (read-only, console token, 404 when off, never on MCP): `GET /api/plugins/build-manager/live` = the activity feed's running + recently finished items, or `{available: false}` without it. The build list comes from the console's own `/api/pending`, `/api/build-queue`, `/api/plan` (works offline from the page's snapshot). <!-- axf-plugin:build-manager -->
- No data of its own (dataDir stays empty); preferences are browser settings `build-manager.banner|sort|sources`.
- **Step ticks** call `POST /api/pending {action: 'step', id, index, done}` (pending-core `apply`) and `POST /api/build-queue/steps {id, index, done}` (build-queue-core `stepsAction`), both from the small-steps build (`fable/split-steps`); aligned at the wave-2 integration (`tickRequest` / `probeTicks` in `web/merge.mjs`, tested in `test.mjs`). The plugin still probes the shared cores on a throwaway state, so a console without those actions shows ticks read-only instead of failing.
