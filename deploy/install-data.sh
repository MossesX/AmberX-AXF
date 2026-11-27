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
#   2. makes the internal docker network `axf-data` (no route out, nothing published) and the named volumes `axf-data`
#      (snapshots, engine state, a SQLite store that has not moved yet) and `axf-data-pg` (the Postgres data directory)
#   3. writes service tokens once into $CONF (0600): conf/tokens.json holds only their SHA-256 (mounted read-only into
#      the container), conf/env/<service>.env holds AXF_DATA_URL + AXF_DATA_TOKEN for the console, the orchestrator,
#      axHub and the CLI; conf/env/postgres.env holds the database password, made once; nothing secret goes to the repo
#      or the log
#   4. runs `axf-data-db` (postgres:16-alpine, Brett's Nov 6 choice) on that network only, no -p, waits for pg_isready
#   5. if the volume holds a SQLite store that is not on Postgres yet: backup first, copy, counts + manifests checked
#      (services/axf-data/migrate_pg.py); a mismatch stops the install with the differences. A fresh volume skips this.
#   6. runs `axf-data` with restart unless-stopped, no -p, no domain, no Traefik labels, on that network only (at the fixed
#      address <subnet>.250), with the DSN; engine mode `postgres` on a fresh volume, `shadow` after a migration (cut over
#      with `axf data engine postgres`)
#   7. connects each client container that exists ($AXF_DATA_CLIENTS, default axf-console) to the network, and writes
#      conf/env/host.env (the fixed address + the orchestrator token) for processes on the VPS host itself: build sessions
#      in worktrees, the gate runner, cron (framework/core/data-files.mjs remoteConfig reads it when AXF_DATA_URL is unset)
#   8. installs the daily backup + mirror cron (deploy/axf-data-backup.cron → $BACKUPS, see services/axf-data/backup.py)
#   9. waits for /v1/health and appends one deploy-log@1 record (target axf-data) with axf_deploy_log
#
# Env: AXF_DATA_CONF (default /root/hub/data/axf-data/conf), AXF_DATA_CLIENTS ("axf-console" plus axHub's container
# when it is on this host), AXF_DATA_KEYS_URL (axHub key set for data-token@1), AXF_DATA_PLUGINS_DIR (the console's
# plugin data folders, mounted read-only so the SQLite ledgers can be mirrored into rows; default
# /opt/axf/.axf-console/plugins), AXF_DATA_ENGINE (force sqlite | shadow | postgres), AXF_DEPLOY_LOG.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$DIR/framework/deploy/axf-deploy.sh"

NAME=axf-data
NET=axf-data
VOL=axf-data
PORT=7700
DB=axf-data-db
DB_VOL=axf-data-pg
DB_IMAGE="${AXF_DATA_PG_IMAGE:-postgres:16-alpine}"
CONF="${AXF_DATA_CONF:-/root/hub/data/axf-data/conf}"
BACKUPS="${AXF_DATA_BACKUPS:-/root/hub/data/axf-data/backups}"
PLUGINS_DIR="${AXF_DATA_PLUGINS_DIR:-/opt/axf/.axf-console/plugins}"
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
docker volume inspect "$DB_VOL" >/dev/null 2>&1 || docker volume create --label axf.service=axf-data "$DB_VOL" >/dev/null

# ── 3. service tokens (made once; re-running keeps them) ──
umask 077
mkdir -p "$CONF/env"
# orchestrator = the host token (conf/env/host.env): CLIs on the VPS itself (plan.mjs, persist.mjs, tracker.mjs, build
# sessions) read and write the shared plan / catalog / project keys once they are cut over (postgres-part-b)
grants_for() {
  case "$1" in
    console) printf '%s' '{"*":["read","write","append"]}' ;;
    orchestrator) printf '%s' '{"builds":["read","write","append"],"planner":["read","write","append"],"ui-review":["read","write"],"changes":["read","write"],"console/agent-slots":["read","write"],"console/framework":["read","write"],"console/projects":["read","write"],"console/project.manifest.json":["read","write"],"sessions":["append"]}' ;;
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

