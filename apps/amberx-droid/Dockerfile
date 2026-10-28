# AmberX: the web app (built with Node) served by its own Python server (FastAPI), which also holds the AI keys and
# does the provider switching (server/). One container, behind axHub's sign-in wall at https://amberx.amberxai.com.
# The Android shell (android/, Capacitor) loads that address. The page holds no AI key and no hub token.
#
# Build from the REPO ROOT (the server reuses the framework's Python packages, framework/python):
#   docker build -f apps/amberx-droid/Dockerfile -t amberx-web .
#   docker run -p 7491:8080 -e AMBERX_DEV_OPEN=1 -v /tmp/amberx-data:/data amberx-web     (local try-out only)
# CLAUDE_CLI=0 leaves the Claude Code CLI out (the Claude plan then can't answer; API providers still work).
FROM node:22-bookworm-slim AS web
# Same paths as in the repo: console plugins whose plugin.json targets "amberx-droid" are built in unchanged
# (vite.config.ts: virtual:amberx-console-plugins, @console/* aliases). The build only reads their plugin.json + web/.
WORKDIR /repo/apps/amberx-droid
COPY apps/amberx-droid/package.json apps/amberx-droid/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY apps/console-web/plugins /repo/apps/console-web/plugins
COPY apps/console-web/src/changeBatch.tsx apps/console-web/src/changeBatch.css /repo/apps/console-web/src/
COPY apps/amberx-droid/ .
RUN npm run build

FROM python:3.12-slim
ARG CLAUDE_CLI=1
# The Claude plan (subscription) answers through the Claude Code CLI inside this container (framework protocol
# claude-cli); its token comes from the AI settings per call, never from the image.
RUN if [ "$CLAUDE_CLI" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
      && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y --no-install-recommends nodejs \
      && npm install -g @anthropic-ai/claude-code && claude --version \
      && apt-get purge -y curl && rm -rf /var/lib/apt/lists/* /root/.npm; \
    fi
WORKDIR /app
COPY apps/amberx-droid/server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
# The framework's Python packages (axf_server: wall, storage, http; axf.assistant_host: provider registry + protocols)
# and the provider registry they read (framework/schemas/ai-providers.json), at the same paths as in the repo.
COPY framework/python framework/python
COPY framework/schemas/ai-providers.json framework/schemas/ai-providers.json
COPY apps/amberx-droid/server server
COPY --from=web /repo/apps/amberx-droid/dist dist
ENV AMBERX_DATA_DIR=/data AMBERX_DIST=/app/dist PORT=8080 PYTHONPATH=/app/framework/python DISABLE_AUTOUPDATER=1 CLAUDE_BIN=claude
RUN python -c "import axf_server.wall, axf_server.storage, axf_server.http; from axf.assistant_host import providers; assert providers.kind('claude-code')" \
 && useradd -r -u 1000 -m app && mkdir -p /data && chown app /data && chmod 700 /data
USER app
EXPOSE 8080
# umask 077: everything the server writes in /data is the app's alone. exec: uvicorn gets SIGTERM from `docker stop`.
CMD ["sh", "-c", "umask 077 && cd server && exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
