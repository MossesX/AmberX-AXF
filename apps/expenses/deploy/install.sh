#!/usr/bin/env bash
# Expenses (the Expense Tracker, apps/expenses) on the VPS at https://$DOMAIN behind Coolify's Traefik, deployed from
# AmberX-AXF. Same shape as apps/molly/deploy/install.sh, plus a safe cut-over from the old MossesX/Expense container.
#
#   sudo bash apps/expenses/deploy/install.sh             build, verify alongside, swap, install the 5-minute update cron
#   sudo bash apps/expenses/deploy/install.sh --status    what runs, which image, ledger counts
#   sudo bash apps/expenses/deploy/install.sh --rollback  back to the old MossesX/Expense container (one command)
#
#   SRC=<checkout>/apps/expenses  build from that folder instead of the $DIR clone (first cut-over before the PR merges)
#
# DATA: the app reads and writes the SAME Docker volume as before ($VOLUME, mounted read-write at /data; studio.amberxai.com
# shares it). Nothing here deletes, copies or rewrites it. Each run counts the ledger entries on the volume before and after
# the swap and rolls back by itself when the new container isn't healthy or the counts differ.
#
# What it does (safe to re-run):
#   1. clone / update AmberX-AXF into $DIR (GitHub token from the broker, like Molly)
#   2. build $IMAGE:<commit> from apps/expenses (heavy step: agent-slots lock when it is there)
#   3. run it as $NAME-next on the volume, no Traefik route, and wait for /api/health
#   4. count ledger entries (every /data/axf/kv/<user>/expenses.json) from inside the candidate = the count on the volume
#   5. the first time: tag the old image as $OLD_IMAGE:pre-axf (the rollback image; never pruned by this script)
#   6. swap: remove the running $NAME, start the new image as $NAME with the same Traefik labels and volume
#   7. wait healthy, count again (must match), else roll back at once
#   8. cron: pull main every 5 minutes (flock) and re-run this when apps/expenses or the framework changed
set -euo pipefail

DOMAIN="${DOMAIN:-expenses.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
SUB="${SUB:-apps/expenses}"
BRANCH="${BRANCH:-main}"
NAME="${NAME:-amberx-expenses}"
IMAGE="${IMAGE:-expenses-axf}"
OLD_IMAGE="${OLD_IMAGE:-amberx-expenses}"
OLD_COMPOSE="${OLD_COMPOSE:-/opt/amberx/expense/docker-compose.yml}"
VOLUME="${VOLUME:-amberx-studio-data}"
DIR="${DIR:-/opt/expenses-axf}"
PORT=3200
AXF_DIR="${AXF_DIR:-/opt/axf}"
STATE="$DIR/.app"