# the database password, made once (postgres.env is read by this script and the compose resource only)
if [ ! -s "$CONF/env/postgres.env" ]; then
  printf 'AXF_DATA_PG_PASSWORD=%s\n' "$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$CONF/env/postgres.env"
fi
chmod 600 "$CONF/env/postgres.env"
PG_PASSWORD="$(sed -n 's/^AXF_DATA_PG_PASSWORD=//p' "$CONF/env/postgres.env")"
DSN="postgresql://axf:$PG_PASSWORD@$DB:5432/axfdata"

# backups: written by the container's user (uid 10001), read by root and the systems check
mkdir -p "$BACKUPS" && chown 10001:10001 "$BACKUPS" && chmod 750 "$BACKUPS"

# ── 4. the database container (Postgres in its own container, persistent volume, never published) ──
if ! docker inspect "$DB" >/dev/null 2>&1; then
  say "starting $DB ($DB_IMAGE, volume $DB_VOL)"
  docker run -d --name "$DB" --restart unless-stopped --network "$NET" --network-alias "$DB" \
    -v "$DB_VOL":/var/lib/postgresql/data \
    -e POSTGRES_USER=axf -e POSTGRES_DB=axfdata -e "POSTGRES_PASSWORD=$PG_PASSWORD" -e POSTGRES_INITDB_ARGS=--data-checksums \
    -l traefik.enable=false -l axf.service=axf-data \
    "$DB_IMAGE" postgres -c shared_buffers=256MB -c max_connections=40 -c log_min_duration_statement=2000 >/dev/null
elif [ "$(docker inspect -f '{{.State.Running}}' "$DB")" != "true" ]; then
  docker start "$DB" >/dev/null
fi
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -q -U axf -d axfdata >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$DB" pg_isready -q -U axf -d axfdata >/dev/null 2>&1 || { say "$DB did not answer pg_isready in 60 s: docker logs $DB"; exit 1; }

# ── 5. an existing SQLite store moves first (backup, copy, counts + manifests); a fresh volume has nothing to move ──
ENGINE="${AXF_DATA_ENGINE:-}"
HAS_SQLITE="$(docker run --rm -v "$VOL":/data alpine:3.20 sh -c 'test -s /data/axf-data.sqlite && echo yes || echo no' 2>/dev/null || echo no)"
if [ -z "$ENGINE" ] && [ "$HAS_SQLITE" = yes ]; then
  PG_KEYS="$(docker run --rm --network "$NET" -e "AXF_DATA_DSN=$DSN" -e AXF_DATA_DIR=/data -v "$VOL":/data "$NAME:latest" \
    python -c "import pg,os; print(pg.PgStore(os.environ['AXF_DATA_DSN'],'/data').fetchone('SELECT COUNT(*) AS n FROM keys')['n'])" 2>/dev/null || echo error)"
  # a probe that fails is not an empty database: stop here rather than start a copy over live data
  [ "$PG_KEYS" != error ] || { say "could not read Postgres with the new image (schema migration or connection failed): docker run … $NAME:latest python -c 'import pg' to see why; nothing changed"; exit 1; }
  if [ "$PG_KEYS" = 0 ]; then
    say "SQLite store found on $VOL and Postgres is empty: migrating (backup first, counts and manifests checked)"
    docker run --rm --network "$NET" -e "AXF_DATA_DSN=$DSN" -e AXF_DATA_DIR=/data -e AXF_DATA_BACKUPS=/backups -v "$VOL":/data -v "$BACKUPS":/backups \
      "$NAME:latest" python migrate_pg.py || { say "migration refused: nothing moved to the console, Postgres left for inspection (docker run … migrate_pg.py --verify)"; exit 1; }
  fi
  # the first run after a migration starts in shadow; once the service has recorded its own engine state (engine.json:
  # a cut-over to postgres, a roll-back) that state is what a restart must come back to, so the env is not pinned over it
  HAS_STATE="$(docker run --rm -v "$VOL":/data alpine:3.20 sh -c 'test -s /data/engine.json && echo yes || echo no' 2>/dev/null || echo no)"
  [ "$HAS_STATE" = yes ] || ENGINE=shadow
fi

