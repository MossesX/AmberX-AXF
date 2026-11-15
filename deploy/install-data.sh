#!/usr/bin/env bash
# Install or update axf-data, the container that holds all console data (data-store@1).
#
# Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
# builds keep running. That's what I need."
#
#   sudo bash deploy/install-data.sh            build the image, (re)start the container, connect the clients, log the deploy
#   bash deploy/install-data.sh --context DIR   only assemble the build context in DIR (for a Coolify compose resource)
#
# What it does:
#   1. builds axf-data:latest from services/axf-data plus framework/schemas/data-store.json
#   2. makes the internal docker network `axf-data` (no route out, nothing published) and the named volume `axf-data`
#   3. writes service tokens once into $CONF (0600): conf/tokens.json holds only their SHA-256 (mounted read-only into
#      the container), conf/env/<service>.env holds AXF_DATA_URL + AXF_DATA_TOKEN for the console, the orchestrator,
#      axHub and the CLI; nothing secret goes to the repo or the log
#   4. runs `axf-data` with restart unless-stopped, no -p, no domain, no Traefik labels, on that network only
#   5. connects each client container that exists ($AXF_DATA_CLIENTS, default axf-console) to the network
#   6. installs the daily backup cron (deploy/axf-data-backup.cron → $BACKUPS, see services/axf-data/backup.py)
#   7. waits for /v1/health and appends one deploy-log@1 record (target axf-data) with axf_deploy_log
#
# Env: AXF_DATA_CONF (default /root/hub/data/axf-data/conf), AXF_DATA_CLIENTS ("axf-console" plus axHub's container
# when it is on this host), AXF_DATA_KEYS_URL (axHub key set for data-token@1), AXF_DEPLOY_LOG.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$DIR/framework/deploy/axf-deploy.sh"

NAME=axf-data
NET=axf-data
VOL=axf-data
PORT=7700
CONF="${AXF_DATA_CONF:-/root/hub/data/axf-data/conf}"
BACKUPS="${AXF_DATA_BACKUPS:-/root/hub/data/axf-data/backups}"
# axHub's container joins too: it routes notes / builds / settings tools to axf-data (deploy/axhub/axf-data.downstream.json)
CLIENTS="${AXF_DATA_CLIENTS:-axf-console ${AXHUB_CONTAINER:-axhub}}"
SERVICES=(console orchestrator axhub cli)
say() { printf '[axf-data] %s\n' "$*"; }

context() {
  local out="$1"
  mkdir -p "$out"
  cp -a "$DIR/services/axf-data/." "$out/"
  cp "$DIR/framework/schemas/data-store.json" "$out/data-store.json"
}

if [ "${1:-}" = "--context" ]; then
  context "${2:?--context needs a folder}"
  say "build context ready in $2"
  exit 0
fi

command -v docker >/dev/null || { say "Docker is required (Coolify installs it). Install Docker and re-run."; exit 1; }

# ── 1. image ──
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT
context "$BUILD"
say "building $NAME:latest"
docker build -q -t "$NAME:latest" "$BUILD" >/dev/null

# ── 2. network + volume ──
docker network inspect "$NET" >/dev/null 2>&1 || docker network create --internal --label axf.service=axf-data "$NET" >/dev/null
docker volume inspect "$VOL" >/dev/null 2>&1 || docker volume create --label axf.service=axf-data "$VOL" >/dev/null