say() { echo -e "\033[1;36m[expenses]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
command -v docker >/dev/null || { say "Docker is required (Coolify installs it)."; exit 1; }

# Ledger entries on the volume, counted by node inside an image (no host node needed). Prints "<users> <entries> <sha>"
# where sha is over each user's file hash, so a count that matches but changed content still shows.
COUNT_JS='const fs=require("fs"),c=require("crypto"),p="/data/axf/kv";let u=0,n=0;const h=c.createHash("sha256");
for(const d of (fs.existsSync(p)?fs.readdirSync(p).sort():[])){const f=p+"/"+d+"/expenses.json";if(!fs.existsSync(f))continue;
const raw=fs.readFileSync(f);const j=JSON.parse(raw);const e=(j.doc||j).expenses;if(!Array.isArray(e))continue;u++;n+=e.length;
h.update(d+":"+c.createHash("sha256").update(raw).digest("hex")+"\n")}console.log(u,n,h.digest("hex").slice(0,16))'
count_in() { docker exec "$1" node -e "$COUNT_JS"; }
count_image() { docker run --rm -v "$VOLUME:/data:ro" --entrypoint node "$1" -e "$COUNT_JS"; }

wait_healthy() { # NAME SECONDS → 0 when healthy
  local s=starting i
  for i in $(seq 1 "$(( $2 / 2 ))"); do
    s="$(docker inspect "$1" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || echo gone)"
    [ "$s" = healthy ] && return 0
    [ "$s" = gone ] || [ "$s" = exited ] && break
    sleep 2
  done
  say "$1: $s"; return 1
}

HEALTH=(--health-cmd "node -e \"fetch('http://127.0.0.1:$PORT/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"" \
  --health-interval 30s --health-timeout 5s --health-start-period 40s --health-retries 3)
NET="${TRAEFIK_NETWORK:-coolify}"
ENVS=(-e AXS_DATA_ROOT=/data -e AXF_ROOT=/app -e AXF_ASSETS_ROOT=/app/assets -e NODE_ENV=production -e PORT=$PORT -e HOSTNAME=0.0.0.0)
# The same routers and service the old compose file declares, so Traefik routes the domain exactly as before.
LABELS=(
  -l traefik.enable=true -l "traefik.docker.network=$NET"
  -l "traefik.http.routers.amberx-expenses.rule=Host(\`$DOMAIN\`)" -l traefik.http.routers.amberx-expenses.entrypoints=https
  -l traefik.http.routers.amberx-expenses.tls=true -l traefik.http.routers.amberx-expenses.tls.certresolver=letsencrypt
  -l "traefik.http.routers.amberx-expenses-http.rule=Host(\`$DOMAIN\`)" -l traefik.http.routers.amberx-expenses-http.entrypoints=http
  -l traefik.http.routers.amberx-expenses-http.middlewares=amberx-expenses-https@docker
  -l traefik.http.middlewares.amberx-expenses-https.redirectscheme.scheme=https
  -l traefik.http.middlewares.amberx-expenses-https.redirectscheme.permanent=true
  -l "traefik.http.services.amberx-expenses.loadbalancer.server.port=$PORT"
  -l ai.amberx.axf.app=expenses
)

rollback() {
  say "Rolling back to the old MossesX/Expense container"
  rm -f "/etc/cron.d/$NAME" "/usr/local/bin/$NAME-update"
  docker rm -f "$NAME" "$NAME-next" >/dev/null 2>&1 || true
  if docker image inspect "$OLD_IMAGE:pre-axf" >/dev/null 2>&1; then docker tag "$OLD_IMAGE:pre-axf" "$OLD_IMAGE:latest"; fi
  [ -f "$OLD_COMPOSE" ] || { say "No $OLD_COMPOSE: start the old image by hand ($OLD_IMAGE:pre-axf)"; exit 1; }
  docker compose -p expenses -f "$OLD_COMPOSE" up -d --no-build
  wait_healthy "$NAME" 120 && say "Old container is back: $(count_in "$NAME") (users entries hash)"
}

case "${1:-}" in
  --rollback) rollback; exit 0 ;;
  --status)
    docker ps -a --filter "name=^/$NAME(-next)?$" --format '{{.Names}}  {{.Image}}  {{.Status}}'
    docker images --format '{{.Repository}}:{{.Tag}}  {{.ID}}  {{.CreatedSince}}' | grep -E "^($IMAGE|$OLD_IMAGE):" || true
    docker inspect "$NAME" >/dev/null 2>&1 && say "ledger on $VOLUME: $(count_in "$NAME") (users entries hash)"
    exit 0 ;;
esac

# ---- 1. repo ----
# GitHub goes through the GitHub App: the token broker first (installation token), then the console's.
command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git; }
BROKER="$AXF_DIR/framework/cli/github-token.mjs"
CONSOLE_BROKER="docker exec axf-console sh -c 'for d in /opt/axf /app /srv/axf; do [ -f \$d/framework/cli/github-token.mjs ] && exec node \$d/framework/cli/github-token.mjs token; done; exit 1'"
broker_token() { { command -v node >/dev/null && [ -f "$BROKER" ] && node "$BROKER" token 2>/dev/null; } || eval "$CONSOLE_BROKER" 2>/dev/null || true; }
[ -n "${GITHUB_TOKEN:-}" ] || GITHUB_TOKEN="$(broker_token)"
GIT=(git)
[ -n "${GITHUB_TOKEN:-}" ] && GIT=(git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)")
if [ -n "${SRC:-}" ]; then
  APP="$(cd "$SRC" && pwd)"; REV="$(git -C "$APP" rev-parse --short HEAD)"
  say "Building from $APP ($REV)"
