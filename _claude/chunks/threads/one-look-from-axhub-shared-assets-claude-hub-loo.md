<!-- memory-chunk@1 source=_claude/THREADS.md tokens=321 -->
### One look from axHub + shared assets (`claude/hub-look-all-assets`)
- **Asked (Brett, Nov 1 2026):** "The apps should only get appearance from axhub period." "If you select design package in one app it changes it for all! Any theme change applies to all." "They all gotta ship all assets that can be shared bruh!" "Scrap patches and demo and walkthrough" (from this build).
- **Model:** built on Opus in claude.ai (Brett picked it; headless Fable was out of weekly credits until Tue Nov 3). Follow-up: Fable review of the contract parts.
- **On the branch:** everything in `_claude/builds/reports/hub-look-all-assets.md`. PR open; auto-merge takes it when CI is green.
- **Left:** if CI is red, fix it on the branch. Then a Fable review (appearance@1 `settings`, `shared` flag). Kotlin twin when Android work resumes.
- **Checks:** `npx -y tsx framework/spec/check-hub-look.mts`, `node framework/cli/shared-assets.mjs check`, `node framework/cli/help-coverage.mjs --check`, `npx -y tsx apps/console-web/scripts/menu-reach.mts`, app tests, `npx tsc --noEmit` in the three apps.
- **First message:** "Carry on thread 'One look from axHub + shared assets': check PR CI for claude/hub-look-all-assets, fix anything red, then run the Fable review of the appearance@1 settings contract."
