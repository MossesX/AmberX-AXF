# Console API (Python)

FastAPI service behind the web Dev Console. It runs the framework's build engine (`framework/cli/engine-rpc.mjs`, Node) for every operation — init, validate, new-module/new-demo, install (library wizard), import-ui (third-party UI library → AmberX kit), status edits, boilerplate saves — keeps the open project and the output terminal (`/api/terminal`, live over `/api/events` SSE), and serves the built console.

```
cd apps/console-web && npm run build          # console → dist/
cd server && pip install -r requirements.txt
uvicorn main:app --port 7090                  # http://localhost:7090  (console + API)
```

Dev loop: `uvicorn main:app --port 7090 --reload` here and `npm run dev` in `apps/console-web` (Vite proxies `/api`).
Deploy: Coolify → Dockerfile at `apps/console-web/server/Dockerfile`, build context = repo root, mount the repo at `/axf` (or let the container keep its own clone) so installs and imports land in real files. Set `AXF_TOKEN` to require a bearer token on write routes.
