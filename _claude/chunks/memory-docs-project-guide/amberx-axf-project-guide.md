<!-- memory-chunk@1 source=_claude/memory/docs/project-guide.md tokens=605 -->
# AmberX AXF: project guide

The long part of CLAUDE.md, moved here on Nov 8 2026 (build memory-restructure) so it no longer loads in every
session. It is chunked into `_claude/chunks/` with the rest of the memory; read the chunk you need
(`grep -n "<topic>" _claude/chunks/INDEX.md`) or this file.

Cross-platform app framework where every UI piece (theme, layout, menu, toolbar, dialog, popup, button, slider, container, access policy) is a hot-swappable JSON asset in one shared format, `asset@1`. One framework, several ports: the **web port** (TypeScript reference engines + React) and the **Android port** (Kotlin/Compose, pure-Kotlin kernel). Apps built on it (starting with the Dev Console) define and extend the framework as they are built.

**Claude settings (Brett, Nov 3 2026):** at session start and before acting, read Claude settings (`claude_settings_get`, or `node apps/console-web/plugins/claude-settings/claude-settings.mjs get`) and follow them. Owner-only ones (No wait, Include irreversible, launch without asking, default model, UI Review gate, raising caps) change only with Brett's own click in the console. <!-- axf-plugin:claude-settings -->

**Fix it yourself (Brett, Oct 30 2026):** when something is broken and the tools at hand can fix it (a dead key, a stuck or crashed build, a failed launch, CI red, a restarting container, missing config), fix it straight away as a veto call with a plain reason, then tell him what was fixed. Never ask whether to fix it; ask only when it needs his hands (a new token on github.com, paying, a device) or a real choice, and then put it in a banner item with the exact steps.

**Threads and builds (read on every load):** `_claude/THREADS.md` lists every thread, its state, branch, PR and queued items. Read it first, pick up from it, and update + commit it whenever a thread starts, changes, opens or merges a PR, or queues an item. All build work lives in the repo (branches, PRs, this log), never only in chat.

Everything else Claude should know is in `_claude/` (axhub-projects@1, see `_claude/README.md`): `rules/`, `instructions/`, `memory/` (decisions in `memory/decisions.md`, specs in `memory/docs/`) and `shared/` for all projects. It syncs with the hub's `/projects/amberx-axf/_claude/` (and `shared/` with `/projects/_shared/_claude/`); the `claude-sync start` SessionStart hook syncs and loads it. Edit it, run `claude-sync sync`, commit.
