#!/usr/bin/env bash
# install-molly.sh — AXF Molly on the VPS (axf-molly@1, framework/spec/AXF-MOLLY.md). Brett, Nov 15 2026: "Molly's gonna
# run the orchestrator from now on, so let's name it AXF Molly."
#
#   bash deploy/install-molly.sh                 build the image from /opt/axf and run `axf-molly` on Coolify's network
#   DIR=/root/axf-builds/<build> bash deploy/install-molly.sh    build from a worktree (shadow runs before the PR lands)
#
# What it does (safe to re-run):
#   1. checks the name: `axf-molly` must not be taken by anything but our own container; lists what the retired
#      standalone Molly app left behind (container molly, image, cron, script, folder, domain) and deletes NONE of it
#   2. installs the host bridge (deploy/molly-bridge.mjs) as systemd axf-molly-bridge.service: a Unix socket in
#      /run/axf-molly the container mounts; it runs a fixed command list (tmux, the build launcher, read-only git) and
#      never the Docker socket
#   3. writes /opt/axf/.axf-molly/env (AXF_MOLLY_TOKEN for the API; the console token for alerts; axf-data URL when set)
#   4. builds the image (apps/axf-molly/Dockerfile) and runs it PRIVATE: no Traefik labels, no published port, on the
#      Coolify network only, restart unless-stopped, health check on /v1/health; mounts: the host clone (same path),
#      /root/axf-builds, the hub's projects volume at /projects (pipeline state + the lease), the bridge socket, the
#      headless events (read-only)
#   5. gates the host crons on the lease (molly.mjs owner console): while axf-molly only shadows nothing changes; after
#      a cutover the host's tick, lander and reconciler compute but act on nothing
#   6. starts in SHADOW mode: axf-molly computes, the console side acts, differences go to the shadow log. Cutover is
#      Brett's call: node apps/axf-molly/molly.mjs cutover --reason "…"   (undo: … undo)
set -euo pipefail

DIR="${DIR:-/opt/axf}"
NAME="${NAME:-axf-molly}"
PORT="${PORT:-7510}"
CONSOLE_NAME="${CONSOLE_NAME:-axf-console}"
HOST_REPO="${HOST_REPO:-/opt/axf}"
ENVD="$HOST_REPO/.axf-molly"
ENVF="$ENVD/env"
RUN_DIR=/run/axf-molly

say() { echo -e "\033[1;35m[axf-molly]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
command -v docker >/dev/null || { say "Docker is required."; exit 1; }
command -v node >/dev/null || { say "Node is required on the host (the bridge runs on it)."; exit 1; }
[ -f "$DIR/apps/axf-molly/Dockerfile" ] || { say "$DIR has no apps/axf-molly: set DIR to a checkout that has it."; exit 1; }
# shellcheck source=framework/deploy/axf-deploy.sh
. "$DIR/framework/deploy/axf-deploy.sh"

# ---- 1. the name, and the old Molly ----
say "Name check and the old standalone Molly app"
node "$DIR/apps/axf-molly/molly.mjs" retire || true
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  IMG="$(docker inspect "$NAME" --format '{{.Config.Image}}' 2>/dev/null || true)"
  case "$IMG" in axf-molly*|"") say "Replacing our own $NAME ($IMG)";; *) say "A container named $NAME runs another image ($IMG). Not touching it; set NAME= to pick another name."; exit 1;; esac
fi

# ---- 2. the host bridge ----
say "Installing the host bridge (systemd axf-molly-bridge.service)"
mkdir -p "$RUN_DIR"
UNIT=/etc/systemd/system/axf-molly-bridge.service
sed "s#/opt/axf/deploy/molly-bridge.mjs#$DIR/deploy/molly-bridge.mjs#; s#WorkingDirectory=/opt/axf#WorkingDirectory=$DIR#; s#AXF_REPO_ROOT=/opt/axf#AXF_REPO_ROOT=$DIR#" "$DIR/deploy/axf-molly-bridge.service" > "$UNIT"
systemctl daemon-reload
systemctl enable --now axf-molly-bridge.service >/dev/null
systemctl restart axf-molly-bridge.service
sleep 1
if node "$DIR/apps/axf-molly/bridge-client.mjs" bridge.ping >/dev/null 2>&1; then say "bridge answers on $RUN_DIR/bridge.sock"; else say "bridge did not answer (journalctl -u axf-molly-bridge)"; exit 1; fi

