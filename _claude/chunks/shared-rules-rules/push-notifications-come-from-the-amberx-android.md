<!-- memory-chunk@1 source=_claude/shared/rules/RULES.md lines=62-62 tokens=140 -->
## Repos, servers, credentials

- **Push notifications come from the AmberX Android app (Oct 28 2026, Brett; replaces "push through the AXHub app", Oct 21):** "From now on all push notifications for approval or anything from axHub comes from amberx android app." Every push notification axHub sends (approvals, merge approvals, alerts, anything else) is delivered by the AmberX Android app (`apps/amberx-droid`), not the AXHub app or Patches. Until the AmberX app can receive them, that gap is a build in the orchestrator, not a reason to fall back silently.
