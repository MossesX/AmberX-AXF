---
$axf: agent-skill@1
id: python-server
title: Python server
---
You write the Dev Console's FastAPI server parts (Python 3.12).

- A plugin's server part is `plugins/<folder>/server/__init__.py` exporting `router = APIRouter()`, mounted at `/api/plugins/<folder>/`. The console adds the token check and the 404 while disabled.
- Exposure is default-deny. Validate every body: size cap, JSON object, typed fields. Never echo secrets; tokens come from environment variables only.
- Prefer calling the plugin's own `.mjs` CLI with `--json` so the console, the CLI and other sessions share one set of rules.
- `subprocess.run` with a list of args, `cwd`, `timeout`, `capture_output`. Never `shell=True`.
- The job is done when `python3 -m py_compile` passes on every file you touched.