# ── 6. the service container ──
FROM_SHA="$(docker inspect -f '{{index .Config.Labels "axf.sha"}}' "$NAME" 2>/dev/null || true)"
SHA="$(git -C "$DIR" rev-parse HEAD 2>/dev/null || true)"
axf_stop_container "$NAME"
# A fixed address on the internal network (<subnet>.250): processes on the VPS host itself (build sessions in worktrees, the
# gate runner, cron) reach axf-data through the docker bridge at this address, read from conf/env/host.env (step 7), since
# the host cannot resolve the network alias and the internal network publishes nothing.
SUBNET="$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' "$NET" 2>/dev/null || true)"
HOST_IP="${AXF_DATA_HOST_IP:-${SUBNET:+${SUBNET%.*/*}.250}}"
RUN=(-d --name "$NAME" --restart unless-stopped --network "$NET" --network-alias "$NAME"
  -v "$VOL":/data -v "$CONF/tokens.json":/run/axf-data/tokens.json:ro -v "$BACKUPS":/backups
  -e AXF_DATA_DIR=/data -e AXF_DATA_TOKENS_FILE=/run/axf-data/tokens.json -e AXF_DATA_BACKUPS=/backups
  -e "AXF_DATA_DSN=$DSN" -e AXF_DATA_MIRROR_DIR=/mnt/console-plugins
  -l traefik.enable=false -l axf.service=axf-data -l "axf.sha=$SHA")
[ -z "$ENGINE" ] || RUN+=(-e "AXF_DATA_ENGINE=$ENGINE")
[ -z "${AXF_DATA_KEYS_URL:-}" ] || RUN+=(-e "AXF_DATA_KEYS_URL=$AXF_DATA_KEYS_URL")
[ -z "$HOST_IP" ] || RUN+=(--ip "$HOST_IP")
# the console's plugin data folders, read-only: the Shipped features ledger and the Chat viewer db are mirrored into rows
[ -d "$PLUGINS_DIR" ] && RUN+=(-v "$PLUGINS_DIR":/mnt/console-plugins:ro)
docker run "${RUN[@]}" "$NAME:latest" >/dev/null

# ── 7. clients join the network (the console reaches http://axf-data:7700); the host gets conf/env/host.env ──
for c in $CLIENTS; do
  if docker inspect "$c" >/dev/null 2>&1; then
    docker network connect "$NET" "$c" >/dev/null 2>&1 || true
    say "client $c is on $NET"
  fi
done
# host.env: the orchestrator's token at the fixed address, for every process on the VPS outside the containers (build
# sessions in worktrees, the gate runner, the auto-lander, cron). framework/core/data-files.mjs reads it when AXF_DATA_URL
# is unset (remoteConfig). The builds store in cutover is unreachable from the host without it.
HOST_ADDR="$(docker inspect -f "{{(index .NetworkSettings.Networks \"$NET\").IPAddress}}" "$NAME" 2>/dev/null || true)"
if [ -n "$HOST_ADDR" ]; then
  printf 'AXF_DATA_URL=http://%s:%s\nAXF_DATA_TOKEN=%s\n' "$HOST_ADDR" "$PORT" "$(sed -n 's/^AXF_DATA_TOKEN=//p' "$CONF/env/orchestrator.env")" > "$CONF/env/host.env"
  chmod 600 "$CONF/env/host.env"
  say "host processes reach axf-data at http://$HOST_ADDR:$PORT ($CONF/env/host.env)"
fi

# ── 8. daily backup (pg_dump) + nightly SQLite mirror (deploy/axf-data-backup.cron) ──
if [ -d /etc/cron.d ]; then
  install -m 644 "$DIR/deploy/axf-data-backup.cron" /etc/cron.d/axf-data-backup
fi

# ── 9. health + deploy log ──
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
  say "up: http://$NAME:$PORT on the internal $NET network (Postgres $DB on volume $DB_VOL, engine ${ENGINE:-postgres}; tokens in $CONF/env)"
  [ "$ENGINE" != shadow ] || say "engine is shadow (SQLite reads, Postgres mirrored): watch 'axf data engine', then 'axf data engine postgres' to cut over"
else
  say "axf-data did not answer /v1/health in 30 s: docker logs $NAME"
  exit 1
fi
