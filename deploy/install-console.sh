#!/usr/bin/env bash
# One-shot VPS setup for the AXF Dev Console: the Python API + the React console + the server panel at
# https://console.amberxai.com (Debian/Ubuntu with Docker; run as root, e.g. from Hostinger's browser terminal).
#
#   curl -fsSL https://raw.githubusercontent.com/MossesX/AmberX-AXF/main/deploy/install-console.sh | bash
#   GITHUB_TOKEN=ghp_… DOMAIN=console.amberxai.com bash install-console.sh      # optional: token for CI artifact downloads
#
# What it does (safe to re-run):
#   1. clones / updates the repo into /opt/axf (the API runs installs and imports against this clone)
#   2. builds the one-container image from apps/console-web/server/Dockerfile (Node 22 + Python 3.12)
#   3. runs it as `axf-console` on Coolify's network behind Traefik (HTTPS via letsencrypt), or on port 7090 without Coolify
#   4. generates AXF_TOKEN (saved in /opt/axf/.axf-console/env) — needed by the panel for server control + terminal
#   5. installs a cron that pulls main every 5 minutes and rebuilds when it changed
set -euo pipefail

DOMAIN="${DOMAIN:-console.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
BRANCH="${BRANCH:-main}"
NAME="${NAME:-axf-console}"
DIR="${DIR:-/opt/axf}"
PORT="${PORT:-7090}"
ENVF="$DIR/.axf-console/env"

say() { echo -e "\033[1;33m[axf]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
command -v docker >/dev/null || { say "Docker is required (Coolify installs it). Install Docker and re-run."; exit 1; }
command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git; }

# ---- 1. repo ----
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"; git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  say "Cloning into $DIR"; git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
mkdir -p "$DIR/.axf-console"

# ---- 2. secrets ----
# A token passed on the command line (AXF_TOKEN=… bash install-console.sh) replaces the saved one; otherwise the saved
# one (possibly reset from the panel or console settings) is kept.
ARG_AXF_TOKEN="${AXF_TOKEN:-}"
ARG_GITHUB_TOKEN="${GITHUB_TOKEN:-}"
if [ -f "$ENVF" ]; then
  # shellcheck disable=SC1090
  . "$ENVF"
fi
AXF_TOKEN="${ARG_AXF_TOKEN:-${AXF_TOKEN:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)}}"
GITHUB_TOKEN="${ARG_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
cat > "$ENVF" <<ENV
AXF_TOKEN=$AXF_TOKEN
GITHUB_TOKEN=$GITHUB_TOKEN
DOMAIN=$DOMAIN
ENV
chmod 600 "$ENVF"

