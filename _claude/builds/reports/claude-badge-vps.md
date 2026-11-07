# claude-badge-vps

Build `claude-badge-vps` (Opus). Covers s18 of `token-usage-log-accounts-plan-studio-control` (s34 + s35 of its small-steps build).

## What changed
- New banner badge `badge/claude-vps`: the Claude Code login on the VPS, read with plain code (no model call). `GET /api/plugins/claude-badge/vps`.
- States: green logged in, amber limit hit, red not logged in or expired, grey when the VPS can't be read. An unreadable VPS never shows as logged out.
- Settings per badge: Show on the banner, Icons only (the framework's `icon` badge shape), an icon per state. New keys `claude-badge.{console,vps}.{show,icon-only}` and `claude-badge.vps.icon.*`. The existing `claude-badge.icon.*` keys are unchanged.
- Hiding the console badge stops its load-time test (no tokens); Test again still works.
- `axf.claude-accounts@1.view()` also returns `checked` and `expiresAt`. `axf.ai-keys@1` gains `limited_at(name)`.
- Framework: `[data-fx-wsize]:has(> .fx-banner__pop)` drops the widget's size cap on wider screens, so a pop-out sits beside its widget instead of squashing it and covering the neighbours. Re-baked into console-web, axhub-web, amberx-droid and molly.

## Known gaps
- Limit detection is only as good as the mark: a hit is recorded when a headless build stops on a limit. A limit hit in an interactive session leaves no mark. There is no zero-token way to ask whether a limit has reset, so the amber state lasts 24 hours (the AI keys window) unless the account changes.
- On a phone the 5-second pop-out still draws over the neighbouring widgets, as it did before this build. Releasing the cap there pushes every widget into the More menu, because the banner's fit logic measures the widget with its pop-out. A real fix belongs in `useBannerOverflow`.
- The console test still costs one tiny request per load while its badge shows.

## Tests
- claude-badge test.py: 40 checks passing, 14 of them new for the VPS read. ai-keys test.py and claude-accounts test.py extended (133 and 54 passing).
- Browser check against mocked routes: every state, Icons only, picked icon, hide and show, desktop and phone. Not run against the live VPS read: the route ships with the console deploy.
