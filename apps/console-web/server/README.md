# Console API (Python)

FastAPI service behind the web Dev Console. It runs the framework's build engine (`framework/cli/engine-rpc.mjs`, Node) for every operation — init, validate, new-module/new-demo, install (library wizard), import-ui (third-party UI library → AmberX kit), status edits, boilerplate saves — keeps the open project and the output terminal (`/api/terminal`, live over `/api/events` SSE), and serves the built console.

```
cd apps/console-web && npm run build          # console → dist/
cd server && pip install -r requirements.txt
uvicorn main:app --port 7090                  # http://localhost:7090  (console + API)
```

Dev loop: `uvicorn main:app --port 7090 --reload` here and `npm run dev` in `apps/console-web` (Vite proxies `/api`).
Deploy: Coolify → Dockerfile at `apps/console-web/server/Dockerfile`, build context = repo root, mount the repo at `/axf` (or let the container keep its own clone) so installs and imports land in real files. Set `AXF_TOKEN` to require a bearer token on write routes.

## Server control panel (`/panel`)

`deploy/panel/index.html`, served by the API at `/panel`: start/stop the dev servers (`axf dev`, `axf serve`, the Vite console, the demo preview, `next dev` for the open project) with their logs, one-click downloads of the latest green CI build (APK, Maven repo, console dist — needs `GITHUB_TOKEN` on the API to fetch GitHub's artifact zips), a filterable catalog of every command, the live output stream, and the host terminal (`/api/shell`). Set `AXF_TOKEN` so starting servers and the terminal require the token, and keep the API behind HTTPS (Coolify's proxy). The same page is published as a claude.ai artifact; there it works in read-only mode (commands + links) and points at the live copy.

## MCP (Model Context Protocol)

The same API is exposed to Claude as MCP tools (`mcp_server.py`): plan search and edits, the build queue (`build_next`,
`build_reorder`/`build_move`, `build_reprocess`, `build_step` start/complete/resolve-rework/reopen, `build_sync`), catalog
status, libraries, library templates (new/compile/port), app init/validate/install, and the output terminal — 24 tools,
2 resources (`axf://plan`, `axf://build-queue`) and a `build-next-step` prompt. No shell or arbitrary file access.

| Where | How |
| --- | --- |
| Deployed console | `https://console.amberxai.com/mcp` — streamable HTTP, `Authorization: Bearer <AXF_TOKEN>` |
| Claude Code (remote) | `claude mcp add --transport http axf https://console.amberxai.com/mcp --header "Authorization: Bearer $AXF_TOKEN"` |
| Claude Code (local clone) | already registered in the repo's `.mcp.json` as `axf` (stdio: `python3 apps/console-web/server/mcp_server.py`) |
| Anything else | `GET /api/mcp` returns the URL, auth and tool list |

Every MCP write runs the same engine op as the console and shows up in its output terminal. Model policy baked into
the server instructions and the build queue: Fable 5.1 where needed, Opus 5.5 otherwise, Sonnet 5.5 only when Opus is
clearly not required.
