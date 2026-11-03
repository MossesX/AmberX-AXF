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

## s2 Move (done Nov 3 2026, 13:50 UTC)

- Every move used axHub's memory-dir semantics (axHub `packages/storage-sqlite/src/memory-dir.ts`): the note was
  written at its new path (attribution in `/projects/.axhub/claude/shared/meta.json`), then removed from the old one
  with its content kept as a `delete` version in the old scope's `versions/` (so `axhub` history still has it).
  The axHub MCP tools weren't granted to this session, so the same on-disk format was written directly.
- Dates: the moved notes keep their original `updatedAt` in the hub meta (writer noted as "moved by notes-vault"), so
  "Newest" sorts by when Brett saved them, not by the move.
- Path references inside the notes were rewritten (kickoff prompt → `project "shared", path "notes/handoffs/…"`,
  handoff and session logs → `notes/plans/…`, `notes/sessions/…`). No rule, instruction or session-start code loaded
  the old paths (grep of the repo, `claude-sync` and the hub tree), so no loader pointer was needed. One-line pointers
  were left only where people or sessions append by habit: `/projects/_shared/_data/quick-docs.md` and
  `~/hub/notes/auto-deploy.md`.
- New instruction (`_claude/shared/instructions/projects-and-sync.md` → Saving): notes Brett asks to save go to
  `notes/<folder>/` in the shared Claude files plus a line in `notes/INDEX.md`. `claude-sync start` doesn't print
  `notes/` (it prints only rules/instructions/memory), so session start stays the same size.
- Repo: `_claude/fuck-you.md`, `_claude/memory/handoff-2026-11-01.md` and `sessions/2026-10-31-amber-voice.md` were
  tracked copies and are deleted on this branch; the notes now sync into `_claude/shared/notes/`.
- Side effect to know: checkouts that still have the old files will show `claude-sync` holds ("deleted on the hub,
  unchanged here"); keep hub. A fresh worktree made from main before this PR merges could push
  `memory/handoff-2026-11-01.md` back once; delete it again if it reappears.

## s3 New note
`notes/orchestrator/orch-live-sync-2026-11-03.md` (the build's appendix, verbatim).

## s4 notes-browser plugin
`apps/console-web/plugins/notes-browser/`: `server/store.py` (hub semantics, path guard: plain `folder/name.md|txt`,
no `..`, absolute paths, hidden files or links, 512 KB cap), `server/__init__.py` (routes + `axf.notes@1`),
`web/index.tsx` (two columns, search, Newest/Name, new note/folder, rename, move, delete with confirm, edit switch with
`if_version` save and a Reload button on conflict), tokens-only CSS, help pack (18 entries + intro), lifecycle files,
Settings → Plugins → Notes. Plugins menu + Builds menu entries.

## s5 MD Studio
md-studio s11 (Opus, 20m): Notes scope in the file column, reusing `axf.notes@1` (optional; hidden when absent).

## s6 Checks
- `python3 apps/console-web/plugins/notes-browser/test.py`: 28/28.
- `check-theme.mjs`, `check-controls.mjs`: pass. `help-coverage.mjs --check`: at the ratchet. `menu-reach.mts`: ok.
- `tsc --noEmit` (console): clean. `uninstall.mjs --all --dry-run`: no stale references.
- `plugin-lifecycle.mjs check notes-browser`: one local false positive, the gitignored Watch-live file
  `.axf-focus.json` naming the plugin; CI doesn't have it.
- Screenshots (desktop, phone, edit mode) sent to UI Review.
