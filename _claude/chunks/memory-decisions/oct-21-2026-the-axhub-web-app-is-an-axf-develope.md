<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=91-102 tokens=236 -->
## Oct 21 2026 — the axHub web app is an AXF developer app (Opus)

Brett: "the axhub web app … build now with opus but fable later". `apps/axhub-web` is a react-ts **developer app**
(`developer: { hub }`): approvals, the hub's state, app downloads and a route per planned hub area. It holds no hub
token — the browser's own hub session reads the feeds, and approving still happens on the hub's own page. Download
links are rebuilt from the hub address and checked, never taken from a reply. The hub's `/apps.json` gained
cross-site reads for the owner's own sites (axHub decision #90). The Fable follow-up (harvest the catalog rules into
lib-hub with a fixture and a Kotlin twin) is pending item `axhub-web-hub-rules`.

Also recorded that day: the **Patches web app** must follow the hub's appearance document like the other developer
apps — noted on pending item `patches-web-settings-notify`, which another session was building at the time.
