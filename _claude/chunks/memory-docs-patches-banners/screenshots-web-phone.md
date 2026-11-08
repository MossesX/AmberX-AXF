<!-- memory-chunk@1 source=_claude/memory/docs/patches-banners.md tokens=130 -->
## Screenshots (web, phone)
| Console page (no plugin banners) | Strip, expanded | Strip, minimized |
| --- | --- | --- |
| ![](patches-banners/shots/after/console-page-phone.png) | ![](patches-banners/shots/after/strip-phone.png) | ![](patches-banners/shots/after/strip-minimized-phone.png) |

Known gap: the strip sits above Patches' own banner bar (the Compose AppShell has no slot between its banner and
tabs; adding one is framework Android work, on hold). Kotlin written without a compiler: Android CI compiles it.
