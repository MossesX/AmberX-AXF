# _claude (axhub-projects@1)

Brett's Claude files for **walkthrough-studio** (the `name` in `project.manifest.json`). Synced with the hub:
this folder ↔ `/projects/walkthrough-studio/_claude/`, `shared/` ↔ `/projects/_shared/_claude/` (applies to every project),
and the manifest's `data.shared` paths ↔ `/projects/walkthrough-studio/_data/<same path>`. A SessionStart hook
(`claude-sync start`) syncs and loads it in every Claude Code session; run `claude-sync sync` after editing.
Never store secrets.

| Folder | What goes there |
| --- | --- |
| `rules/` | Hard rules Claude must follow (model choice, secrets, approvals, conventions that must not be broken). |
| `instructions/` | How to work: procedures, checklists, setup and deploy guides, prompts for recurring tasks. |
| `memory/` | Facts, context and decisions: about Brett, his tools and devices, the project's history, status and decision log. Anything in a docs/ folder is listed at session start and read on demand. |
| `shared/` | The same three sections for everything that applies to all projects. Edit here or in any project; it syncs everywhere. |

If a file changed both here and on the hub, sync holds it and asks which to keep: `claude-sync status`,
then `claude-sync resolve <id> --keep local|hub`.
