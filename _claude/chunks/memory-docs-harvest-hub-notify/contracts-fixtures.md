<!-- memory-chunk@1 source=_claude/memory/docs/harvest/hub-notify.md tokens=204 -->
## Contracts / fixtures
- New fixture `framework/spec/fixtures/hub-approvals.json` (generated in `gen-fixtures.mts` from `libs/hub/hub.ts`): constants, address normalize/origin/isHub (incl. Unicode, user-info, backslash, port, IPv6 cases), URLs, approval ids, login return paths, APK names, CSRF, 26 feed replies (status mapping, foreign/missing links dropped, bad ids, duplicates, caps, counts), seen-id plans. Replayed by `framework/spec/check-hub.mts` (web, 183 checks) and `HubConformanceTest` (Kotlin).
- Placeholders: `axf.hub.axpp` (AXPP, Fable), `axf.hub.push`, `axf.hub.admin-api`; `axf.notifications.alerts`, `.push`, `.schedule`.
- alert@1 hook: `AlertNotifications.plan(change)` / `AxfNotifications.deliverAlert(...)` (delivery channel `device`; repeats never ring). Nothing subscribes `AlertCenter` yet.
