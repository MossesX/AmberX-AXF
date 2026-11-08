<!-- memory-chunk@1 source=_claude/shared/instructions/projects-and-sync.md tokens=266 -->
## Where things are
| What | In a project | On the hub (`/projects`, its own Docker volume) |
| --- | --- | --- |
| Manifest | `project.manifest.json` (project-manifest@1) | `/projects/<name>/_data/project.manifest.json` |
| Claude files | `_claude/` (rules/, instructions/, memory/) | `/projects/<name>/_claude/` |
| Shared Claude files (every project) | `_claude/shared/` (same sections) | `/projects/_shared/_claude/` |
| Shared data | the manifest's `data.shared` paths, where they are in the project | `/projects/<name>/_data/<same path>` |
| Outside any project | `~/.config/claude-sync/shared/` | `/projects/_shared/_claude/` |

`<name>` is the manifest's `name`. A repo can hold several projects: every folder with a manifest is one
(AmberX-AXF holds `amberx-axf` at its root plus `axf-demo`, `axf-console-web` and `axf-console-android` in `apps/`).
Layout schema: `clients/claude-code/projects.schema.json` in the axHub repo. Manifest schema and rules:
`framework/schemas/project-manifest.json` and `framework/schemas/project-rules.json` in AmberX-AXF.
