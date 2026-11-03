# notes-vault: Brett's saved notes in one place

Build `notes-vault` (Urgent profile), branch `claude/notes-vault`, Nov 3 2026, Opus.

## s1 Inventory (written before anything moved)

Found by reading the hub's version metadata (`/projects/.axhub/{claude,data}/*/meta.json`, entries with
`updatedBy: ai_client:owner via mcp`) and by listing every loose `.md`/`.txt` across `/projects`, then dropping system
files (THREADS, STATUS, decisions, RULES, persona, README, builds/**, handoff/** package, memory/docs/**, reports,
shots, tracked rules/instructions/memory that sessions load).

| Old path (hub) | Kind | Who wrote it | New path (`/projects/_shared/_claude/`) |
| --- | --- | --- | --- |
| amberx-axf `_claude/fuck-you.md` | kickoff prompt for the other account | owner via MCP, Nov 1 | `notes/handoffs/kickoff-prompt-other-account-2026-11-01.md` |
| amberx-axf `_claude/memory/handoff-2026-11-01.md` | handoff | owner via MCP, Nov 1 | `notes/handoffs/handoff-2026-11-01.md` |
| amberx-axf `_claude/memory/handoff-2026-11-02.md` | handoff | owner via MCP, Nov 2 | `notes/handoffs/handoff-2026-11-02.md` |
| amberx-axf `_claude/memory/handoff-2026-11-03.md` | handoff | owner via MCP, Nov 3 | `notes/handoffs/handoff-2026-11-03.md` |
| amberx-axf `_claude/sessions/2026-11-01.md` | session log | owner via MCP, Nov 1 | `notes/sessions/2026-11-01.md` |
| amberx-axf `_claude/sessions/2026-11-02.md` | session log | owner via MCP, Nov 2 | `notes/sessions/2026-11-02.md` |
| amberx-axf `_claude/plans/axhub-vault-management.md` | plan | owner via MCP, Nov 2 | `notes/plans/axhub-vault-management.md` |
| amberx-axf `_data/sessions/2026-10-31-amber-voice.md` | voice session log | owner via MCP, Nov 1 | `notes/sessions/2026-10-31-amber-voice.md` |
| amberx-axf `_data/plans/shelved-hr-department.md` | parked plan | owner via MCP, Nov 1 | `notes/plans/shelved-hr-department.md` |
| amberx-axf `_data/plans/product-pivot-dev-environment.md` | plan / decision | owner via MCP, Nov 1 | `notes/plans/product-pivot-dev-environment.md` |
| amberx-axf `_data/framework/plan/specs/prompt-profiles-and-queue-reconciler.md` | voice-call spec | hand-saved, Oct 31 | `notes/plans/prompt-profiles-and-queue-reconciler-2026-10-31.md` |
| shared `_data/quick-docs.md` | saved commands ("make a command") | hand-saved, Oct 28 | `notes/commands/quick-docs.md` (one-line pointer left at the old path) |
| VPS `~/hub/notes/auto-deploy.md` | install / deploy notes | hand-saved, Oct 16 | `notes/install/auto-deploy.md` (one-line pointer left at the old path) |
| repo `install_instructions.md`, `install_steps.md` | the install notes Brett remembers | repo docs (linked from rules and code) | stay in the repo; `notes/install/install-guides.md` points at them |

Not moved, on purpose:
- `/projects/_shared/_data/dns/log.md`: the DNS log the shared rules write to by path.
- Tracked `_claude/` rules, instructions and memory (`memory/amberx-axf.md`, `instructions/builds-one-page-foldin.md`,
  `shared/memory/*.md`, `shared/rules/preferences.md`, …): loaded by sessions, not loose notes.
- `/projects/projects/…`: a stale nested copy of the tree (Oct 31); left alone, flagged here.
- `/root/*.txt` (keys, forensics): may hold secrets; secrets never go to the hub.
