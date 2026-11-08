<!-- memory-chunk@1 source=_claude/memory/docs/veto-approvals.md tokens=104 -->
## Known gaps

- AmberX has no push transport yet (the phone polls the feed); `vetoFromPush` is ready for it.
- AmberX's own Approvals page, the monitor's in-browser alerts and lib-hub `fetchHubFeed` still count a held call as
  waiting (hub.ts unchanged; filtering there is a cross-port contract change).
- Deny from the console or a browser opens the hub page (the hub accepts a Deny only under its own Origin).
