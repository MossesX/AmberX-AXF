#!/usr/bin/env bash
# Patches on the VPS at https://$DOMAIN behind Coolify's Traefik and axHub's sign-in wall
# (AmberX AXF template web-fastapi-wall; the shared pieces come from src/axf/deploy/axf-deploy.sh).
#
#   sudo bash apps/patches-web/deploy/install.sh          (from any AmberX-AXF checkout; DOMAIN defaults to patches.amberxai.com)
#   (Patches web lives in AmberX-AXF/apps/patches-web, no repo of its own: this clones AmberX-AXF into $DIR and builds
#    the app folder. Private repo: GITHUB_TOKEN=… or the Dev Console's saved one; never written to .git/config.)
#   axHub must allow Patches to frame its pages: AXHUB_EMBED_FRAME_ANCESTORS=https://$DOMAIN on the axHub app.
#
# What it does (safe to re-run):
#   1. clones / updates the repo into $DIR
#   2. makes APP_TOKEN once ($DIR/.app/env, 0600): machines use it on /api; a signed-in hub admin doesn't need it
#   3. builds the image and runs it as $NAME on Coolify's network (HTTPS via letsencrypt), or on 127.0.0.1:$PORT
#   4. puts it behind axHub's sign-in wall once the hub can sign someone in (hub admins only by default;
#      APP_WALL_USERS=on lets every signed-in hub user in, and the server's user_may decides what they reach)
#        APP_WALL=off|on|auto bash deploy/install.sh   (saved; off if the hub is down and you're locked out)
#   5. installs a cron that pulls the branch every 5 minutes and re-runs this when it changed
set -euo pipefail

DOMAIN="${DOMAIN:-patches.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
SUB="${SUB:-apps/patches-web}"   # the app folder inside the repo
BRANCH="${BRANCH:-main}"
NAME="${NAME:-patches-web}"
DIR="${DIR:-/opt/patches-web}"
PORT="${PORT:-7290}"
AXF_DIR="${AXF_DIR:-/opt/axf}"   # the Dev Console's clone: its GitHub token and the hub's wall secret are reused
STATE="$DIR/.app"
ENVF="$STATE/env"

say() { echo -e "\033[1;36m[patches-web]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }
command -v docker >/dev/null || { say "Docker is required (Coolify installs it)."; exit 1; }
command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git; }

# ---- 1. repo ----
if [ -z "${GITHUB_TOKEN:-}" ] && [ -f "$AXF_DIR/.axf-console/env" ]; then
  GITHUB_TOKEN="$(sed -n 's/^GITHUB_TOKEN=//p' "$AXF_DIR/.axf-console/env" | head -n1)"
fi
GIT=(git)
[ -n "${GITHUB_TOKEN:-}" ] && GIT=(git -c "http.https://github.com/.extraheader=AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 -w0)")
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"; "${GIT[@]}" -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  say "Cloning into $DIR"; "${GIT[@]}" clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
mkdir -p "$STATE/data"; chmod 700 "$STATE"
chown 1000:1000 "$STATE/data" && chmod 700 "$STATE/data"   # the container runs as uid 1000
APP="$DIR/$SUB"
[ -f "$APP/Dockerfile" ] || { say "No app at $APP"; exit 1; }
# shellcheck source=src/axf/deploy/axf-deploy.sh
. "$APP/src/axf/deploy/axf-deploy.sh"

# ---- 2. the app token ----
ARG_APP_TOKEN="${APP_TOKEN:-}"
if [ -f "$ENVF" ]; then
  APP_TOKEN="$(sed -n 's/^APP_TOKEN=//p' "$ENVF" | head -n1)"
fi
APP_TOKEN="${ARG_APP_TOKEN:-${APP_TOKEN:-$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)}}"
(umask 077; printf 'APP_TOKEN=%s\n' "$APP_TOKEN" > "$ENVF"); chmod 600 "$ENVF"

# ---- 3. image ----
say "Building the image (first time takes a few minutes)"
docker build -q -t "$NAME:latest" "$APP" >/dev/null
axf_stop_container "$NAME"
COMMON=(-d --name "$NAME" --restart unless-stopped -v "$STATE/data":/data -e APP_TOKEN="$APP_TOKEN" -e PORT="$PORT")

