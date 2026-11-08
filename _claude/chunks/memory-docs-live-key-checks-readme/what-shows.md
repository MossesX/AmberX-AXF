<!-- memory-chunk@1 source=_claude/memory/docs/live-key-checks/README.md tokens=204 -->
## What shows
- **Keys banner** turns red when a key is dead, expired or under-scoped: "GitHub token is broken", what broke, what it
  breaks, since when; **Fix** (paste a new one, tested before it's saved) and **New key** (GitHub's token page,
  pre-filled with Contents / Pull requests / Actions / Workflows). Amber a week before the GitHub token expires.
- **Systems check banner** says "N broken: …" with each item's *Breaks:* line and since-time: stuck builds (no heartbeat
  30 min, launches that exited at once), git push credentials on the VPS checkout, CI on main, containers in a restart
  loop, disk over 85%, hub calls denied or expired, ntfy, the push path to AmberX, Claude sign-in, OpenAI/ElevenLabs.
- Every new red item is pushed once to AmberX (console alert `system:<id>`); green again closes it.
