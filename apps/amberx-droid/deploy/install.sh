#!/usr/bin/env bash
# The AmberX web app on the VPS at https://$DOMAIN behind Coolify's Traefik and axHub's sign-in wall (hub admins only).
# The AmberX Android shell (android/, Capacitor `server.url`) loads this address.
#
#   sudo bash apps/amberx-droid/deploy/install.sh          (from any AmberX-AXF checkout)
#   sudo bash apps/amberx-droid/deploy/install.sh --remove (rollback: container, update script and cron gone)
#
#   The app lives in AmberX-AXF/apps/amberx-droid (no repo of its own): this clones AmberX-AXF into $DIR and
#   builds the app folder. Private repo: GITHUB_TOKEN=… or the Dev Console's saved one; never written to .git/config.
#   DNS: an A record for $DOMAIN pointing at the VPS, under the hub's cookie domain (amberxai.com) so the browser's
#   hub session reaches the app, axHub's feeds and its data server (look, settings).
#
# What it does (safe to re-run):
#   1. clones / updates the repo into $DIR
#   2. builds the image (static files on nginx; the app holds no token) and runs it as $NAME on Coolify's network
#   3. puts it behind axHub's sign-in wall once the hub can sign someone in (APP_WALL=off|on|auto, saved)
#   4. installs a cron that pulls the branch every 5 minutes and re-runs this when it changed
set -euo pipefail

DOMAIN="${DOMAIN:-amberx.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
SUB="${SUB:-apps/amberx-droid}"
BRANCH="${BRANCH:-main}"
NAME="${NAME:-amberx-web}"
DIR="${DIR:-/opt/amberx-web}"
PORT=8080
AXF_DIR="${AXF_DIR:-/opt/axf}"   # the Dev Console's clone: its GitHub token is reused for the private repo
STATE="$DIR/.app"

say() { echo -e "\033[1;36m[amberx]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }

if [ "${1:-}" = "--remove" ]; then
  docker stop "$NAME" >/dev/null 2>&1 || true
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -f "/etc/cron.d/$NAME" "/usr/local/bin/$NAME-update"
  say "Removed $NAME (container, update script, cron). Traefik drops its routes; $DOMAIN no longer answers."
  exit 0
fi
command -v docker >/dev/null || { say "Docker is required (Coolify installs it)."; exit 1; }
command -v git >/dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git; }

# ---- 1. repo ----
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
  # On the hub's host: only the app's page paths, above the hub's catch-all router; signed-in hub users get the page.
  if [ "https://$DOMAIN" = "$WALL_HUB" ]; then
    export AXF_ROUTER_PATHS="${APP_PATHS:-Path(\`/\`) || Path(\`/index.html\`) || PathPrefix(\`/assets/\`)}"
    export AXF_ROUTER_PRIORITY="${APP_PRIORITY:-1000}"
    USER_PATHS="${APP_USER_PATHS-/}"
  else
    USER_PATHS="${APP_USER_PATHS:-}"
  fi
  WALL="$(axf_wall_mode "$WALLF" "$WALL_HUB")"
  WALL_ARGS=()
  if [ "$WALL" = "off" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall OFF (APP_WALL=on bash $APP/deploy/install.sh turns it back on). The pages still need a hub session to show anything."
  elif [ "$WALL" = "on" ]; then
    rm -f "$STATE/wall-waiting"
    say "Sign-in wall ON (${USER_PATHS:+signed-in hub users}${USER_PATHS:-hub admins only}). Rollback: bash $APP/deploy/install.sh --remove"
    axf_wall_labels WALL_ARGS "$R" "$(axf_wall_verify_url "$WALL_HUB" "$USER_PATHS")"
  else
    touch "$STATE/wall-waiting"
    say "Sign-in wall waiting: $WALL_HUB can't sign anyone in yet; the 5-minute update turns it on"
  fi
  axf_coolify_run "$R" "$DOMAIN" "$PORT" "$NET" "$NAME:latest" "${COMMON[@]}" --network "$NET" "${WALL_ARGS[@]}"
  URL="https://$DOMAIN"
else
  say "No Coolify proxy — exposing port 7491 on localhost only (put HTTPS in front before using it remotely)"
  docker run "${COMMON[@]}" -p "127.0.0.1:7491:$PORT" "$NAME:latest" >/dev/null
  URL="http://127.0.0.1:7491"
fi

# ---- 4. auto-update ----
# shellcheck disable=SC2016  # the fetch command is written into the update script as is
AXF_UPDATE_PRELUDE="T=\$(sed -n 's/^GITHUB_TOKEN=//p' \"$AXF_DIR/.axf-console/env\" \"$AXF_DIR/.axf-console/secrets.env\" 2>/dev/null | head -n1)
H=(); [ -n \"\$T\" ] && H=(-c \"http.https://github.com/.extraheader=AUTHORIZATION: basic \$(printf 'x-access-token:%s' \"\$T\" | base64 -w0)\")" \
AXF_UPDATE_FETCH='git "${H[@]}"' \
  axf_update_script "/usr/local/bin/$NAME-update" "$DIR" "$BRANCH" "/var/log/$NAME-update.log" \
  "DOMAIN=\"$DOMAIN\" NAME=\"$NAME\" DIR=\"$DIR\" SUB=\"$SUB\" AXF_DIR=\"$AXF_DIR\" bash \"$APP/deploy/install.sh\"" \
  "$STATE/update-status.json" "$STATE/wall-waiting"
axf_cron_file "$NAME" "*/5 * * * * root flock -n /run/$NAME-update.lock /usr/local/bin/$NAME-update"

say "AmberX web app:  $URL"
