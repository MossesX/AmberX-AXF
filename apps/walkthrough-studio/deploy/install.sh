#!/usr/bin/env bash
# Walkthrough Studio on the VPS at https://$DOMAIN behind Coolify's Traefik and axHub's sign-in wall
# (a static AmberX AXF react-ts app served by nginx; the shared pieces come from framework/deploy/axf-deploy.sh).
#
#   sudo bash apps/walkthrough-studio/deploy/install.sh      (from any AmberX-AXF checkout; DOMAIN defaults to walkthrough.amberxai.com)
#   (No repo of its own: this clones AmberX-AXF into $DIR and builds the app folder. Private repo: GITHUB_TOKEN=… or the
#    Dev Console's saved one; never written to .git/config.)
#   Its look comes from axHub's data server (developer app): the hub must accept https://$DOMAIN (AXHUB_DATA_ORIGINS, or
#   any origin under the hub's cookie domain). Patches and the console's App tabs may frame it (nginx frame-ancestors).
#
# What it does (safe to re-run):
#   1. clones / updates the repo into $DIR
#   2. builds the image and runs it as $NAME on Coolify's network (HTTPS via letsencrypt), or on 127.0.0.1:$PORT
#   3. puts it behind axHub's sign-in wall (hub admins only) once the hub can sign someone in
#        WS_WALL=off|on|auto bash deploy/install.sh   (saved; off if the hub is down and you're locked out)
#   4. installs a cron that pulls the branch every 5 minutes and re-runs this when it changed
set -euo pipefail

DOMAIN="${DOMAIN:-walkthrough.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
SUB="${SUB:-apps/walkthrough-studio}"
BRANCH="${BRANCH:-main}"
NAME="${NAME:-walkthrough-studio}"
DIR="${DIR:-/opt/walkthrough-studio}"
PORT="${PORT:-8080}"
LOCAL_PORT="${LOCAL_PORT:-7390}"
AXF_DIR="${AXF_DIR:-/opt/axf}"   # the Dev Console's clone: its GitHub token is reused for a private repo
STATE="$DIR/.app"

say() { echo -e "\033[1;36m[walkthrough-studio]\033[0m $*"; }
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
mkdir -p "$STATE"; chmod 700 "$STATE"
APP="$DIR/$SUB"
[ -f "$APP/Dockerfile" ] || { say "No app at $APP"; exit 1; }
# shellcheck source=../../../framework/deploy/axf-deploy.sh
. "$DIR/framework/deploy/axf-deploy.sh"

# ---- 2. image (the framework is re-baked into the app first, as CI does) ----
say "Baking the framework into the app"
rm -rf "$APP/src/axf" && mkdir -p "$APP/src/axf"
for d in core react ui schemas libs; do cp -r "$DIR/framework/$d" "$APP/src/axf/"; done
say "Building the image (first time takes a few minutes)"
docker build -q -t "$NAME:latest" "$APP" >/dev/null
axf_stop_container "$NAME"
COMMON=(-d --name "$NAME" --restart unless-stopped)

if axf_coolify_proxy_running; then
  NET="$(axf_coolify_network)"
  R="${ROUTER:-$(printf '%s' "$NAME" | tr -cd 'a-z0-9')}"
  # ---- 3. the wall (axHub sign-in) ----
  WALLF="$STATE/wall"
  axf_save_choice "$WALLF" "${WS_WALL:-}"
  WALL_HUB="${WS_WALL_HUB:-https://axhub.amberxai.com}"
  WALL="$(axf_wall_mode "$WALLF" "$WALL_HUB")"
  WALL_ARGS=()
  if [ "$WALL" = "off" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall OFF (WS_WALL=on bash $APP/deploy/install.sh turns it back on)"
  elif [ "$WALL" = "on" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall ON: hub admins only. Locked out because the hub is down? WS_WALL=off bash $APP/deploy/install.sh"
    axf_wall_labels WALL_ARGS "$R" "$(axf_wall_verify_url "$WALL_HUB" "")"
  else
    touch "$STATE/wall-waiting"
    say "Sign-in wall waiting: $WALL_HUB can't sign anyone in yet; the 5-minute update turns it on"
  fi
  axf_coolify_run "$R" "$DOMAIN" "$PORT" "$NET" "$NAME:latest" "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}"
  URL="https://$DOMAIN"
else
  say "No Coolify proxy — exposing port $LOCAL_PORT on localhost only (put HTTPS in front before using it remotely)"
  docker run "${COMMON[@]}" -p "127.0.0.1:$LOCAL_PORT:$PORT" "$NAME:latest" >/dev/null
  URL="http://127.0.0.1:$LOCAL_PORT"
fi

# ---- 4. auto-update ----
# shellcheck disable=SC2016  # the fetch command is written into the update script as is
AXF_UPDATE_PRELUDE="T=\$(sed -n 's/^GITHUB_TOKEN=//p' \"$AXF_DIR/.axf-console/env\" 2>/dev/null | head -n1)
H=(); [ -n \"\$T\" ] && H=(-c \"http.https://github.com/.extraheader=AUTHORIZATION: basic \$(printf 'x-access-token:%s' \"\$T\" | base64 -w0)\")" \
AXF_UPDATE_FETCH='git "${H[@]}"' \
  axf_update_script "/usr/local/bin/$NAME-update" "$DIR" "$BRANCH" "/var/log/$NAME-update.log" \
  "DOMAIN=\"$DOMAIN\" NAME=\"$NAME\" DIR=\"$DIR\" SUB=\"$SUB\" PORT=\"$PORT\" AXF_DIR=\"$AXF_DIR\" bash \"$APP/deploy/install.sh\"" \
  "$STATE/update-status.json" "$STATE/wall-waiting"
axf_cron_file "$NAME" "*/5 * * * * root flock -n /run/$NAME-update.lock /usr/local/bin/$NAME-update"

say "Walkthrough Studio:  $URL"
