# Live key + health checks in the banners (Angel `live-key-checks`, Oct 30 2026)

Brett (voice): the console's `GITHUB_TOKEN` went dead (GitHub 401) and nothing told him. "You need to make sure things
like that go into one of the banners. I need to see that kind of shit."

Built in the systems-check plugin (it owns both the Keys banner and the systems check banner). Details and the
health@1 API: the plugin README (section *Live key + health checks*). Rule:
`_claude/shared/rules/RULES.md` → *Broken = a banner item with a fix*.

## What shows
- **Keys banner** turns red when a key is dead, expired or under-scoped: "GitHub token is broken", what broke, what it
  breaks, since when; **Fix** (paste a new one, tested before it's saved) and **New key** (GitHub's token page,
  pre-filled with Contents / Pull requests / Actions / Workflows). Amber a week before the GitHub token expires.
- **Systems check banner** says "N broken: …" with each item's *Breaks:* line and since-time: stuck builds (no heartbeat
  30 min, launches that exited at once), git push credentials on the VPS checkout, CI on main, containers in a restart
  loop, disk over 85%, hub calls denied or expired, ntfy, the push path to AmberX, Claude sign-in, OpenAI/ElevenLabs.
- Every new red item is pushed once to AmberX (console alert `system:<id>`); green again closes it.

## Screenshots (fake dead GitHub token, scratch console)
| Phone | Desktop |
|---|---|
| ![banners phone](shots/banners-phone.png) | ![banners desktop](shots/banners-desktop.png) |
| ![keys dialog phone](shots/keys-dialog-phone.png) | ![keys dialog desktop](shots/keys-dialog-desktop.png) |

Taken with `framework/cli/rebuild-shots.mjs` (`AXF_APPEARANCE_HUB=off`). In headless Chromium the banner strip kept
`data-fx-empty="on"` although its banners had content (framework `useStripEmpty`, `framework/react/components/Slots.tsx`),
so the shots add a style that shows the strip anyway. Worth a look in a real browser: if the strip ever hides real
banners there, nothing here can be seen.

## Findings on this checkout while testing
- `git push --dry-run` from this worktree fails: no GitHub credentials for pushing (the new git-push check reports it).
- The change log has builds with no heartbeat for over 30 minutes (the stuck-builds check lists them).

## Follow-ups
- After `claude/pr-only-merge` lands: move the push banner's token check onto health@1 (orchestrator step s7).
- enterprise-branding (`claude/enterprise-branding-3`) restyles these banners: the UI uses framework controls, theme
  tokens and the existing `axp-systems-check-*` classes only.