# ---- 3. image ----
say "Building image (first build takes a few minutes: npm ci + pip)"
# live data (pending list, plan, build queue, catalog status, tracker) lives on the hub: $PERSIST_DIR/amberx-axf/
PERSIST_DIR="${PERSIST_DIR:-/opt/axhub/persist}"
mkdir -p "$PERSIST_DIR"
# Undo of claude-fs@1 (Oct 18 2026): an install from that version may have moved live data into
# /Claude/projects/<project>/data on this VPS. Move it back, then remove /Claude if nothing else is left in it.
if [ -d /Claude/projects ] && ! mountpoint -q /Claude 2>/dev/null; then
  for d in /Claude/projects/*/data; do
    [ -d "$d" ] || continue
    p="$(basename "$(dirname "$d")")"; to="$PERSIST_DIR/$p"
    if [ -e "$to" ] && [ -n "$(ls -A "$to" 2>/dev/null)" ]; then say "kept $to; $d left in place for you to check"; continue; fi
    rmdir "$to" 2>/dev/null || true
    mv "$d" "$to" && say "moved $d back to $to"
  done
  find /Claude -depth -type d -empty -delete 2>/dev/null || true
  [ -d /Claude ] && say "/Claude still has files (left in place): $(find /Claude -type f | head -3 | tr '\n' ' ')" || say "removed the empty /Claude folder"
fi
AXF_PERSIST_DIR="$PERSIST_DIR" node "$DIR/framework/cli/persist.mjs" push 2>/dev/null | sed 's/^/[axf] /' || say "node not on the host; the console seeds $PERSIST_DIR/amberx-axf on first read"
docker build -q -f "$DIR/apps/console-web/server/Dockerfile" -t "$NAME:latest" "$DIR" >/dev/null

# ---- 4. container ----
docker rm -f "$NAME" >/dev/null 2>&1 || true
COMMON=(-d --name "$NAME" --restart unless-stopped -v "$DIR":/axf -v "$PERSIST_DIR":/persist -e AXF_PERSIST_DIR=/persist -e AXF_ROOT=/axf -e AXF_STATE=/axf/.axf-console/state.json -e AXF_TOKEN="$AXF_TOKEN" -e GITHUB_TOKEN="$GITHUB_TOKEN" -e PORT="$PORT" -e AXF_GITHUB_REPO=MossesX/AmberX-AXF)
if docker ps --format '{{.Names}}' | grep -qx coolify-proxy; then
  say "Coolify proxy detected — publishing https://$DOMAIN behind Traefik"
  NET="$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | tr ' ' '\n' | grep -x coolify || true)"
  NET="${NET:-$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -n1)}"
  R="axfconsole"
  docker run "${COMMON[@]}" --network "$NET" \
    -l traefik.enable=true -l "traefik.docker.network=$NET" \
    -l "traefik.http.routers.$R-http.rule=Host(\`$DOMAIN\`)" -l "traefik.http.routers.$R-http.entrypoints=http" \
    -l "traefik.http.routers.$R-http.middlewares=$R-https" -l "traefik.http.middlewares.$R-https.redirectscheme.scheme=https" \
    -l "traefik.http.routers.$R.rule=Host(\`$DOMAIN\`)" -l "traefik.http.routers.$R.entrypoints=https" \
    -l "traefik.http.routers.$R.tls=true" -l "traefik.http.routers.$R.tls.certresolver=letsencrypt" \
    -l "traefik.http.services.$R.loadbalancer.server.port=$PORT" \
    "$NAME:latest" >/dev/null
  URL="https://$DOMAIN"
else
  say "No Coolify proxy — exposing port $PORT directly (put a reverse proxy with HTTPS in front before using the terminal remotely)"
  docker run "${COMMON[@]}" -p "$PORT:$PORT" "$NAME:latest" >/dev/null
  URL="http://$(curl -fsS -4 --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}'):$PORT"
fi

# ---- 5. auto-update ----
cat > /usr/local/bin/axf-console-update <<UPD
#!/usr/bin/env bash
set -e
cd "$DIR"
before=\$(git rev-parse HEAD); git fetch -q origin $BRANCH && git reset -q --hard origin/$BRANCH
[ "\$before" = "\$(git rev-parse HEAD)" ] && exit 0
GITHUB_TOKEN="$GITHUB_TOKEN" DOMAIN="$DOMAIN" NAME="$NAME" DIR="$DIR" PORT="$PORT" bash "$DIR/deploy/install-console.sh" >> /var/log/axf-console-update.log 2>&1
UPD
chmod +x /usr/local/bin/axf-console-update
echo "*/5 * * * * root /usr/local/bin/axf-console-update" > /etc/cron.d/axf-console
chmod 644 /etc/cron.d/axf-console

sleep 3
docker ps --filter "name=^$NAME$" --format '{{.Names}} is {{.Status}}' | sed 's/^/[axf] /'
SERVER_IP="$(curl -fsS -4 --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DNS_IP="$(getent hosts "$DOMAIN" | awk '{print $1}' | tail -n1 || true)"
[ "$DNS_IP" = "$SERVER_IP" ] || say "DNS: point an A record for $DOMAIN at $SERVER_IP (currently '${DNS_IP:-unset}'); HTTPS starts working once it resolves."
say "Dev Console:   $URL"
say "Server panel:  $URL/panel"
say "AXF_TOKEN:     $AXF_TOKEN   (paste it into the panel's Connection → Token; saved in $ENVF)"
[ -n "$GITHUB_TOKEN" ] || say "Tip: re-run with GITHUB_TOKEN=ghp_… for one-click APK / Maven downloads from CI."