if axf_coolify_proxy_running; then
  NET="$(axf_coolify_network)"
  R="${ROUTER:-$(printf '%s' "$NAME" | tr -cd 'a-z0-9')}"
  # ---- 4. the wall (axHub sign-in) ----
  WALLF="$STATE/wall"
  axf_save_choice "$WALLF" "${APP_WALL:-}"
  WALL_HUB="${APP_WALL_HUB:-https://axhub.amberxai.com}"
  WALL="$(axf_wall_mode "$WALLF" "$WALL_HUB")"
  WALL_ARGS=()
  if [ "$WALL" = "off" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall OFF (APP_WALL=on bash $APP/deploy/install.sh turns it back on); the app token still guards /api"
  elif [ "$WALL" = "on" ]; then
    rm -f "$STATE/wall-waiting"
    axf_save_choice "$STATE/wall-users" "${APP_WALL_USERS:-}"
    USER_PATHS=""
    [ "$(cat "$STATE/wall-users" 2>/dev/null || echo off)" = "on" ] && USER_PATHS="/"
    say "Sign-in wall ON: $( [ -n "$USER_PATHS" ] && echo 'every signed-in hub user (the server limits users)' || echo 'hub admins only'); machines use APP_TOKEN on /api"
    say "  locked out because the hub is down? APP_WALL=off bash $APP/deploy/install.sh"
    # One wall secret per hub (AXHUB_WALL_SECRET on the axHub app): reuse the Dev Console's when it has one.
    WSECF="${APP_WALL_SECRET_FILE:-$AXF_DIR/.axf-console/wall-secret}"
    [ -s "$WSECF" ] || WSECF="$STATE/wall-secret"
    [ "$(axf_wall_secret "$WSECF" "${APP_WALL_SECRET:-}")" = created ] && say "  made a wall secret: put it on the axHub app in Coolify as AXHUB_WALL_SECRET (view it with: cat $WSECF)"
    WALL_ARGS=(-e APP_TRUST_WALL=1 -e "APP_WALL_SECRET=$(cat "$WSECF")" -e "APP_WALL_HUB=$WALL_HUB")
    axf_wall_labels WALL_ARGS "$R" "$(axf_wall_verify_url "$WALL_HUB" "$USER_PATHS")"
  else
    touch "$STATE/wall-waiting"
    say "Sign-in wall waiting: $WALL_HUB can't sign anyone in yet; the 5-minute update turns it on"
  fi
  axf_coolify_run "$R" "$DOMAIN" "$PORT" "$NET" "$NAME:latest" "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}"
  URL="https://$DOMAIN"
else
  say "No Coolify proxy — exposing port $PORT on localhost only (put HTTPS in front before using it remotely)"
  docker run "${COMMON[@]}" -p "127.0.0.1:$PORT:$PORT" "$NAME:latest" >/dev/null
  URL="http://127.0.0.1:$PORT"
fi

# ---- 5. auto-update ----
# The update script reuses the console's GitHub token at run time for a private repo (never stored in the script).
# shellcheck disable=SC2016  # the fetch command is written into the update script as is
AXF_UPDATE_PRELUDE="T=\$(sed -n 's/^GITHUB_TOKEN=//p' \"$AXF_DIR/.axf-console/env\" 2>/dev/null | head -n1)
H=(); [ -n \"\$T\" ] && H=(-c \"http.https://github.com/.extraheader=AUTHORIZATION: basic \$(printf 'x-access-token:%s' \"\$T\" | base64 -w0)\")" \
AXF_UPDATE_FETCH='git "${H[@]}"' \
  axf_update_script "/usr/local/bin/$NAME-update" "$DIR" "$BRANCH" "/var/log/$NAME-update.log" \
  "DOMAIN=\"$DOMAIN\" NAME=\"$NAME\" DIR=\"$DIR\" SUB=\"$SUB\" PORT=\"$PORT\" AXF_DIR=\"$AXF_DIR\" bash \"$APP/deploy/install.sh\"" \
  "$STATE/update-status.json" "$STATE/wall-waiting"
axf_cron_file "$NAME" "*/5 * * * * root flock -n /run/$NAME-update.lock /usr/local/bin/$NAME-update"

say "Patches:  $URL"
say "APP_TOKEN is saved in $ENVF (view it with: cat $ENVF). A signed-in hub admin doesn't need it."
