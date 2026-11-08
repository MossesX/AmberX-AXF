<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/banner-assets.md lines=53-64 tokens=284 -->
## Screenshots (web console, before = Opus `d2f58a9`, after = this branch)
Banner on the home view (logo, Claude badge, search in the centre, clock right); visually unchanged by design — the rebuild is engine/API/Android work.

| | before | after |
|---|---|---|
| phone | ![before](banner-assets/shots/before/banner-home-phone.png) | ![after](banner-assets/shots/after/banner-home-phone.png) |
| desktop | ![before](banner-assets/shots/before/banner-home-desktop.png) | ![after](banner-assets/shots/after/banner-home-desktop.png) |
| Appearance → Assets (banner slot, hideable) phone | ![before](banner-assets/shots/before/appearance-assets-phone.png) | ![after](banner-assets/shots/after/appearance-assets-phone.png) |
| Appearance → Assets desktop | ![before](banner-assets/shots/before/appearance-assets-desktop.png) | ![after](banner-assets/shots/after/appearance-assets-desktop.png) |

Android screens affected (Android screenshots pending CI): every screen of the Android console (banner above the layout, phone + desktop window classes), the banner's badge pop-out, hidden-banner state (Settings → Appearance → Banner → Hidden).
