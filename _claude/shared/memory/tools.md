# Devices and tools

- Phone: Samsung Galaxy S26 Ultra. Uses **Moshi** (mosh client) to reach the VPS; wanted real-time voice-to-text for voice notes.
- VPS: Hostinger, Claude Code and mosh installed, mosh ports open, Coolify for every web app (Traefik proxy holds 80/443).
- Wants his Claude Code subscription working across the VPS, his computer and his phone, all connected to GitHub and the VPS so everything works together.
- Has Claude push his app projects to GitHub (`MossesX`) entirely from his phone; a new repo must exist on GitHub before a session can push to it.
- Claude Code CLI, desktop app, VS Code extension and claude.ai keep separate session histories (sessions live in `~/.claude/projects/`); `--remote-control` bridges a live CLI session, `/export` saves a readable transcript. `_claude/` + the hub's `/projects` is how sessions share context.
- Launcher (AmberX-AXF `deploy/claude-pick.sh --install`): `claude` asks Claude plan or API key, then the model, before starting.
- Sync: `claude-sync` (axHub repo `clients/claude-code/claude-sync.mjs`).
