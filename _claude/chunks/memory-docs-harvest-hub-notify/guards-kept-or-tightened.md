<!-- memory-chunk@1 source=_claude/memory/docs/harvest/hub-notify.md lines=30-41 tokens=377 -->
## Guards kept or tightened
Kept: https-only plain-host hub address; links only to the exact hub origin; approval links only for real ids; feed with
the session cookie only, no redirects, 256 KB cap; never approves via API; web view no JS / file / content / mixed content /
third-party cookies, every navigation + redirect checked, nothing loads off-origin; APK downloads only `/apps/download/<project>/<file>.apk` on the hub, cookie sent only to the hub; sign-out = CSRF form post with hub Origin; lock screen only "Approval waiting" (VISIBILITY_PRIVATE + public version, channel PRIVATE); never over the lock screen; FLAG_SECURE (MainActivity untouched); session never backed up (backup rules untouched); WebView debugging off.

Where the two copies disagreed (stricter kept):
- **Foreign links**: Android ignored the item's `url` and rebuilt it; web dropped items whose `url` wasn't the hub. Now both: an item needs a `url` on the hub **and** the link used is rebuilt from the id.
- **Address parsing**: Android used `java.net.URL`, web `new URL()`; both now use one hand parser (ASCII hosts only, no `@`, `\` ends the authority, ports 1–65535). Uppercase approval ids are refused on both (was: web accepted any string id).
- **Signed-out mapping**: web only mapped 401/403; Android also read `signedIn:false` / `admin:false` in a 200 body. Both do both now.
- Field caps (tool 120, summary 600, times 64) and max 50 items now apply on web too.
- New: `loginUrl` refuses return paths with `//` or `..`.
