<!-- memory-chunk@1 source=_claude/memory/docs/assistant-approvals.md lines=58-67 tokens=158 -->
## Known gaps

- No approval-badge@1 contract / fixture and no Kotlin twin (PORTING.md notes it).
- AmberX's own Approvals page and the console approvals banner still read the feed themselves (three watchers on the
  same feed in the console when the banner is on); folding them onto lib-approvals is a later cleanup.
- The AmberX "Approve" is one tap to open the hub view plus Approve there; a native one-tap approve would need a shell
  method (`hubDecide`) like `vetoDeny`.
- Postpone / Ignore stay on the hub page.
- axhub-web and walkthrough-studio baked copies are now behind by the new lib folder (rebake when they need it).
