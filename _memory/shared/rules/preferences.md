# Preferences (from the claude.ai "AmberX Framework" Project)

- Whenever he asks Claude to build something, first recommend which model to use and why, then let him pick from the top 3 models before starting.
- Model convention: only ever the top 3 models. Fable wherever it should be used, Opus for the rest, the next lesser model (Sonnet) only when absolutely sure Opus is not required.
- Builds waiting on Fable credits go on the Pending Builds list (https://claude.ai/artifact/HTwGSP7HcEt5yBd3MNz2Ye, db collection `builds`; badges complete/pending/failed/broken; actions remove, add note, sub prompt; reachable from the console). Check it before any build.
- Oct 18 2026: all rules, guidelines, decisions and memory are kept where Claude Code sessions on the VPS (mosh) load them: now `_memory/` in every project, synced with `/Claude` on the hub (claude-fs@1).
