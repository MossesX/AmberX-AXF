# _memory (claude-fs@1)

Brett's Claude memory for **amberx-axf**. Synced with the hub: this folder ↔ `/Claude/projects/amberx-axf/_memory/`,
`shared/` ↔ `/Claude/_memory/shared/` (applies to every project), and the paths in `data.json` ↔
`/Claude/projects/amberx-axf/data/<same path>`. Run `claude-sync sync` after editing; a SessionStart hook syncs
and loads it at the start of every Claude Code session. Everything here is committed to git. Never store secrets.

| Folder | What goes there | At session start |
| --- | --- | --- |
| `rules/` | Hard rules Claude must follow (model choice, secrets, approvals, conventions that must not be broken). | loaded |
| `instructions/` | How to work: procedures, checklists, setup and deploy guides, prompts for recurring tasks. | loaded |
| `memory/` | Facts and context: about Brett, his tools and devices, people, the project's history and status. | loaded |
| `decisions/` | Decision log: what was decided, when and why. Append; supersede instead of deleting. | loaded |
| `docs/` | Reference documents: specs, architecture, plans. Listed at session start, read on demand. | listed |
| `sessions/` | Session logs and check-in records written by tools (session-log@1). | listed |
| `inbox/` | Quick notes to file into the right section later. | listed |
| `shared/` | The same sections for everything that applies to all projects. Edit here or in any project; it syncs everywhere. | loaded |
| `data.json` | Repo paths that are this project's live data (`claude-data@1`). | — |

If a file changed both here and on the hub, sync holds it and asks which to keep: `claude-sync status`,
then `claude-sync resolve <id> --keep local|hub`.