# ── 3. service tokens (made once; re-running keeps them) ──
umask 077
mkdir -p "$CONF/env"
grants_for() {
  case "$1" in
    console) printf '%s' '{"*":["read","write","append"]}' ;;
    orchestrator) printf '%s' '{"builds":["read","write","append"],"planner":["read","write","append"],"ui-review":["read","write"],"changes":["read","write"],"console/agent-slots":["read","write"],"sessions":["append"]}' ;;
    axhub) printf '%s' '{"notes":["read","write","append"],"builds":["read","write","append"],"settings":["read","write"],"planner":["read","write","append"],"ui-review":["read"],"changes":["read"]}' ;;
    cli) printf '%s' '{"*":["admin"]}' ;;
  esac
}
for svc in "${SERVICES[@]}"; do
  f="$CONF/env/$svc.env"
  if [ ! -s "$f" ]; then
    tok="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    printf 'AXF_DATA_URL=http://%s:%s\nAXF_DATA_TOKEN=%s\n' "$NAME" "$PORT" "$tok" > "$f"
  fi
  chmod 600 "$f"
done
{
  printf '{"tokens":['
  sep=''
  for svc in "${SERVICES[@]}"; do
    tok="$(sed -n 's/^AXF_DATA_TOKEN=//p' "$CONF/env/$svc.env")"
    sum="$(printf '%s' "$tok" | sha256sum | cut -d' ' -f1)"
    printf '%s{"id":"svc-%s","sub":"svc:%s","sha256":"%s","grants":%s}' "$sep" "$svc" "$svc" "$sum" "$(grants_for "$svc")"
    sep=','
  done
  printf ']}\n'
} > "$CONF/tokens.json.tmp"
mv "$CONF/tokens.json.tmp" "$CONF/tokens.json"
# the container runs as uid 10001: it reads the hash file, never the env files
chmod 644 "$CONF/tokens.json"

# backups: written by the container's user (uid 10001), read by root and the systems check
mkdir -p "$BACKUPS" && chown 10001:10001 "$BACKUPS" && chmod 750 "$BACKUPS"

# ── 4. container ──
FROM_SHA="$(docker inspect -f '{{index .Config.Labels "axf.sha"}}' "$NAME" 2>/dev/null || true)"
SHA="$(git -C "$DIR" rev-parse HEAD 2>/dev/null || true)"
axf_stop_container "$NAME"
RUN=(-d --name "$NAME" --restart unless-stopped --network "$NET" --network-alias "$NAME"
  -v "$VOL":/data -v "$CONF/tokens.json":/run/axf-data/tokens.json:ro -v "$BACKUPS":/backups
  -e AXF_DATA_DIR=/data -e AXF_DATA_TOKENS_FILE=/run/axf-data/tokens.json -e AXF_DATA_BACKUPS=/backups
  -l traefik.enable=false -l axf.service=axf-data -l "axf.sha=$SHA")
[ -z "${AXF_DATA_KEYS_URL:-}" ] || RUN+=(-e "AXF_DATA_KEYS_URL=$AXF_DATA_KEYS_URL")
docker run "${RUN[@]}" "$NAME:latest" >/dev/null

# ── 5. clients join the network (the console reaches http://axf-data:7700) ──
for c in $CLIENTS; do
  if docker inspect "$c" >/dev/null 2>&1; then
    docker network connect "$NET" "$c" >/dev/null 2>&1 || true
    say "client $c is on $NET"
  fi
done

# ── daily backup (deploy/axf-data-backup.cron) ──
if [ -d /etc/cron.d ]; then
  install -m 644 "$DIR/deploy/axf-data-backup.cron" /etc/cron.d/axf-data-backup
fi

# ── 6. health + deploy log ──
STATE=failed
for _ in $(seq 1 30); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null)" = "healthy" ] \
     || docker exec "$NAME" python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/v1/health', timeout=2)" >/dev/null 2>&1; then
    STATE=done; break
  fi
  sleep 1
done
axf_deploy_log "${AXF_DEPLOY_LOG:-$DIR/.axf-console/deploys/log.jsonl}" axf-data "$SHA" "" "$STATE" "$FROM_SHA"
if [ "$STATE" = done ]; then
  say "up: http://$NAME:$PORT on the internal $NET network (volume $VOL; tokens in $CONF/env)"
else
  say "axf-data did not answer /v1/health in 30 s: docker logs $NAME"
  exit 1
fi
