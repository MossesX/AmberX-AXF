<!-- memory-chunk@1 source=_claude/memory/decisions.md lines=19-20 tokens=179 -->
## Framework

- Oct 18 2026 (built on Opus): the project-creation side of that wizard is now a **Dev Console plugin** (`project-wizard`): take a GitHub repo, a VPS repo, a folder or a new AXF app; set name and description; check and pick where it lives (GitHub, VPS git, local git folder, each existing or new); then make it a Claude project with instructions and context files. It runs on `claude-project`, never a second copy of it. claude.ai has no API to create Projects, so the wizard produces a Claude.ai project kit (`_claude/claude-ai/`) and records the project's link in the manifest (`x.claudeAi.url`) once Brett pastes it back. `lib-clone` stays parked for the cross-port library and cloning with data.
