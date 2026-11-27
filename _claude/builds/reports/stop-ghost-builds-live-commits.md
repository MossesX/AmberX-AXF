# stop-ghost-builds-live-commits

Brett, Nov 23 2026: "Kill it. Why the fuck would we leave it?"

## Result

The "Builds live" sync no longer commits for a build that did not really change. A shipped build, a no-op tick and a
repeated note produce no outbox line, no commit and no push. A commit subject can no longer end in an empty list.

## Root cause

Three things stacked up.

1. **A stale launcher kept touching builds that were already shipped.** The `axf-molly` container (image built Nov 18,
   its code is not on main) still runs a dispatcher tick every minute. It launches through the host service
   `axf-molly-bridge`, which has been running since Nov 15 from `/root/axf-builds/axf-molly-container-orchestrator-gate`,
   a build folder that no longer exists. Every launch ends in `launcher exit 127 ... claude-headless.sh: No such file or
   directory`. Each failure wrote the same "Launch failed" note again and flipped the build between Queued and Running;
   the reconciler then wrote its own "no live session or process runs it" note and put it back. On
   `urgent-all-data-to-postgres-builds-store` that is 42 copies of one launch-failed line and 55 of one reconciler line.
2. **Shipped builds were still launchable.** `urgent-all-data-to-postgres-builds-store` has a shipped manifest
   (Nov 19) and a merged PR, but its status was left at Queued, so the planner kept picking it. Nine builds are in that
   state (list below).
