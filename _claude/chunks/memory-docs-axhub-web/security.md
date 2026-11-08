<!-- memory-chunk@1 source=_claude/memory/docs/axhub-web.md tokens=216 -->
## Security

The app holds **no hub token**. Both feeds are read with the browser's own hub session
(`credentials: 'include'`), the way the console's approvals banner does (hub decision #85):

- Redirects are refused (`redirect: 'error'`), so a session never follows the hub elsewhere; replies are read through
  a byte cap (256 KB approvals, 512 KB catalog).
- A download link is **rebuilt** from the hub address, the project and the file name and then checked with
  `isHub(...)`; a link in a reply is never used. File names must match the hub's own `app-catalog@1` shape, so
  `../../etc/passwd` or `evil.sh` never becomes a button.
- Nothing in the app can approve, reject or change anything on the hub.
- Hub pages are opened with `noopener,noreferrer`.
- Inside a host app the framework's embed@1 layer hides the chrome the host shows; nothing else changes.
