# Agent manager (console plugin)

`ai.amberx.axf.console.agent-manager` · built on Opus (Oct 18 2026) · Fable rebuild pending (`agent-manager-plugin`).
Web console only for now.

## Model
An **agent** = persona + lingo packs + skills + tools + delegates + model + **memory** (its own type and settings).
- **Persona** — role, voice, tone, traits, rules. **Lingo** — glossary, preferred phrases, words to avoid, style.
- **Skill** — instructions, triggers, few-shot examples, the tools it needs.
- **Tool** — `builtin` (repo list/read/search, web fetch, memory search/save, Firecrawl scrape/search, time, calculator),
  `http` (headers use `env:VAR` for secrets; public hosts unless allowPrivate), `mcp` (Streamable HTTP), `prompt`, `agent` (delegate), `workflow`.
- **Memory** — none · buffer · summary · keyword (BM25) · vector (embeddings, keyword fallback) · hybrid (default).
  Records exchanges and/or extracted facts, keeps a rolling summary; topK, window, max items, decay, shared scopes.
- **Training** — Firecrawl scrape/crawl/search, URL, repo globs, text, MCP resource/tool → chunked knowledge; manual/hourly/daily/weekly.
- **Workflows** — sequential, parallel (+ merge), router, critic (draft → review → revise).

## Wizards (dialog `agent-manager.wizard`, `{ kind }`)
`builder` (all-in-one: create or reuse persona, lingo, skills, tools; memory; training — one `/compose` call, rolled back on error) ·
`agent` · `skill` · `tool` (then test it) · `training`. Launch from the view header, Settings → Plugins → Agent manager → Wizards, or the action `agent-manager.wizard:<kind>`.

## Add-ons (`agent-addon@1`)
```json
{ "$axf": "agent-addon@1", "id": "my-addon", "name": "…", "version": "1.0.0", "description": "…",
  "provides": { "personas": [], "lingo": [], "skills": [], "tools": [], "agents": [], "workflows": [], "training": [],
                "memory": { "<agentId>": [{ "kind": "knowledge", "text": "…", "source": "…" }] } } }
```
Namespace entity ids with the add-on id (`my-addon.persona`). Bundled: **coder** = **Mosses** (v2: street-gangster persona, React/TS/Python, container write mode; Coder 1.x is migrated on start, memory kept), **axf-expert**
(trains daily on this repo's docs), **ai-expert** (trains weekly with Firecrawl once a key is set). Import from JSON or a
URL; export any agent as a bundle. Uninstalling an add-on removes exactly what it added (and its agents' memory).

## Containers and safety (Mosses)
- Builtin container tools (`server/containers.py`), all **dangerous**: `container_list`, `container_read`, `container_list_dir`,
  `container_search` (read at once) and `container_write`, `container_delete`, `container_exec`, `container_restart`,
  `container_redeploy` (only *propose*: staged into the assistant turn's change batch, approved on a card, snapshot first).
- Settings → Plugins → Agent manager → **Safety**: only ticked agents get dangerous tools (default: `coder`). Personas
  and skills can't change it. Container tools appear only with `axf.containers@1`; proposal tools also need `axf.snapshots@1`.
- Agents have a **voice slot** (`voice: {provider, voiceId, hint}`), empty until a voice plugin provides voices.

## Integration (capability services, never folder names)
- Provides **`axf.agents@1`**: `list_agents()` (+ `dangerous`), `get_agent(id)` (+ `voice`, `writeMode`), `run_tool(id, name, args, ctx)` (ctx `stage` collects proposals), `memory_context(id, query)`, `record_turn(id, user, reply, meta)`.
- Consumes **`axf.llm@1`** when available (the AI assistant's providers); otherwise Settings → Plugins → Agent manager → Model.

## Lifecycle (plugin-lifecycle@1)
Data: `.axf-console/plugins/agent-manager/` (collections, `memory/`, imported `addons/`, `runs.json`, `settings.json`).
```bash
node apps/console-web/plugins/agent-manager/install.mjs
node apps/console-web/plugins/agent-manager/uninstall.mjs            # data only (backed up)
node apps/console-web/plugins/agent-manager/uninstall.mjs --all      # + code (bundled add-ons too) + doc lines; --publish pushes the removal
python3 apps/console-web/plugins/agent-manager/test.py               # self-test, scripted fake model
```
