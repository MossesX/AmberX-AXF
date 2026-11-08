<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/axhub-web-console-look.md lines=68-75 tokens=139 -->
## Gaps

- Kotlin twin of the catalog rules (replaying the `apps` section) and the Android AXHub app's Apps tab on them: deferred
  while Android is on hold (`spec/PORTING.md`), still pending item `axhub-web-hub-rules` (Fable).
- The console's approvals-banner plugin could use `HubApprovalList` / `installHubMenu` next time it is touched.
- The shared hub appearance document names the console's ids; ids this app doesn't ship (`focus-top`, `console-search`,
  `console`) fall back to this app's defaults, so the hub keeps its own toolbar, nav and menu.
