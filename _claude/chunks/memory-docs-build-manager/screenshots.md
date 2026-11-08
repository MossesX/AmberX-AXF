<!-- memory-chunk@1 source=_claude/memory/docs/build-manager.md tokens=431 -->
## Screenshots

0.2.0 (Live, Built, search, Start build now, session builds on the banner):

<img src="build-manager/shots/live-phone.png" width="260"> <img src="build-manager/shots/built-phone.png" width="260"> <img src="build-manager/shots/search-phone.png" width="260"> <img src="build-manager/shots/start-phone.png" width="260">

![Built tab with totals](build-manager/shots/built-desktop.png)
![Live tab](build-manager/shots/live-desktop.png)
![Search across tabs](build-manager/shots/search-desktop.png)
![Start build now](build-manager/shots/start-desktop.png)

Re-take 0.2.0: `AXF_APPEARANCE_HUB=off AXF_CHANGES_DIR=<copy of changes/> node framework/cli/rebuild-shots.mjs --repo . --out _claude/memory/docs/build-manager --shots _claude/memory/docs/build-manager/shots/shots-v2.json --label shots` (pass these through the environment: the script keeps only the last `--env`).

0.1.0 phone:

<img src="build-manager/shots/tracker-phone.png" width="260"> <img src="build-manager/shots/view-phone.png" width="260"> <img src="build-manager/shots/needs-split-phone.png" width="260"> <img src="build-manager/shots/settings-phone.png" width="260">

Desktop:

![Build manager list](build-manager/shots/view-desktop.png)
![Live tracker](build-manager/shots/tracker-desktop.png)
![Banner after the Activity banner](build-manager/shots/banner-desktop.png)
![Needs split filter](build-manager/shots/needs-split-desktop.png)
![Settings → Plugins → Build manager](build-manager/shots/settings-desktop.png)

Re-take: `node framework/cli/rebuild-shots.mjs --repo . --out _claude/memory/docs/build-manager --shots _claude/memory/docs/build-manager/shots/shots.json --label shots` (seeds three reports in the scratch activity feed).
