<!-- memory-chunk@1 source=_claude/memory/decisions.md tokens=158 -->
## Dev Console

- Oct 19 2026: Fable rebuilds only where they're needed. Removed from both pending lists (repo + claude.ai page): `plugin-switches`, `claude-badge-plugin`, `theme-manager-plugin`, `feature-assist-plugin`, `terminal-plugin`, `systems-check-plugin`, `snapshot-manager-plugin`, `container-access-plugin` (web-only console plugins; security work is Opus by the model rule). Kept: `plugin-manager` (parked for Fable first), `ai-assistant-plugin` + `agent-manager-plugin` (Brett asked), `banner-assets` + `widget-assets` (cross-port engines, Kotlin written without a compiler). Rule tightened in `_claude/rules/RULES.md`.
