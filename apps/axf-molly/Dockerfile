# AXF Molly: the container that runs the orchestrator's dispatcher, the reconciler, the gate rules, the auto-lander /
# merge queue and the Shipped features sender (axf-molly@1, framework/spec/AXF-MOLLY.md). Plain Node, no UI, no public
# port: it listens on 7510 on the internal Docker network only. deploy/install-molly.sh builds it from the repo root and
# runs it on Coolify's network with the host clone mounted over /opt/axf (same path as on the host, so git worktrees
# under /root/axf-builds read the same on both sides).
#   docker build -f apps/axf-molly/Dockerfile -t axf-molly .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/axf
COPY . /opt/axf
# the shims come first on PATH: `tmux` and the build launcher go over the host bridge (host-bridge@1), never run here
ENV PATH=/opt/axf/apps/axf-molly/bin:/usr/local/bin:/usr/bin:/bin \
    AXF_MOLLY_SIDE=axf-molly \
    AXF_PIPELINE_LAUNCHER=/opt/axf/apps/axf-molly/bin/claude-headless.sh \
    AXF_MOLLY_BRIDGE=/run/axf-molly/bridge.sock \
    AXF_ROOT=/opt/axf AXF_CONSOLE_ROOT=/opt/axf AXF_LAND_REPO=/opt/axf \
    PORT=7510 DISABLE_AUTOUPDATER=1
RUN chmod +x apps/axf-molly/bin/* && node --check apps/axf-molly/server.mjs
EXPOSE 7510
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:7510/v1/health >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/axf-molly/server.mjs"]
