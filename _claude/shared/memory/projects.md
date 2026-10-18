# Projects on the hub (each has a manifest, `_claude/` and `/projects/<name>/` on the hub)

Only projects built with or for the AmberX framework, plus axHub itself, live in the hub's `/projects`.

- **AmberX AXF** (`MossesX/AmberX-AXF`, private) → `amberx-axf`: cross-platform app framework (Android Kotlin/Compose, React/TS, Python later) where every UI piece is a hot-swappable asset. Its apps are projects too: `axf-demo` (axf.amberxai.com), `axf-console-web` (Dev Console, console.amberxai.com; its own repo `axf-console` is reserved, not created), `axf-console-android`.
- **axHub** (`MossesX/axHub`) → `axhub`: his connector hub on the VPS (one MCP server in front of his apps, APIs and devices); serves `/projects`.
- **AmberX Studio**: earlier planned project-management / app-building suite on the AmberX framework (Next.js + Python). Notes: `projects/amberx-studio.md`. `MossesX/studiox` is a separate earlier line; `MossesX/amberx` is the dormant PyQt6 framework.
