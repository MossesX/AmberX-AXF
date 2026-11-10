# urgent-console-perf: console slow to load (Nov 4 2026)

> Brett said (voice, Nov 4 2026): "How come console is taking forever to load? I thought lazy loader was in." ... "Can we dig into it?" ... (after the diagnosis) "Yes."

Branch `claude/urgent-console-perf`, Opus. The plugin lazy loader was in, but it only makes the *browser* load less code. The time went to the server.

## What was wrong

1. **Every read spawned a Node process, per request and per client.** Home cards and screens poll `/api/build-queue`, `/api/plan`, `/api/pending`, `builds-page/progress`, `systems-check/check` and others. Each answer ran `node engine-rpc.mjs …` or a plugin CLI. Two open consoles doubled it. Nothing was shared, and there was no limit on how many ran at once.
2. **Every one of those reads also took the builds store's write lock.** `loadStore()` absorbs "foreign writes" (an export file changed outside the store) under the lock. The `big-dog` and `current` profiles have a `build-queue.json` on the hub but no queue in the store. `exportAll` skipped them without recording their signature, so they looked foreign forever. Every read on every machine (console, CLI, sessions) took the lock, re-exported and rewrote `store.json.exports.json`.
3. **That is the `GET /api/build-queue` 500.** With many reads queued on the lock, any that waited more than 20 s threw `builds store is locked (…/store.json.lock)`. The engine answered `ok: false` and the route returned 500. The console's terminal state has those exact lines.
4. **One 500 then sent the client to stale data.** `getJson` set `backendUp = false` on *any* non-OK answer, so after one 500 every later read used the static `/data/*.json` copies. The logs show this as `/api/build-queue 500` followed by `/data/build-queue.json 200`. Failing reads were retried at full polling speed. Hidden tabs kept polling.
5. **Zombies.** uvicorn was PID 1 and never reaped orphaned grandchildren, so about 30 `[node] <defunct>` entries piled up in the container.
6. **builds-reconcile ran at every session start plus every 10 min.** Each run reads GitHub and writes the store. Many sessions starting together hit GitHub's rate limit (`GitHub 403: API rate limit exceeded` in the console log) and took the store lock.

## What changed

| Area | Change |
| --- | --- |
| `framework/cli/builds-store.mjs` | `exportAll` records a file that has nothing to export, so it no longer looks foreign and reads stop taking the lock. `loadStore()` waits at most 2 s for the lock to absorb a foreign write. If another writer holds the lock, it reads the store as it is, and that writer absorbs the change. Writes still wait 20 s and then fail, now with `StoreLocked`. |
| `apps/console-web/server/readcache.py` (new) | One cached value per source, shared by every client. Concurrent misses are single-flight. Values are refreshed when watched files change (store, plan, catalog, profiles: repo and hub copies). A value past its ttl is served at once while it refreshes in the background. Errors are kept 2 s. `install_spawn_guard()` caps `subprocess.run(["node", …])` at `AXF_MAX_SPAWNS` (default 4) at once; a call that waits 30 s runs anyway, so nothing can deadlock. |
| `server/main.py` | Read-only engine ops (`build-queue`, `plan`, `pending`, `tracker`, `catalog`, `libraries`, standards, templates, …) go through `engine_read`. Every write op clears the engine cache before and after it runs. New `GET /api/perf` (token) returns cache and spawn counters. |
| Plugins | `builds-page` `/state` and `/progress` are shared reads, and its writes clear them. `systems-check` `/check` (incl. the live key checks that hit GitHub) runs once per 20 s for all callers; `force=1` and every invalidate still run fresh. `ref-links` `/targets` (refs.mjs plus three console catalog runs) is shared for 15 s and refreshed on a store write. |
| `src/fetchShare.ts` (new), `src/main.tsx` | Installed before the app renders. Identical in-flight same-origin `GET /api/…` share one request. A GET from a hidden tab waits until the tab is visible. A 5xx or no answer backs that URL off 1 s, 2, 4 … up to 60 s, with an instant 503 in between. POST, `/api/events`, other origins and `x-axf-fetch: direct` pass through. |
| `src/api.ts` | A 5xx falls back to the static copy for that read only. Only "no answer at all" (or a 404/405, i.e. no backend) marks the backend down. |
| `framework/cli/builds-reconcile.mjs` | `--apply` is skipped when the last report is younger than `AXF_RECONCILE_EVERY_MIN` (default 5) or another reconcile is running; it prints the last report instead. `--force` always runs. It was never in a request path, and still isn't. |
| `server/Dockerfile` | `tini` is PID 1 and reaps zombies. |

