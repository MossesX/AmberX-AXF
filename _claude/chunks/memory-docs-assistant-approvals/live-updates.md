<!-- memory-chunk@1 source=_claude/memory/docs/assistant-approvals.md tokens=81 -->
## Live updates

Polled every 5 s while the page is visible (2 s – 5 min, `everyMs`), on focus, on `axf:hub-check`
(`checkApprovalsNow()`), and on `ApprovalsWatcher.push(raw)`. The hub has no approvals event stream today
(placeholder `axf.approvals.live`). One watcher per hub address is shared by every badge on the page.