3. **builds-live treated every touched record as a change.** Any store write that rewrote a build (a stamp, the
   dispatcher's run bookkeeping, a repeated note) went into the outbox as a whole before/after record. The repeats
   filled the 16 MB outbox cap in about 2.5 hours, which made it due (`full`), and the flush published it. The
   follow-up `sync` then found its local copy "newer" by stamps only and pushed a second commit that changed nothing
   but `THREADS.md`; its subject was built from an empty list (`1 build change(s):  [skip ci]`).

## The fix

- `framework/plan/builds-merge-core.mjs`: `realChanges(before, after)` says what really changed. Stamps, revisions,
  the dispatcher's run bookkeeping and a note whose text the build already holds are not changes. A settled build
  (shipped manifest, complete or archived) changes only by a status move, a link, landing evidence or removal, and a
  shipped build only moves forward (landed, complete, archived).
- `framework/cli/builds-live.mjs`:
  - `enqueueLive` queues only builds that really changed, so a no-op tick never fills the outbox.
  - `publish` applies the same rule to lines already queued, then compares the merged record with main's own copy:
    with no real change, main's store, exports and live log stay byte for byte as they are and nothing is pushed.
  - `sync` sends a build only when it is ahead of main in a way that matters.
  - `message` names the builds that changed, or the files when no build changed; never an empty list.
- `apps/console-web/plugins/build-orchestrator/pipeline-core.mjs`: a build with a shipped manifest is never launched
  again, whatever status is left on its record.
- `pipeline.mjs` (`setPipeline`) and `framework/cli/builds-reconcile.mjs`: a note the build already ends with is not
  written a second time.
- `framework/spec/check-builds-live.mjs` (runs in CI): section 15 proves it on a throwaway remote. A no-op tick, a
  shipped build touched again (status flaps, new notes), `flush`, `sync --now` and an old outbox line with no real
  change all leave main's head where it was; a real change still publishes and is named in the subject.

## Needs Brett

- **Stop the stale launcher.** It is a second dispatcher running code that is not on main, and it is the origin of the
  churn. I did not stop it: it also holds a lease and runs a lander job, and stopping it is his call.
  1. `docker stop axf-molly && docker update --restart=no axf-molly`
  2. `systemctl disable --now axf-molly-bridge.service` (its folder is gone, so it cannot be started again as it is)
  3. Remove `/etc/systemd/system/axf-molly-bridge.service`, then `systemctl daemon-reload`
- **Nine shipped builds whose status never settled** (shipped manifest on the record, status not landed / complete).
  They are no longer launched or published, but the rows still read wrong:
  `pass-approval-hook-deep-link-amberx-notification` (queued), `context-menus-plugin-one-true-source` (queued),
  `urgent-all-data-to-postgres-builds-store` (queued), `server-watchdog-orchestrator-auto-recovers-stuck` (failed),
  `orchestrator-stale-row-watchdog-vps` (failed), `axf-data-postgres-real-tables-own` (failed),
  `server-rule-done-means-merged-working` (failed), `rebuild-fresh-main-phone-connect-small` (failed),
  `guided-live-demo-test-watch-orchestrator` (failed).
- `fix-refreshing-console-jumps-back` (PR #825 still open, 11 of 12 steps done) and
  `orchestrator-settings-collapsible-split` (failed, gave up after 5 attempts) are not shipped. Their churn was the same
  repeated notes and is covered by the fix; the builds themselves still need a decision.

## Stale build folders (not deleted)

Folders under `/root/axf-builds` (52 GB in total) whose build is shipped, landed, complete or archived. Status is from
the live store on Nov 23 2026; none has a live tmux session. "Behind" is commits behind `origin/main`; "Loose" is
modified or untracked files (session logs and jsonl files).

| Folder | Status | Shipped manifest | Behind | Loose |
|---|---|---|---|---|
| `always-fill-every-slot-when-slots-are` | complete | yes | 45 | 6 |
| `approval-rules-save-apply-default-don-t` | complete | yes | 149 | 5 |
| `approval-rules-vps-configuration-veto` | complete | yes | 181 | 4 |
| `context-menus-plugin-one-true-source` | queued | yes | 138 | 4 |
| `every-app-gets-own-locked-default` | complete | yes | 108 | 4 |
| `fable-full-audit-ui-overhaul-conso--s1` | archived | no | 1287 | 4 |
| `fable-full-audit-ui-overhaul-conso--s10` | archived | no | 1277 | 4 |
| `fable-full-audit-ui-overhaul-conso--s11` | archived | no | 1267 | 4 |
| `fable-full-audit-ui-overhaul-conso--s12` | archived | no | 1276 | 4 |
| `fable-full-audit-ui-overhaul-conso--s13` | archived | no | 801 | 4 |
| `fable-full-audit-ui-overhaul-conso--s14` | archived | no | 1274 | 4 |
| `fable-full-audit-ui-overhaul-conso--s15` | archived | no | 1272 | 4 |
| `fable-full-audit-ui-overhaul-conso--s16` | archived | no | 586 | 4 |
| `fable-full-audit-ui-overhaul-conso--s17` | archived | no | 1263 | 4 |
| `fable-full-audit-ui-overhaul-conso--s18` | archived | no | 1267 | 4 |
| `fable-full-audit-ui-overhaul-conso--s2` | archived | no | 1286 | 4 |
| `fable-full-audit-ui-overhaul-conso--s3` | archived | no | 1285 | 4 |
| `fable-full-audit-ui-overhaul-conso--s4` | archived | no | 1284 | 4 |
| `fable-full-audit-ui-overhaul-conso--s5` | archived | no | 1282 | 4 |
| `fable-full-audit-ui-overhaul-conso--s6` | archived | no | 937 | 4 |
| `fable-full-audit-ui-overhaul-conso--s7` | archived | no | 565 | 4 |
| `fable-full-audit-ui-overhaul-conso--s8` | archived | no | 1270 | 4 |
| `fable-full-audit-ui-overhaul-conso--s9` | archived | no | 1278 | 4 |
| `fable-rebuild-1-2-vps-host-services-move` | complete | yes | 150 | 4 |
| `fable-rebuild-2-2-both-watchdogs-one` | complete | yes | 148 | 4 |
| `fix-main-ci-red-after-s16-s7-hand---s1` | archived | no | 474 | 4 |
| `fix-main-ci-red-after-s16-s7-hand---s2` | archived | no | 439 | 4 |
| `fix-main-ci-red-after-s16-s7-hand---s3` | archived | no | 472 | 4 |
| `fix-main-ci-red-after-s16-s7-hand---s4` | archived | no | 470 | 4 |
| `fix-main-ci-red-after-s16-s7-hand---s5` | archived | no | 449 | 4 |
| `new-asset-type-animated-expanding-row` | built | no | 4793 | 63 |
| `one-true-source-get-redundant-settings` | complete | yes | 31 | 4 |
| `pass-approval-hook-deep-link-amberx-notification` | queued | yes | 142 | 4 |
| `phone-connect-open-straight-phone-no-tap` | complete | yes | 166 | 4 |
| `postgres-part-b-plan-plan-studio-catalog` | complete | yes | 1493 | 2 |
| `postgres-part-c-console-state-settings` | archived | no | 1555 | 4 |
| `rename-gate-rules-to-vps-configuration` | complete | yes | 194 | 4 |
| `rip-out-plan-studio-1-keep-only-plan` | complete | yes | 196 | 4 |
| `stop-push-storm-builds-live-pushes-build` | queued | yes | 126 | 4 |
| `urgent-all-data-to-postgres-builds-store` | queued | yes | 1547 | 4 |
| `vps-never-gives-up-fix-land-every-build` | archived | yes | 1929 | 4 |

Also running from stale folders: a `vite preview` on port 7312 from
`/root/axf-builds/appearance-skins-colour-themes-only-remove-design-packs` (since Nov 10; the folder is gone).
