<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=130 -->
## Dev Console

- **Oct 19 2026 — plugin catalog on axHub (plugin-catalog@1).** Plugins installable by any app live in /projects/_shared/_data/plugin-catalog (Brett picked "a catalog on axhub"). Engine in the framework (`framework/cli/plugin-catalog.mjs`); the console installs console plugins and commits them to GitHub so they survive the 5-minute reset; other apps (Build Pilot) read packages through the console and install on their side. Published versions are immutable. Opus; no Fable rebuild (security/web work).
