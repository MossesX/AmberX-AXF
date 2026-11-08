<!-- memory-chunk@1 source=_claude/memory/docs/harvest/work-watcher.md lines=79-89 tokens=207 -->
## Left for later
- `axf.work.manager`: the kernel's `WorkScheduler` (`contract/Work.kt`) on WorkManager/AlarmManager (job kinds `once`,
  `constrained`, `alarm`, `chain`).
- A web timer host over the reducer (`setTimeout` / visibility) so `HubWatcher` can run on the same spec; a Python port.
- Hub push (`axf.hub.push`) would turn the approvals job into a push-driven one; the spec shape already allows a `stop`
  outcome and conditions for that.
- Build Pilot: no adoption needed (no background work). If an Android stack plugin wants a background poller, it adds
  `lib-work` + `WorkModule(jobs)` through the library catalog (`ai.amberx.axf.work`, no params).
- Android before/after screenshots: automatic when `fable/work-watcher` is pushed (`rebuild-shots.yml`); the AXHub
  screens should look identical (no GUI change).
