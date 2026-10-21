# AXF Dev Console: React/TypeScript console (built with Node) served by the Python API (FastAPI) that drives the
# framework's Node build engine. One container; Coolify builds it from the repo root with this Dockerfile.
#   docker build -f apps/console-web/server/Dockerfile -t axf-console .
#   docker run -p 7090:7090 -v $PWD:/axf axf-console        # mount the repo so installs/imports write back to it
FROM node:22-bookworm-slim AS web
WORKDIR /axf
COPY . .
RUN cd apps/console-web && npm ci && npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl git ca-certificates openssh-client procps && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /axf
COPY --from=web /axf /axf
# Claude Code CLI inside the container: the AI assistant's "Claude Code (subscription)" provider runs it here
# (a CLI installed on the VPS host is invisible to the container). Auth comes from the profile's token per call.
RUN npm install -g @anthropic-ai/claude-code && claude --version
ENV DISABLE_AUTOUPDATER=1 CLAUDE_BIN=claude
RUN pip install --no-cache-dir -r apps/console-web/server/requirements.txt \
 && cp -r apps/console-web/dist /opt/axf-console-dist
# install-console.sh mounts the host clone over /axf, hiding apps/console-web/dist; serve the copy outside it.
ENV AXF_CONSOLE_DIST=/opt/axf-console-dist AXF_ROOT=/axf AXF_STATE=/axf/.axf-console/state.json PORT=7090
# The framework's Python packages (framework/python: axf_server = shared server helpers, axf_libs, axf) ship with the
# repo copy above and with the host clone install-console.sh mounts over /axf; server/axf_framework.py adds the same
# folder at import time, so tests and a bare `uvicorn main:app` work without this variable too.
ENV PYTHONPATH=/axf/framework/python
RUN python -c "import axf_server.wall, axf_server.storage, axf_server.http, axf_server.credentials, axf_server.console_client, axf_server.plugin_package, axf_server.github"
EXPOSE 7090
# umask 002: files written into /projects stay group-writable for axHub (axhub-projects@1).
# exec: uvicorn gets SIGTERM from `docker stop` and shuts down cleanly
CMD ["sh", "-c", "umask 002 && cd apps/console-web/server && exec uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
