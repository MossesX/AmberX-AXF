#!/usr/bin/env bash
# Molly (one interface for AmberX, axHub and the Dev Console) on the VPS at https://$DOMAIN behind Coolify's Traefik and
# axHub's sign-in wall. Same shape as apps/axhub-web/deploy/install.sh.
#
#   sudo bash apps/molly/deploy/install.sh            (from any AmberX-AXF checkout; DOMAIN defaults to molly.amberxai.com)
#   sudo bash apps/molly/deploy/install.sh --remove   (rollback: container, update script and cron gone)
#
#   DNS: an A record for $DOMAIN pointing at the VPS, under amberxai.com so the hub session and the framed apps' sign-in
#   cookies stay same-site. The three apps keep running on their own addresses; this never touches them.
#
# What it does (safe to re-run): clones / updates the repo into $DIR, builds the image (static files on nginx, no token)
# and runs it as $NAME on Coolify's network, puts it behind axHub's sign-in wall once the hub can sign someone in
# (APP_WALL=off|on|auto, saved), and installs a cron that pulls the branch every 5 minutes and re-runs this when it changed.
set -euo pipefail

DOMAIN="${DOMAIN:-molly.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
SUB="${SUB:-apps/molly}"
BRANCH="${BRANCH:-main}"
NAME="${NAME:-molly}"
DIR="${DIR:-/opt/molly}"
PORT=8080
AXF_DIR="${AXF_DIR:-/opt/axf}"   # the Dev Console's clone: its GitHub token is reused for the private repo
STATE="$DIR/.app"

say() { echo -e "\033[1;36m[molly]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  docker stop "$NAME" >/dev/null 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -f "/etc/cron.d/$NAME" "/usr/local/bin/$NAME-update"
  say "Removed $NAME (container, update script, cron). Traefik drops its routes;"
  exit 0
fi
command -v docker >/dev/null || { say "Docker is required (Coolify installs it)."; exit 1; }
command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git; }

# ---- 1. repo ----
# GitHub goes through the GitHub App: the token broker first (installation token), then the console's saved token.
BROKER="$AXF_DIR/framework/cli/github-token.mjs"
# (host node if there is one, else the console container, which runs the broker for the console)
CONSOLE_BROKER="docker exec axf-console sh -c 'for d in /opt/axf /app /srv/axf; do [ -f \$d/framework/cli/github-token.mjs ] && exec node \$d/framework/cli/github-token.mjs token; done; exit 1'"
broker_token() { { command -v node >/dev/null && [ -f "$BROKER" ] && node "$BROKER" token 2>/dev/null; } || eval "$CONSOLE_BROKER" 2>/dev/null || true; }
[ -n "${GITHUB_TOKEN:-}" ] || GITHUB_TOKEN="$(broker_token)"
# The console keeps its GitHub token in its env file or in the credentials it saved from the systems check (secrets.env).
for f in "$AXF_DIR/.axf-console/env" "$AXF_DIR/.axf-console/secrets.env"; do
  if [ -z "${GITHUB_TOKEN:-}" ] && [ -f "$f" ]; then GITHUB_TOKEN="$(sed -n 's/^GITHUB_TOKEN=//p' "$f" | head -n1)"; fi
done
GIT=(git)
[ -n "${GITHUB_TOKEN:-}" ] && GIT=(git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)")
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"; "${GIT[@]}" -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  say "Cloning into $DIR"; "${GIT[@]}" clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
mkdir -p "$STATE"; chmod 700 "$STATE"
APP="$DIR/$SUB"
[ -f "$APP/Dockerfile" ] || { say "No app at $APP"; exit 1; }
# shellcheck source=../../../framework/deploy/axf-deploy.sh
. "$DIR/framework/deploy/axf-deploy.sh"

# ---- 2. image ----
say "Building the image (first time takes a few minutes)"
docker build -q -t "$NAME:latest" "$APP" >/dev/null
axf_stop_container "$NAME"
COMMON=(-d --name "$NAME" --restart unless-stopped)

if axf_coolify_proxy_running; then
  NET="$(axf_coolify_network)"
  R="${ROUTER:-$(printf '%s' "$NAME" | tr -cd 'a-z0-9')}"
  # ---- 3. the wall (axHub sign-in): hub admins only; the app has no server to trust signed headers ----
  WALLF="$STATE/wall"
  axf_save_choice "$WALLF" "${APP_WALL:-}"
  WALL_HUB="${APP_WALL_HUB:-https://axhub.amberxai.com}"
  USER_PATHS="${APP_USER_PATHS:-}"
  WALL="$(axf_wall_mode "$WALLF" "$WALL_HUB")"
  WALL_ARGS=()
  if [ "$WALL" = "off" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall OFF (APP_WALL=on bash $APP/deploy/install.sh turns it back on). The pages still need a hub session to show anything."
  elif [ "$WALL" = "on" ]; then
    rm -f "$STATE/wall-waiting"
    if [ -n "$USER_PATHS" ]; then WHO="signed-in hub users"; else WHO="hub admins only"; fi
    say "Sign-in wall ON ($WHO). Rollback: bash $APP/deploy/install.sh --remove"
    axf_wall_labels WALL_ARGS "$R" "$(axf_wall_verify_url "$WALL_HUB" "$USER_PATHS")"
  else
    touch "$STATE/wall-waiting"
    say "Sign-in wall waiting: $WALL_HUB can't sign anyone in yet; the 5-minute update turns it on"
  fi
  axf_coolify_run "$R" "$DOMAIN" "$PORT" "$NET" "$NAME:latest" "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}"
  URL="https://$DOMAIN"
else
  say "No Coolify proxy — exposing port 7490 on localhost only (put HTTPS in front before using it remotely)"
  docker run "${COMMON[@]}" -p "127.0.0.1:7490:$PORT" "$NAME:latest" >/dev/null
  URL="http://127.0.0.1:7490"
fi

# ---- 4. auto-update ----
# shellcheck disable=SC2016  # the fetch command is written into the update script as is
AXF_UPDATE_PRELUDE="T=\$({ command -v node >/dev/null && node \"$BROKER\" token 2>/dev/null; } || $CONSOLE_BROKER 2>/dev/null)
[ -n \"\$T\" ] || T=\$(sed -n 's/^GITHUB_TOKEN=//p' \"$AXF_DIR/.axf-console/env\" \"$AXF_DIR/.axf-console/secrets.env\" 2>/dev/null | head -n1)
H=(); [ -n \"\$T\" ] && H=(-c \"http.https://github.com/.extraheader=AUTHORIZATION: basic \$(printf 'x-access-token:%s' \"\$T\" | base64 -w0)\")" \
AXF_UPDATE_FETCH='git "${H[@]}"' \
  axf_update_script "/usr/local/bin/$NAME-update" "$DIR" "$BRANCH" "/var/log/$NAME-update.log" \
  "DOMAIN=\"$DOMAIN\" NAME=\"$NAME\" DIR=\"$DIR\" SUB=\"$SUB\" AXF_DIR=\"$AXF_DIR\" bash \"$APP/deploy/install.sh\"" \
  "$STATE/update-status.json" "$STATE/wall-waiting"
axf_cron_file "$NAME" "*/5 * * * * root flock -n /run/$NAME-update.lock /usr/local/bin/$NAME-update"

say "Molly:  $URL"
