<!-- memory-chunk@1 source=_claude/shared/rules/RULES.md tokens=149 -->
## Before building anything

- **Screenshots that aren't for approval go to Screenshots, not the review queue (Nov 1 2026, Brett):** a session checking a screen (e.g. the Breakroom), live captures, PR before/after and other ad-hoc pictures are saved with `axf shot <file> --name "…" --app <app> --screen <route> --group "…"` (`node framework/cli/shot.mjs`, or `POST /api/plugins/ui-review/shots`), which lands in UI Review → **Screenshots** and never waits for approve / reject; Brett can still *Send to review* one. Only planned UI goes through `review.mjs submit`. <!-- axf-plugin:ui-review -->
