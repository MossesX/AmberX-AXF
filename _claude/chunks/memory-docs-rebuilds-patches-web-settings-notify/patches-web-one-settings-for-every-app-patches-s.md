<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/patches-web-settings-notify.md lines=1-11 tokens=210 -->
# Patches web + one Settings for every app + Patches serves notifications — report (Opus, Oct 21 2026)

**What Brett asked:** build the web port of Patches; make Patches responsible for serving all Android notifications;
when the Console, Pilot or axHub run inside Patches, take their settings hooks away and combine all three apps'
settings and Patches' own into **one settings interface with 4 tabs** (one per app), with a hook to it in Patches'
**application menu** and **context menu**. Built now on Opus; the Fable rebuild is parked as pending
`patches-web-settings-notify` (Pending Builds page). Build manager entry `chg-20261021-7f3c91a2b4`.

Repos: AmberX-AXF branch `rebuild/patches-web-settings-notify` (on top of `feat/patches-banners`, PR #7), axHub
`feat/embed-host` (PR #2, decision #89), Build-Pilot `feat/patches-settings`.