## Before / after (measured)

Two sandbox consoles from the same `axf-console:latest` image. One mounts the old code (`HEAD` before this branch), the other this branch. Both use the same repo data, no hub mount, no GitHub token, and a 1.5 GB memory cap. Each round fires the 12 Home reads three times at once (three consoles) and repeats every 5 s, six rounds. Node processes were sampled with `docker top` every 0.25 s; CPU is the container cgroup's `usage_usec`. Script: `/tmp/perfm/load.sh` (described here; not kept in the repo).

| | Before | After |
| --- | --- | --- |
| Round time (36 reads) | 12.6 / 14.2 / 9.8 / 17.8 / 9.7 / 10.1 s | 2.6 / 1.5 / 1.0 / 0.9 / 0.7 / 1.0 s |
| Container CPU for the 6 rounds | 112.5 s | 11.5 s (−90%) |
| Peak node processes at once | 35 | 4 (the cap) |
| Node processes seen | 326 | 42 |
| `engine-rpc build-queue` / `plan` / `pending` runs | 18 / 18 / 18 | 5 / 6 / 6 |
| Cache (after only, `/api/perf`) | n/a | 62 hits, 55 stale-served, 9 misses, 0 errors; 0 spawn overflows |
| Zombies | ~30 in production | 0 (tini) |

Single-client endpoint times on the live console before the fix (quiet host): `systems-check/check?keys=1` 7.8 s, `/api/build-queue` 3.1 s, `crew-live/agents` 3.1 s, `/api/pending` 0.9 s, `/api/plan` 0.8 s, `builds-page/progress` 0.8 s. With the fix, a repeat read inside the ttl answers from memory.

At diagnosis (16:13 UTC) the host had load 45, swap 4044/4095 MB and 23 node processes in `axf-console` at 135% CPU. Live numbers after the redeploy are in the THREADS log entry.

## Tests

- `node framework/spec/check-builds-store-lock.mjs` (new, CI): a read with a foreign write and a held lock answers (it fails on the old code with the exact production error); the build-queue read answers; writes still refuse a held lock; a file with nothing to export stops reads from writing (it fails on the old export code).
- `python apps/console-web/server/test_readcache.py` (new, CI, 14 checks): hits, single-flight with 12 threads, stale-while-revalidate, `max_stale=0`, file-change, error ttl, invalidate, spawn cap, non-node untouched, overflow without deadlock.
- `npx tsx apps/console-web/scripts/fetch-share-check.mts` (new, CI, 8 checks): sharing, no client cache, abort signals, pass-through, hidden tab, abort while hidden, backoff 1/2/4 s and reset, 60 s cap.
- Still green: `check-builds-store.mjs` 37, `check-builds-live.mjs` 47, builds-page 14, systems-check 228, agent-slots 19, build-orchestrator 5, ref-links 17, console `tsc --noEmit`.

## Known gaps

- Other plugin endpoints still spawn per request when they aren't cached, but at most 4 run at once now. `crew-live` already had its own single-flight cache. The `console-commands` runs come from commands, not reads.
- The client layer shares in-flight reads; it does not merge polling timers. Cards still keep their own intervals, but identical requests collapse into one and the server answers repeats from memory.
- A console inside a hidden Molly tab (an iframe in a `display:none` panel) still counts as visible to the browser.
