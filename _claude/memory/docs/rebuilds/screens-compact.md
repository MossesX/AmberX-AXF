# Compact screens pass 2 — every plugin page (Angel `screens-compact`, Oct 30 2026, Opus + 3 sub-agents)

Brett (Oct 30 2026): "More compact screens" and "it's compacting all the plugins too, right?" Branch `claude/angel-screens-compact` (merges `claude/angel-compact-plugins-a`, `-b`, `-c`).

## Core screens (lead)
- Build orchestrator: category chips, "Next on Fable/Opus" and sort chips → one toolbar of dropdowns (+ Grid/List); one-line description.
- Home: 5 page buttons → Open project + Tracker + ⋯ (output terminal, export plan, console token); one-line description.

## Plugins (sub-agents; only their own folders)
- A: agent-manager, ai-assistant, claude-handoff, session-checkin, project-wizard, voice-notes — page heads one line + ⋯ menus, tabs → dropdown on phones, chip walls → dropdowns, flat one-line rows, wizards "Step x of n" on phones. mcp-client not done (pages come from framework/libs/mcp → in `ui-all-assets`).
- B: theme-manager, brand-library, context-menu-designer, plugin-update, plugins-menu, todo-manager, codebase-changes — toolbars of 1–2 buttons + ⋯, chip walls → dropdowns, one-line rows, filters behind a toggle, dialogs fit phones.
- C: build-manager, changes-grid, fable-rebuilds, build-breaker, feature-matrix, design-packs, plugin-manager, systems-check, ai-keys — one-line heads, chip strips, dropdown filters, one-line rows, phone column sets. Banners (activity, push, approvals) and plugin-switches were already compact.
Every action stays reachable (moved into ⋯ menus, dropdowns or toggles, never removed).

## Known gaps
Plugin Manager dialog's last quick-action icon clips on a phone; its Mission/Terminal/Catalog layouts untouched; Systems check summary truncates without "…". Pre-existing test failures (same on the base): fable-rebuilds test.py "plugin-manager rebuild replaces the Opus plugin", claude-handoff test.py "POST /session…", lifecycle stale refs for session-checkin / project-wizard.

## Screenshots
Before/after per plugin: `/home/claude/work/cp-{a,b,c}-shots/` (session-local); core screens in `screens-compact/shots/`.
