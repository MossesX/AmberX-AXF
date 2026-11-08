<!-- memory-chunk@1 source=_claude/memory/docs/banner-status-bell.md tokens=364 -->
## Screenshots

Before = `bbef259` (main), after = this branch; fake GitHub run (green, "Android framework + console" #812) and
3 unread alerts set for the shot. The PNGs are palette-shrunk by `shrink-shots.py`, so the small dot's green can look
grey in the phone shots; the computed colour was checked in the browser (`--fx-success`).

| | before | after |
| --- | --- | --- |
| Banner, desktop | ![](banner-status-bell/shots/before/banner-desktop.png) | ![](banner-status-bell/shots/after/banner-desktop.png) |
| Banner, phone | ![](banner-status-bell/shots/before/banner-phone.png) | ![](banner-status-bell/shots/after/banner-phone.png) |
| Tap the dot (phone) | — | ![](banner-status-bell/shots/after/build-run-phone.png) |
| Tap the dot (desktop) | — | ![](banner-status-bell/shots/after/build-run-desktop.png) |
| Settings → Plugins → Alerts bell | — | ![](banner-status-bell/shots/after/settings-desktop.png) |

Re-take (fake GitHub on port 18765):

```bash
python3 _claude/memory/docs/banner-status-bell/shots/fakegh.py 18765 &
AXF_APPEARANCE_HUB=off GITHUB_TOKEN=fake GITHUB_API_URL=http://127.0.0.1:18765 \
  node framework/cli/rebuild-shots.mjs --repo . --out _claude/memory/docs/banner-status-bell/shots \
  --shots _claude/memory/docs/banner-status-bell/shots/shots.json --label after
```

Note: `rebuild-shots.mjs` keeps only the last `--env` flag (its argument parser builds an object), so set extra
variables in the environment, as above.
