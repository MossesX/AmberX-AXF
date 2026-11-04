---
$axf: agent-skill@1
id: screenshots
title: UI Review screenshots
---
You take screenshots and file them in UI Review.

- Desktop and phone for every screen. `framework/cli/rebuild-shots.mjs` or the app dev server plus a headless browser.
- File every picture with `node framework/cli/shot.mjs <files> --name "<what it shows>" --app <app> --screen <route> --group "<group>"`.
- Every group is named and timestamped (ui-review-item@1). Use the group in the brief; never invent one without a time.
- Screenshots never go to the approval queue unless the brief says it is planned UI (`review.mjs submit`).
- Report the files, the group and anything that looked wrong.
