# Console audit, step s6: the remaining findings

Build `fable-full-audit-ui-overhaul-conso`, step s6. This is the companion to the s1 findings report
(`fable-full-audit-ui-overhaul-conso.md`). Earlier steps covered F1 (s2), F3 (s3), F5 (s4) and F6 (s5).
Each fix below is its own commit on `claude/fable-full-audit-ui-overhaul-conso--s6`.

## Fixed

| Finding | Commit | What changed | Proof |
|---|---|---|---|
| F4: stale `index.html` after a deploy | Console server: index.html is always revalidated… | `index.html` and the SPA fallback send `cache-control: no-cache`. Other dist files are unchanged, and hashed `/assets` stay immutable. | `server/test_spa.py` (new, CI) |
| F9: unknown `/api` paths answered with the console page | same commit | A GET under `/api` or `/mcp` that no route answers returns a JSON 404. A screen called `/apiary` still gets the page. | `server/test_spa.py` |
| F2: build-orchestrator `/table` and `/priority` 500s after 30-60 s | Build orchestrator: table and priority reads are shared… | Both reads go through `server/readcache.py`. That gives one node process per cache miss for every tab, and the last good answer is served while the cache refreshes. A CLI that times out or cannot start now returns an answer, and the read routes turn a timeout into a 503 with the reason. `act` and `priority set` drop the cached copy. | `plugins/build-orchestrator/test.py`: six concurrent reads start one process, and a timeout is a 503 (68 checks pass) |
| F2: project-switcher `projects.mjs state` 500 | Projects: the list and current project are shared reads… | `GET /` and `GET /current` share one cached read (3 s, single-flight). Timeouts get the same handling and every change drops the cache. | Checked by hand: real reads answer, and five concurrent reads against a hanging CLI start one process and all get 503 |
| F7: project-wizard predated plugin-lifecycle@1 | Project wizard: plugin lifecycle… | Adds `install.mjs`, `uninstall.mjs` and the lifecycle block. Its data moves to `.axf-console/plugins/project-wizard/projects.json`. The old `.axf-console/project-wizard.json` is still read while the new file is missing and is removed on the next save. The CI step and the STATUS line now carry the plugin marker. | `test.mjs` passes. `plugin-lifecycle check project-wizard` is clean apart from the transient watch-live focus file. Migration checked by hand. |
| F8: phone `device/hello` refused with 401 every ~100 s | Console server: behind the wall, plugin device routes take the device's own token | **The s1 diagnosis was wrong.** Phone Connect never answers 401, and the phone's token is valid: it paired Nov 18 23:27 and has not been seen since. axHub passes a bearer request on `/api/` as `X-Auth-Via: token`. The console's wall token gate then demanded the *console* token on every route, including the device routes, where the caller only ever holds its device token. Plugins with `deviceRoutes: true` now register their `/api/plugins/<folder>/device/` prefix as they load, and the gate lets only those paths through, to routes that check the device token themselves. No plugin folder is named in the framework. | `server/test_wall_device.py` (new, CI). `test_wall_users.py` still passes (65 checks). |

After this lands and deploys, the paired phone should come online on its next retry without being paired again. If it
does not, the Phone Connect systems check item already says what to do.

## Reviewed, not changed (with the reason)

- **F10: late ack while the queued copy is `delivering`.** By the time an entry is `delivering`, `drain` has already
  sent it to the woken console, so a late ack can no longer stop the second run. The worst case is one repeated
  navigation, and only for navigate-only commands. s2 reworked the same `ack`/`drain` code for screenshots, so a
  change here now would also risk a merge conflict. Left as is.
- **F7: `plugins/notes-tasks/` (design, schema, test, no plugin.json).** It is not junk. The schema is the live
  `notes-tasks@1` contract with its own CI step, and build `notes-tasks-sync` (status *built*, not yet landed) puts
  its code in this folder. Moving it would break that build. Kept.
- **F7: vendored framework copy in `apps/console-web/src/axf/core`.** `rebake status` marks the console, axhub-web
  and molly as *edited* (local changes to `console-commands`, `control-rules`, `plugin.schema.json`, …), so a re-bake
  would overwrite app-side edits. It is also framework-wide, not a console fix. It needs its own build: move each
  app-side edit into `framework/`, then `rebake apply`. Deferred.
- **F7: orphan data folders on the live host** (`/opt/axf/.axf-console/plugins/`):
  - `push-banner/`: 76 MB, mostly `gh-cache.json` 48 MB, plus `land.json` and `merge-queue*.json`. Last written Nov 19
    11:12. It looks like the gate plugin's data from before its rename. `gate/` has no `land.json`, so something may
    still read this folder.
  - `auto-browser/`: a 64-byte `host-token`, from Nov 4.
  - `molly/`: an empty `plugins/` tree.

  None of these plugins is in the repo any more. I did not delete live data in a headless run. To clear them, first
  confirm nothing reads `push-banner/` (`grep -rn push-banner /opt/axf/deploy /opt/axf/apps`), then archive and
  remove: `tar czf /opt/axf/.axf-console/plugin-backups/orphans-$(date +%F).tgz -C /opt/axf/.axf-console/plugins
  push-banner auto-browser molly && rm -rf …`.
