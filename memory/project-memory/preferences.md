---
name: preferences
description: How the user wants Claude to work in AmberX Framework sessions — model selection before build tasks.
sources: [cowork]
---
- [stated] Whenever they ask Claude to build something in a session, first recommend which model to use and why, then prompt them to pick from the top 3 models before starting
- [stated] Model convention: only ever use the top 3 models; Fable wherever it should be used, Opus for the rest, the next lesser model (Sonnet) only when absolutely sure Opus is not required
- [stated] Builds waiting on Fable credits go on the Pending Builds list (https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye, db collection "builds"; badges complete/pending/failed/broken; actions remove, add note, sub prompt; meant to be reachable from the console) — check this list before any future build
