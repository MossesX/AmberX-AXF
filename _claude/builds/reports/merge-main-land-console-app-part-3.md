# merge-main-land-console-app-part-3

Build: merge main into `claude/console-app-part-3-native-bridge-mic` (PR #633) so auto-land can land it.

## Result
- `origin/main` merged into the PR branch with no conflicts. The `framework/ui/axf.css` clash auto-land reported had already been resolved on the branch (bb1c29925, both blocks kept). Main moved on since then, and the new merge touched only builds files, `_claude/THREADS.md` and `apps/console-web/scripts/chrome-once.e2e.mjs`.
- Merge commit 6462de07b, pushed to `claude/console-app-part-3-native-bridge-mic`. No new PR.
- Step s8 ("split the console wrapper so it runs on four slots at the same time") is already in PR #633: `SlotRules`/`SlotHost`, the `slots.*` tools and `console-slots@1`. API reach is in the PR body: REST `POST /api/console/action {"action":"device.slots:open:…"}`, MCP `console_action`/`console_control`, CLI, voice.

## Checks
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass.
- `tracker.mjs --check`: passes against the repo's status.json (`AXF_DATA_DIR=off`, which is what CI uses). On this VPS it fails because the host data dir copy (`/projects/amberx-axf/_data/framework/catalog/status.json`) has no `cx.phonebridge` entry. That entry comes from this PR. The copy catches up once the PR lands.

## No UI change
This build changes no UI, so nothing went to UI Review.
