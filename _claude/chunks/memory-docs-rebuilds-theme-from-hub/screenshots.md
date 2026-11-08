<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/theme-from-hub.md lines=88-95 tokens=136 -->
## Screenshots

`theme-from-hub/shots/{before,after}/` (phone + desktop): `settings-appearance`, `app-tabs`, `theme-manager`, and
after-only `waiting-for-hub` (the console with the hub stopped). After shots were taken against a local axHub
(`--web-port 5199 --env AXF_APPEARANCE_HUB=http://127.0.0.1:18080`, signed in as admin); a swap in the console was
verified on the hub (`GET /data/shared/settings/appearance.json` showed it, and the hub's login page picked up the
palette) and a PUT on the hub was verified to re-theme the console live.
