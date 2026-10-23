# The handoff prompt

Paste this into a new session on the new Claude account (claude.ai/code is best: it works on the repo itself).

```text
I'm moving my project "AmberX AXF" to this Claude account. Set everything up so development picks up exactly where it left off, built to the same spec and rules.

Source of truth: the GitHub repo MossesX/AmberX-AXF (private), branch main. Keep working on that same repo: never create a new repository, fork it or copy the project somewhere else; commit and push to MossesX/AmberX-AXF as before. The handoff kit is in _claude/handoff/ (kit built 2026-10-23, commit 5fd0b2831f21).

1. Open the repo https://github.com/MossesX/AmberX-AXF. In Claude Code (claude.ai/code): work in MossesX/AmberX-AXF itself (if access is refused, ask me to connect GitHub as MossesX and give the Claude GitHub app access to the repo). In a claude.ai chat: read it through the GitHub connector.
2. Read _claude/handoff/HANDOFF.md in full and follow it. It lists, in reading order, every instruction, rule, memory and spec file (all in the repo; CLAUDE.md imports the rules) and the files that lived outside the repo (claude.ai and ~/.claude on each machine), with their copies in _claude/handoff/.
3. Make the claude.ai Project: name "AmberX AXF", description from _claude/handoff/PROJECT.md, custom instructions = _claude/handoff/INSTRUCTIONS.md, knowledge = every file in _claude/handoff/context/. claude.ai has no API for Projects, so give me the name, description and instructions ready to paste and the list of files to upload, then wait while I create it.
4. Recreate the user-level files from _claude/handoff/user/ as _claude/handoff/USER-SCOPE.md says (user CLAUDE.md, commands, skills, agents, settings hooks, auto-memory) and point them at the repo files, not at copies.
5. Recreate the claude.ai-side items in _claude/handoff/CLAUDE-AI.md (Pending Builds page, connectors, memory).
6. Secrets: _claude/handoff/SECRETS.md has names only. Never invent or guess a value; ask me for each one and never write it into the repo, _claude/ or chat logs.
7. Go through _claude/handoff/SETUP.md and tell me what is done and what still needs me. Then follow the repo's rules (pick the model before any build, check the pending list) and don't build anything until I ask.
```
