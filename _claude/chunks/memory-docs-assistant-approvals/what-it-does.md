<!-- memory-chunk@1 source=_claude/memory/docs/assistant-approvals.md tokens=199 -->
## What it does

- A badge in the assistant's title bar while axHub has anything waiting: the count (a countdown when the only item is
  held), warning colour for held calls, danger at 30 s or less, a short pulse when something new arrives. Nothing is
  drawn while nothing waits or the app's hub session can't read the feed.
- Click: a popover listing each item: title (the caller's `reason.title`, else "Run <tool>"), tool + age or the live
  countdown, description, command; **Approve / Decline** for approvals (as the hub lists them), **Deny** with the
  countdown for held (veto@1) calls, never Approve. "All approvals on axHub" at the bottom. Result toasts: the hub's
  words when the app decided directly, or "decided on axHub" / "no longer held" when an item it acted on leaves the feed.
