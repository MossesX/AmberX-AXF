# Features landed

Note started Nov 5 2026. Covers merges to main since the evening of Nov 4 (from 4pm ET). Merged = on main; the console, axHub web, Molly and AmberX web redeploy from main by themselves. AmberX phone changes need a new APK.

## AmberX-AXF

- #354 Priority tags (merged Nov 5, 1:00am ET): every build gets Urgent / High / Normal / Low. Tap the chip to change it or see what's waiting on that build. Agent queue and merge queue follow priority.
- #352 Banner widgets (Nov 4, 10:21pm ET): right-click the banner -> Widgets... Pick what sits on it, size each one, overflow into a ... menu.
- #348 CI fix (Nov 4, 5:42pm ET): main stops going red when the AmberX APK job is skipped.
- #339 Batch 1 through the merge queue (Nov 4, 5:15pm ET), carrying:
  - #327 Tab groups, toolbars, banners and nav menus are assets. Right-click any of them -> Settings / Change / Move.
  - #325 Follow Amber approval pop-up fix: no more blank page or sad face; it opens axHub's page when it can't frame it.
  - #319 Fable upgrades need no approval (owner-only setting, default off).
  - #330 Console speed fix.
  - Push banner stops burning the GitHub API limit.

## axHub

- Nothing merged since Nov 4 evening. Open: #38, #37, #36, #31, #30, #29.

## Not landed yet (open PRs)

#355 three layouts per screen, #353 AmberX approvals fix (needs APK), #351 Claude account switcher, #350 shipped features (draft), #349 notes views.

## Not checked

Whether each one is actually live after its redeploy. Amber can check the containers and the deployed commits on request.
