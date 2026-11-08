<!-- memory-chunk@1 source=_claude/memory/docs/assistant-approvals.md tokens=264 -->
## How deciding works (first that applies)

1. The app's host `decide` (`setApprovalsHost`). AmberX: Deny = native `vetoDeny` with the phone's hub session
   (fallback: the call's page); Approve / Decline open the approval in the signed-in hub web view (`native.hubOpen`),
   where Approve is on the first screen. The console AI assistant chat, when it runs inside AmberX, uses the same host.
2. A page on the hub's own origin decides directly: `POST /auth/api/approvals/<id>` `{action, rev}` with
   `X-AxHub-CSRF` (the AXHub web app's `act`), Deny through veto@1 `denyVeto`.
3. `frame`: the hub's approval page inside the popover (the console: the hub lists its origin in
   `AXHUB_APPROVALS_FRAME_ANCESTORS`). "Back" returns to the list; the frame closes when the item leaves the feed.
4. Otherwise the page opens (`host.open` or `window.open`; AmberX routes hub URLs to its hub view).

The console can't approve with one click itself: the hub checks Origin + CSRF, so a true one-click approve needs the
hub page (framed) or the phone's native session.
