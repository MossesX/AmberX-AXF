<!-- memory-chunk@1 source=_claude/memory/docs/harvest/hub-notify.md lines=68-74 tokens=184 -->
## Left for later
- AXPP (Fable), hub push, admin API; Python port of lib-hub (no Python user yet).
- `x.work`: lift ApprovalWatchService (above).
- Wire alert@1 → device notifications (an Android alerts library subscribing `AlertCenter.onChange` → `AxfNotifications.deliverAlert`).
- Web `HubWatcher` is unused by the console plugin (it keeps its own store for banner + dialog); new web apps can use it.
- Build Pilot: no adoption needed now (it has no hub feed code). If it wants the approvals banner: copy `framework/libs/hub` into its baked framework, `fetchHubFeed(hub)` from the browser (its origin must be allowed by `AXHUB_APPROVALS_ORIGINS` or sit under the hub cookie domain on https), render `feed.pending` and open `p.url`.
