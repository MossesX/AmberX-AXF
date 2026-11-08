<!-- memory-chunk@1 source=_claude/memory/docs/axhub-web.md tokens=192 -->
## The hub side (axHub decision #90)

`/apps.json` had no CORS, so a browser on another origin could not read the catalog. The hub now answers it like the
approvals feed: cross-site reads from **https origins under its cookie domain** (or any origin named in
`AXHUB_APPS_ORIGINS`), with credentials, and **JSON** for signed-out (401) and not-allowed (403) instead of an HTML
redirect, so an app can say "sign in" rather than showing a dead list. `crossSiteOk()` is now shared by both feeds.

**Operational note:** the web app's origin must sit under the hub's cookie domain (`AXHUB_COOKIE_DOMAIN=amberxai.com`
→ `axhub-web.amberxai.com` passes). A host outside it needs naming in `AXHUB_APPS_ORIGINS`. Downloads are plain
navigations to the hub and work either way.
