<!-- memory-chunk@1 source=_claude/memory/docs/veto-approvals.md lines=39-48 tokens=184 -->
## How to test

- `npx -y tsx apps/amberx-droid/test.mjs` (veto block: feed split, links, countdown, notify plan, push, stream, deny, alert config, store).
- `cd apps/amberx-droid && npm run build`; `cd apps/axhub-web && npm run build`; `cd apps/console-web && npm run typecheck && npm run build`.
- `node framework/cli/check-theme.mjs`, `node framework/cli/check-controls.mjs`.
- Android (CI): `HubRulesTest.heldVetoCalls`; on the phone: Settings → Plugins → Approvals → each Test button plays its
  channel; send a held `vps.run` through axHub and check the three notifications, Deny from the notification, and the
  Terminal tab.
- Browser: open AmberX, allow notifications, Test buttons play tones; a held call opens a Terminal tab.