else
  if [ -d "$DIR/.git" ]; then
    say "Updating $DIR"; "${GIT[@]}" -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
  else
    say "Cloning into $DIR"; "${GIT[@]}" clone -q --branch "$BRANCH" "$REPO" "$DIR"
  fi
  APP="$DIR/$SUB"; REV="$(git -C "$DIR" rev-parse --short HEAD)"
fi
mkdir -p "$STATE"; chmod 700 "$STATE"
# The ledger API token (/api/expenses/v1: CLI, console MCP). Made once, kept root-only in $STATE, handed to the container
# as env and to the console as a file next to its env (its MCP tools read it). Never in the repo or a log.
TOKF="$STATE/api-token"
[ -s "$TOKF" ] || { head -c 32 /dev/urandom | base64 | tr -d '/+=\n' | head -c 40 > "$TOKF"; }
chmod 600 "$TOKF"
if [ -d "$AXF_DIR/.axf-console" ]; then install -m 600 "$TOKF" "$AXF_DIR/.axf-console/expenses-api-token"; fi
ENVS+=(-e "EXPENSES_API_TOKEN=$(cat "$TOKF")" -e "EXPENSES_API_USER=${EXPENSES_API_USER:-Brett}")
[ -f "$APP/Dockerfile" ] || { say "No app at $APP (not on $BRANCH yet?) - the running container is left as it is"; exit 1; }

# ---- 2. image ----
say "Building $IMAGE:$REV (first time takes a few minutes)"
SLOTS="$AXF_DIR/framework/cli/agent-slots.mjs"
BUILD=(docker build -q --build-arg "SOURCE_VERSION=$REV" -t "$IMAGE:$REV" "$APP")
if command -v node >/dev/null && [ -f "$SLOTS" ]; then node "$SLOTS" heavy -- "${BUILD[@]}" >/dev/null; else "${BUILD[@]}" >/dev/null; fi

# ---- 3. candidate alongside (no route) ----
docker rm -f "$NAME-next" >/dev/null 2>&1 || true
docker run -d --name "$NAME-next" --network "$NET" -l traefik.enable=false -v "$VOLUME:/data" "${ENVS[@]}" "${HEALTH[@]}" \
  --health-interval 3s "$IMAGE:$REV" >/dev/null
if ! wait_healthy "$NAME-next" 120; then
  docker logs --tail 30 "$NAME-next" 2>&1 | sed 's/^/  | /'; docker rm -f "$NAME-next" >/dev/null
  say "The new image never got healthy; nothing was swapped"; exit 1
fi

# ---- 4. counts before ----
BEFORE="$(count_in "$NAME-next")"
OLD_SEES="$(docker inspect "$NAME" >/dev/null 2>&1 && count_in "$NAME" || echo none)"
say "Ledger (users entries hash): new container sees $BEFORE; running container sees $OLD_SEES"
if [ "$OLD_SEES" != none ] && [ "$OLD_SEES" != "$BEFORE" ]; then
  docker rm -f "$NAME-next" >/dev/null; say "The two containers don't see the same ledger; nothing was swapped"; exit 1
fi
docker rm -f "$NAME-next" >/dev/null

# ---- 5. keep the old image for rollback ----
if ! docker image inspect "$OLD_IMAGE:pre-axf" >/dev/null 2>&1 && docker image inspect "$OLD_IMAGE:latest" >/dev/null 2>&1; then
  docker tag "$OLD_IMAGE:latest" "$OLD_IMAGE:pre-axf"; say "Old image kept as $OLD_IMAGE:pre-axf"
fi

# ---- 6. swap ----
PREV_IMAGE="$(docker inspect "$NAME" --format '{{.Config.Image}}' 2>/dev/null || true)"
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped --network "$NET" -v "$VOLUME:/data" "${ENVS[@]}" "${HEALTH[@]}" "${LABELS[@]}" \
  "$IMAGE:$REV" >/dev/null
