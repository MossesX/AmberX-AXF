<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/agent-manager-plugin.md lines=51-66 tokens=338 -->
## Contract / API / settings / fixture changes (old → new)
| What | Old | New |
|---|---|---|
| Definition format | implicit (Python validators) | `agent-definition@1` in `framework/core` + Kotlin + Python, fixture `spec/fixtures/agents.json` |
| Kernel capability | — | `axf.agents` (placeholder on Android; `axf.agents@1` is the console service) |
| plugin.json | v0.1.0, optional `axf.llm@1` | v0.2.0, optional `axf.llm@1`, `axf.containers@1`, `axf.snapshots@1`; `uiEditor: ["builder"]` |
| Routes | — | `+ GET /contract`, `POST /validate/{coll}`, `POST /workflows/{id}/run/stream`, `GET /memory`, `GET /export` |
| `GET /status` | basic | + version, contract, services, safety, dangerousBuiltins, memoryKinds, workflowModes, schedulerTick |
| Settings keys | unchanged | unchanged (defaults now bounded) |
| Data files | unchanged | unchanged; `migrate()` adds `dangerous:false` to tools and `memory:{}` to agents that lacked them |
| `agent-addon@1` | items validated partly | every item validated; forward references allowed |
| CLAUDE.md / plugins README | Opus lines | rebuilt lines (same `<!-- axf-plugin:agent-manager -->` marker) |

Compatibility: apps and plugins using `axf.agents@1` need no change. Existing `.axf-console/plugins/agent-manager/`
data loads as is. Web callers of `/c/{coll}` get the same records; new optional fields only.