# ---- 3. secrets ----
mkdir -p "$ENVD"
if [ -f "$ENVF" ]; then . "$ENVF"; fi
AXF_MOLLY_TOKEN="${AXF_MOLLY_TOKEN:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)}"
CONSOLE_TOKEN=""
if [ -f "$HOST_REPO/.axf-console/env" ]; then CONSOLE_TOKEN="$(. "$HOST_REPO/.axf-console/env"; printf '%s' "${AXF_TOKEN:-}")"; fi
GH_TOKEN=""
if [ -f "$HOST_REPO/.axf-console/env" ]; then GH_TOKEN="$(. "$HOST_REPO/.axf-console/env"; printf '%s' "${GITHUB_TOKEN:-}")"; fi
cat > "$ENVF" <<ENV
AXF_MOLLY_TOKEN=$AXF_MOLLY_TOKEN
AXF_TOKEN=$CONSOLE_TOKEN
GITHUB_TOKEN=$GH_TOKEN
AXF_CONSOLE_URL=http://$CONSOLE_NAME:7090
AXF_GITHUB_REPO=${AXF_GITHUB_REPO:-MossesX/AmberX-AXF}
AXF_DATA_URL=${AXF_DATA_URL:-}
AXF_DATA_TOKEN=${AXF_DATA_TOKEN:-}
ENV
chmod 600 "$ENVF"

# ---- 4. image + container ----
say "Building image from $DIR (plain Node, a minute)"
docker build -q -f "$DIR/apps/axf-molly/Dockerfile" -t axf-molly:latest "$DIR" >/dev/null
NET="$(axf_coolify_proxy_running && axf_coolify_network || echo bridge)"
VOL="${AXHUB_PROJECTS_VOLUME:-$(docker volume ls -q | grep -E '(^|[-_])axhub-projects$' | head -n1 || true)}"
ARGS=(-d --name "$NAME" --restart unless-stopped --network "$NET" --env-file "$ENVF" -e PORT="$PORT"
  --label axf.service=axf-molly --label axf.private=true --label "axf.commit=$(git -C "$DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  -v /root/axf-builds:/root/axf-builds
  -v "$RUN_DIR:$RUN_DIR"
  -v /var/tmp/axf-headless:/var/tmp/axf-headless:ro
  -v /etc/localtime:/etc/localtime:ro)
# the host clone at the same path as on the host: git worktrees under /root/axf-builds resolve on both sides
if [ "$DIR" = "$HOST_REPO" ]; then ARGS+=(-v "$HOST_REPO:/opt/axf"); else say "built from $DIR: the image carries that checkout; $HOST_REPO is not mounted (shadow only until the PR lands)"; fi
if [ -n "$VOL" ]; then ARGS+=(-v "$VOL:/projects"); else say "no axhub-projects volume: pipeline state would be local to the container; aborting"; exit 1; fi
mkdir -p /var/tmp/axf-headless
axf_stop_container "$NAME"
docker run "${ARGS[@]}" axf-molly:latest >/dev/null
sleep 2
if docker exec "$NAME" curl -fsS "http://127.0.0.1:$PORT/v1/health" >/dev/null 2>&1; then say "$NAME is up on network $NET (private: no port, no domain)"; else say "$NAME did not answer /v1/health yet (docker logs $NAME)"; fi

# ---- 5. host crons gate on the lease ----
say "Gating the host crons on the lease (console side acts while it owns)"
G="$HOST_REPO/apps/axf-molly/molly.mjs"
GATE="{ [ ! -f $G ] || node $G owner console >/dev/null 2>&1; }"
axf_cron_file axf-pipeline "* * * * * root P=$HOST_REPO/apps/console-web/plugins/build-orchestrator/pipeline.mjs; [ -f \$P ] && cd $HOST_REPO && flock -n /run/axf-pipeline.lock timeout 600 node \$P tick >> /var/log/axf-pipeline.log 2>&1"
axf_cron_file axf-auto-land "*/3 * * * * root L=$HOST_REPO/apps/console-web/plugins/push-banner/land/land.mjs; [ -f \$L ] && $GATE && cd $HOST_REPO && AXF_LAND_REPO=$HOST_REPO flock -n /run/axf-auto-land.lock timeout 900 node \$L run >> /var/log/axf-auto-land.log 2>&1"
axf_cron_file axf-builds-reconcile "*/10 * * * * root cd $HOST_REPO && $GATE && node framework/cli/builds-reconcile.mjs --apply --brief >> /var/log/axf-builds-reconcile.log 2>&1"

# ---- 6. auto-update: when the host clone moves and it has apps/axf-molly, rebuild from it (same path as the console's 5-minute pull) ----
if [ "$DIR" = "$HOST_REPO" ]; then
  axf_cron_file axf-molly-update "*/10 * * * * root cd $HOST_REPO && [ -f apps/axf-molly/Dockerfile ] && [ \"\$(docker inspect axf-molly --format '{{index .Config.Labels \"axf.commit\"}}' 2>/dev/null)\" != \"\$(git rev-parse HEAD)\" ] && flock -n /run/axf-molly-update.lock bash deploy/install-molly.sh >> /var/log/axf-molly-install.log 2>&1"
else
  say "Not installing the auto-update cron for a worktree build; run install-molly.sh from $HOST_REPO once the PR lands (it then installs it)."
fi

# ---- 7. status ----
say "Mode: $(node "$DIR/apps/axf-molly/molly.mjs" owner 2>/dev/null || echo console) owns the work."
say "Token for the API: $ENVF (AXF_MOLLY_TOKEN). Status: node apps/axf-molly/molly.mjs status"
say "Cutover when the shadow log is clean: node apps/axf-molly/molly.mjs cutover --reason \"…\"   Undo: … undo"