docker tag "$IMAGE:$REV" "$IMAGE:latest"

# ---- 7. verify ----
if ! wait_healthy "$NAME" 150; then
  say "New container not healthy after the swap"
  if [ "${PREV_IMAGE#"$IMAGE":}" != "$PREV_IMAGE" ]; then # it was already an AXF build: back to that one
    docker rm -f "$NAME" >/dev/null; docker run -d --name "$NAME" --restart unless-stopped --network "$NET" -v "$VOLUME:/data" \
      "${ENVS[@]}" "${HEALTH[@]}" "${LABELS[@]}" "$PREV_IMAGE" >/dev/null; say "Back on $PREV_IMAGE"
  else rollback; fi
  exit 1
fi
AFTER="$(count_in "$NAME")"
if [ "$AFTER" != "$BEFORE" ] && [ "$(echo "$AFTER" | cut -d' ' -f1-2)" != "$(echo "$BEFORE" | cut -d' ' -f1-2)" ]; then
  say "Ledger counts differ after the swap ($BEFORE → $AFTER)"; rollback; exit 1
fi
say "Live on $IMAGE:$REV; ledger $BEFORE → $AFTER (users entries hash)"
printf '{"image":"%s","rev":"%s","before":"%s","after":"%s","at":"%s"}\n' "$IMAGE:$REV" "$REV" "$BEFORE" "$AFTER" "$(date -u +%FT%TZ)" > "$STATE/last-deploy.json"
# keep the last three AXF builds, never the pre-axf rollback image
docker images "$IMAGE" --format '{{.Tag}}' | grep -vE '^(latest|'"$REV"')$' | tail -n +3 | while read -r t; do docker rmi "$IMAGE:$t" >/dev/null 2>&1 || true; done || true

# ---- 8. auto-update (from main, never from SRC) ----
if [ "${INSTALL_CRON:-1}" = 1 ]; then
  if [ ! -d "$DIR/.git" ]; then # SRC run: the clone the cron pulls ($DIR already holds .app)
    rm -rf "$DIR.tmp"; if "${GIT[@]}" clone -q --branch "$BRANCH" "$REPO" "$DIR.tmp"; then cp -a "$DIR.tmp/." "$DIR/"; fi; rm -rf "$DIR.tmp"
  fi
  if [ -f "$DIR/framework/deploy/axf-deploy.sh" ]; then
    # shellcheck source=../../../framework/deploy/axf-deploy.sh
    . "$DIR/framework/deploy/axf-deploy.sh"
    # shellcheck disable=SC2016
    AXF_UPDATE_PRELUDE="T=\$({ command -v node >/dev/null && node \"$BROKER\" token 2>/dev/null; } || $CONSOLE_BROKER 2>/dev/null)
H=(); [ -n \"\$T\" ] && H=(-c \"http.https://github.com/.extraheader=AUTHORIZATION: basic \$(printf 'x-access-token:%s' \"\$T\" | base64 -w0)\")" \
    AXF_UPDATE_FETCH='git "${H[@]}"' \
      axf_update_script "/usr/local/bin/$NAME-update" "$DIR" "$BRANCH" "/var/log/$NAME-update.log" \
      "DOMAIN=\"$DOMAIN\" NAME=\"$NAME\" DIR=\"$DIR\" SUB=\"$SUB\" AXF_DIR=\"$AXF_DIR\" VOLUME=\"$VOLUME\" bash \"$DIR/$SUB/deploy/install.sh\"" \
      "$STATE/update-status.json"
    axf_cron_file "$NAME" "*/5 * * * * root flock -n /run/$NAME-update.lock /usr/local/bin/$NAME-update"
    say "Update cron: every 5 minutes from $BRANCH (until $SUB is on $BRANCH, a run fails and leaves this container alone)"
  fi
fi
say "Expenses: https://$DOMAIN   Rollback: bash $APP/deploy/install.sh --rollback"
